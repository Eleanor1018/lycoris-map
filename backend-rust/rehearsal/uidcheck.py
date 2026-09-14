#!/usr/bin/env python3
"""UID/GID 共享卷核验：用 Linux 命名卷分别以 Java/Rust 镜像的 UID10001 写入并互读。

不使用 Windows bind mount 作为 Linux 权限证明，不 chmod 777。只操作本任务前缀的命名卷。
- 卷已存在则拒绝（不复用他人/既有卷）。
- 只清理本次确认创建的卷；清理失败必须报告，不静默视为成功。
- 世界可写按实际 mode 的八进制 `& 0o002` 判断（不仅 != 777）。
"""

from __future__ import annotations

import sys

import common

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

VOLUME_NAME = "lycoris-rust-rehearsal-uidcheck"
UID_GID = "10001:10001"


class UidCheckError(RuntimeError):
    pass


def _image_id(image: str) -> str:
    result = common.run(
        ["docker", "image", "inspect", image, "--format", "{{.Id}}"], check=False, timeout=30
    )
    return result.stdout.decode("utf-8", errors="replace").strip()


def _volume(*args: str, check: bool = True):
    if not VOLUME_NAME.startswith("lycoris-rust-rehearsal-"):
        raise UidCheckError("拒绝操作非本任务命名卷")
    return common.run(["docker", "volume", *args], check=check, timeout=60)


def _run_sh(image: str, script: str, *, uid: str = UID_GID, timeout: int = 120):
    return common.run(
        [
            "docker", "run", "--rm", "--user", uid,
            "-v", f"{VOLUME_NAME}:/vol",
            "--entrypoint", "/bin/sh", image, "-c", script,
        ],
        check=False,
        timeout=timeout,
    )


def _parse_mode(observed: str, label: str) -> int:
    import re

    match = re.search(rf"{label}=([0-7]+)", observed)
    if not match:
        raise UidCheckError(f"未读取到 {label} 的文件 mode")
    value = int(match.group(1), 8)
    if value == 0:
        raise UidCheckError(f"{label} mode=0 非法")
    if value & 0o002:
        raise UidCheckError(f"{label} 世界可写（mode={match.group(1)}），拒绝")
    return value


def run_uid_volume_check(*, java_image: str, rust_image: str, report: common.Report) -> dict[str, object]:
    if _volume("inspect", VOLUME_NAME, check=False).returncode == 0:
        raise UidCheckError(f"命名卷 {VOLUME_NAME} 已存在，拒绝复用；请先清理后再运行")
    facts: dict[str, object] = {
        "volume": VOLUME_NAME,
        "uidGid": UID_GID,
        "javaImageId": _image_id(java_image),
        "rustImageId": _image_id(rust_image),
    }
    created = False
    main_exc: Exception | None = None
    try:
        _volume("create", VOLUME_NAME, check=True)
        created = True
        # 命名卷初始属主为 root：以 root 一次性 chown 到 10001:10001（0750，非 777）。
        init = _run_sh(java_image, "set -e; chown 10001:10001 /vol; chmod 0750 /vol", uid="0:0")
        if init.returncode != 0:
            raise UidCheckError("命名卷初始化 chown 失败：" + init.stderr.decode("utf-8", errors="replace")[:300])
        for label, image in (("java", java_image), ("rust", rust_image)):
            res = _run_sh(
                image,
                f"set -e; id -u > /vol/uid-{label}; umask 022; "
                f"printf '%s' '{label}-payload' > /vol/from-{label}; "
                f"stat -c '%a' /vol/from-{label} > /vol/mode-{label}",
            )
            if res.returncode != 0:
                raise UidCheckError(
                    f"{label} 镜像无法以 UID10001 写命名卷："
                    + res.stderr.decode("utf-8", errors="replace")[:300]
                )
        java_read = _run_sh(java_image, "cat /vol/from-rust")
        rust_read = _run_sh(rust_image, "cat /vol/from-java")
        final = _run_sh(
            java_image,
            "set -e; echo UID_J=$(cat /vol/uid-java); echo UID_R=$(cat /vol/uid-rust); "
            "echo MODE_J=$(cat /vol/mode-java); echo MODE_R=$(cat /vol/mode-rust)",
        )
        for name, res in (("java 读 rust", java_read), ("rust 读 java", rust_read), ("stat", final)):
            if res.returncode != 0:
                raise UidCheckError(f"{name} 退出码 {res.returncode}: " + res.stderr.decode("utf-8", errors="replace")[:200])
        java_payload = java_read.stdout.decode("utf-8", errors="replace").strip()
        rust_payload = rust_read.stdout.decode("utf-8", errors="replace").strip()
        observed = final.stdout.decode("utf-8", errors="replace")
        facts["javaReadsRust"] = java_payload
        facts["rustReadsJava"] = rust_payload
        facts["observed"] = observed.strip()
        if java_payload != "rust-payload" or rust_payload != "java-payload":
            raise UidCheckError("互读内容不一致")
        for token in ("UID_J=10001", "UID_R=10001"):
            if token not in observed:
                raise UidCheckError(f"UID 不符：缺少 {token}")
        facts["javaModeOctal"] = oct(_parse_mode(observed, "MODE_J"))
        facts["rustModeOctal"] = oct(_parse_mode(observed, "MODE_R"))
        facts["crossReadOk"] = True
        facts["noWorldWritable"] = True
    except Exception as exc:  # noqa: BLE001
        main_exc = exc
    cleanup_error = None
    if created:
        rm = _volume("rm", "-f", VOLUME_NAME, check=False)
        if rm.returncode != 0:
            cleanup_error = rm.stderr.decode("utf-8", errors="replace")[:200]
    if cleanup_error:
        raise UidCheckError(f"清理命名卷失败：{cleanup_error}") from main_exc
    if main_exc:
        raise main_exc
    return facts
