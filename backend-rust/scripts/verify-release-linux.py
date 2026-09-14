#!/usr/bin/env python3
"""Lycoris Rust 后端 Linux 发布容器运行验证（阶段 4：Linux 发布基础）。

用途
    在已构建发布镜像的前提下，按顺序真实验证：
      0. **在任何 Docker/Compose 操作之前**严格校验目标数据库/Redis 只指向已授权的合成
         fixture（host.docker.internal、固定端口与库名，无 query/fragment/其它覆写）；校验
         通过后把**已验证值显式写入子进程环境**并禁用 Compose 隐式 `.env`，保证实际传给
         Compose 的 URL 就是验证过的值。
      1. 测试运行器安全边界（固定上游/回环监听/并发 1..2 在任何网络或 DDL 前生效）；
      2. 就绪探针与普通读接口（`--healthcheck`，即 /health/ready 与 /api/markers/public）；
      3. 非 root 固定 UID/GID、只读根、cap_drop ALL、no-new-privileges、tmpfs /tmp；
      4. 上传持久卷可写，SIGTERM 优雅退出（退出码 0），重启后上传文件仍可读；
      5. 负向：只读根且上传目录不可创建时启动失败，且失败原因确为上传目录初始化不可写
         （镜像缺失/依赖断开会被前置检查拦截，不被当作通过）。
    只使用 Python 标准库；所有命令以 argv 列表传给 subprocess，不经过 shell。

限制
    仅操作 compose 项目 lycoris-rust-release（容器/网络/卷前缀 lycoris-rust-release*）。
    运行期复用温晓授权的合成 PostgreSQL(55432)/Redis(56379)，经 host.docker.internal 接入；
    绝不连接 lycoris-restore-review、恢复库或任何生产地址，也不操作其它 Docker 项目。
    **只有本次真正启动过 app 容器的演练才执行清理**；目标非法或边界 guard 失败时不发起任何
    清理，避免关闭其它正在运行的同项演练。默认清理只 `down` 容器与网络、**保留**上传与测试
    缓存卷；删除卷须显式 `--remove-test-volumes` 且仅删除精确属于本任务的命名卷。

退出码
    0 表示全部运行验证通过；非零表示某项失败。`--evidence` 写入失败也会返回非零。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

COMPOSE_FILE = Path(__file__).resolve().parent.parent / "compose.release.yml"
PROJECT_NAME = "lycoris-rust-release"
APP_CONTAINER = "lycoris-rust-release"
APP_UID = "10001"
APP_GID = "10001"
APP_IMAGE = "lycoris-rust-release-app:local"
NEGATIVE_IMAGE = "lycoris-rust-release-negative:local"
UPLOAD_DIR = "/var/lib/lycoris/uploads"
PG_CONTAINER = "lycoris-rust-postgres"
REDIS_CONTAINER = "lycoris-rust-redis"
NEGATIVE_REASON = "无法准备上传根目录"
WAIT_SECONDS = 90

DEFAULT_DATABASE_URL = "postgres://lycoris:lycoris_local_test@host.docker.internal:55432/lycoris_rust"
DEFAULT_REDIS_URL = "redis://host.docker.internal:56379"
DEFAULT_DATABASE_HOST = "host.docker.internal"
DEFAULT_DATABASE_PORT = 55432
DEFAULT_DATABASE_NAME = "lycoris_rust"
DEFAULT_REDIS_HOST = "host.docker.internal"
DEFAULT_REDIS_PORT = 56379

# 本任务拥有的精确卷名；--remove-test-volumes 只允许删除这些。
OWNED_VOLUMES = [
    "lycoris-rust-release-uploads",
    "lycoris-rust-release-test-target",
    "lycoris-rust-release-test-cargo-registry",
]

_URL_PATTERN = re.compile(r"(?:postgres|postgresql|redis|rediss)://[^\s'\"<>\\]+")

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


class VerifyError(Exception):
    """运行验证失败。"""


def redact(text: str) -> str:
    """移除连接串等可能含凭据的内容，避免错误信息回显秘密。"""
    return _URL_PATTERN.sub("<redacted-url>", text or "")


def run(argv: list[str], env: dict[str, str], timeout: int = 120, check: bool = True):
    try:
        result = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise VerifyError(f"找不到可执行文件: {Path(argv[0]).name}") from exc
    except subprocess.TimeoutExpired as exc:
        raise VerifyError(f"命令超时({timeout}s): {redact(' '.join(argv))}") from exc
    if check and result.returncode != 0:
        detail = redact((result.stderr or result.stdout or "").strip())[:600]
        raise VerifyError(f"命令失败({result.returncode}): {redact(' '.join(argv))}\n{detail}")
    return result


def compose(env: dict[str, str], args: list[str], timeout: int = 120, check: bool = True):
    return run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), "--project-name", PROJECT_NAME, *args],
        env,
        timeout=timeout,
        check=check,
    )


def exec_in(container: str, argv: list[str], env: dict[str, str], check: bool = True):
    return run(["docker", "exec", container, *argv], env, check=check)


def inspect(container: str, template: str, env: dict[str, str]) -> str:
    return run(["docker", "inspect", "--format", template, container], env).stdout.strip()


def image_id(image: str, env: dict[str, str]) -> str:
    return run(["docker", "image", "inspect", "--format", "{{.Id}}", image], env).stdout.strip()


def image_exists(image: str, env: dict[str, str]) -> bool:
    return (
        subprocess.run(
            ["docker", "image", "inspect", image],
            capture_output=True,
            env=env,
        ).returncode
        == 0
    )


def resolve_targets(env: dict[str, str]) -> tuple[str, str]:
    """校验并返回最终有效的 (database_url, redis_url)。

    环境变量为空时使用固定默认值；设置了但不符合已授权合成 fixture 时立即失败。
    返回有效值供调用方**显式写回子进程 env**，从而不依赖也不受 Compose 隐式 `.env` 影响。
    """
    db_url = env.get("RELEASE_DATABASE_URL") or DEFAULT_DATABASE_URL
    redis_url = env.get("RELEASE_REDIS_URL") or DEFAULT_REDIS_URL

    parts = urlsplit(db_url)
    if (
        parts.scheme not in ("postgres", "postgresql")
        or parts.hostname != DEFAULT_DATABASE_HOST
        or parts.port != DEFAULT_DATABASE_PORT
        or parts.path != f"/{DEFAULT_DATABASE_NAME}"
        or parts.query
        or parts.fragment
    ):
        raise VerifyError(
            "RELEASE_DATABASE_URL 不是已授权的合成目标（只允许 host.docker.internal:55432/lycoris_rust，"
            "不得含 query/fragment 或其它连接覆写）"
        )
    parts = urlsplit(redis_url)
    if (
        parts.scheme != "redis"
        or parts.hostname != DEFAULT_REDIS_HOST
        or parts.port != DEFAULT_REDIS_PORT
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        raise VerifyError(
            "RELEASE_REDIS_URL 不是已授权的合成目标（只允许 host.docker.internal:56379，"
            "不得含 query/fragment 或其它连接覆写）"
        )
    return db_url, redis_url


def pin_target_env(env: dict[str, str], db_url: str, redis_url: str) -> None:
    """把已验证值显式固定到子进程环境，并禁用 Compose 隐式 `.env`。

    环境变量在 Compose 插值中优先于项目 `.env`；显式写入保证实际传给 Compose 的 URL 就是
    校验过的值，而 `COMPOSE_DISABLE_ENV_FILE=1` 再加一道不允许隐式文件替换的保险。
    """
    env["RELEASE_DATABASE_URL"] = db_url
    env["RELEASE_REDIS_URL"] = redis_url
    env["COMPOSE_DISABLE_ENV_FILE"] = "1"


def preflight_images(env: dict[str, str]) -> None:
    missing = [name for name in (APP_IMAGE, NEGATIVE_IMAGE) if not image_exists(name, env)]
    if missing:
        raise VerifyError(f"缺少镜像 {'/'.join(missing)}；请先构建（--build）")


def preflight_dependencies(env: dict[str, str]) -> None:
    """确认合成 PG/Redis 已就绪，避免把依赖断开误判为镜像/上传权限问题。"""
    for container in (PG_CONTAINER, REDIS_CONTAINER):
        result = subprocess.run(
            [
                "docker",
                "inspect",
                "--format",
                "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
                container,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        if result.returncode != 0:
            raise VerifyError(f"合成依赖容器 {container} 不可用；请先启动测试依赖服务")
        status, _, health = result.stdout.strip().partition("|")
        if status != "running" or health not in ("healthy", "none"):
            raise VerifyError(f"合成依赖容器 {container} 未就绪（status={status}, health={health}）")
    print("[ok] 合成依赖 PostgreSQL/Redis 已就绪")


def wait_healthy(container: str, env: dict[str, str], deadline: float) -> None:
    last = "未找到容器"
    while time.monotonic() < deadline:
        state = subprocess.run(
            [
                "docker",
                "inspect",
                "--format",
                "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
                container,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        if state.returncode == 0:
            status, _, health = state.stdout.strip().partition("|")
            last = f"status={status}, health={health}"
            if status == "running" and health in ("healthy", "none"):
                print(f"[ok] 容器 {container} 已就绪（{last}）")
                return
        time.sleep(2)
    raise VerifyError(f"容器 {container} 在 {WAIT_SECONDS}s 内未就绪（{last}）")


def check_healthcheck_path(env: dict[str, str], path: str) -> None:
    result = exec_in(
        APP_CONTAINER, ["/usr/local/bin/lycoris-backend", "--healthcheck", path], env, check=False
    )
    if result.returncode != 0:
        detail = redact((result.stderr or result.stdout or "").strip())
        raise VerifyError(f"探针 {path} 未通过: {detail}")
    print(f"[ok] 探针通过: {path}")


def run_guard_tests(env: dict[str, str]) -> None:
    result = compose(
        env,
        ["run", "--rm", "--entrypoint", "bash", "test", "/app/scripts/test-runner-guards.sh"],
        timeout=300,
        check=False,
    )
    combined = f"{result.stdout or ''}{result.stderr or ''}"
    if result.returncode != 0:
        raise VerifyError("测试运行器安全边界 guard 失败\n" + redact(combined.strip())[:800])
    print("[ok] 测试运行器安全边界 guard 通过")


def remove_owned_volumes(env: dict[str, str]) -> list[str]:
    removed = []
    for name in OWNED_VOLUMES:
        if name not in OWNED_VOLUMES:  # 防御：只允许精确自有卷
            continue
        exists = (
            subprocess.run(["docker", "volume", "inspect", name], capture_output=True, env=env).returncode
            == 0
        )
        if not exists:
            continue
        if run(["docker", "volume", "rm", name], env, check=False).returncode != 0:
            print(f"[warn] 删除自有卷 {name} 失败", file=sys.stderr)
        else:
            removed.append(name)
    return removed


def persist_evidence(path: Path, evidence: dict) -> bool:
    """写入证据；失败返回 False（调用方据此返回非零，避免误认为已保存）。"""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"[error] 写证据失败: {redact(str(exc))}", file=sys.stderr)
        return False
    print(f"[info] 证据已写入 {path}")
    return True


def finalize_return_code(return_code: int, path: Path | None, evidence: dict) -> int:
    """证据写入失败时把成功退出码降级为失败。"""
    if path is not None and not persist_evidence(path, evidence):
        return 1
    return return_code


def build_evidence(args: argparse.Namespace) -> dict:
    return {
        "task": "stage4-linux-release-basics",
        "project": PROJECT_NAME,
        "targets": {
            "database_host": DEFAULT_DATABASE_HOST,
            "database_port": DEFAULT_DATABASE_PORT,
            "database_name": DEFAULT_DATABASE_NAME,
            "redis_host": DEFAULT_REDIS_HOST,
            "redis_port": DEFAULT_REDIS_PORT,
        },
        "test_count": args.test_count,
        "checks": {},
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="验证 lycoris-rust-release 运行容器")
    parser.add_argument("--build", action="store_true", help="验证前构建 app/negative 镜像")
    parser.add_argument(
        "--keep",
        action="store_true",
        help="结束后保留容器、网络与卷（默认只 down 容器与网络，保留上传/测试缓存卷）",
    )
    parser.add_argument(
        "--remove-test-volumes",
        action="store_true",
        help="结束后额外删除本任务自有的精确命名卷（默认保留；--keep 优先）",
    )
    parser.add_argument("--skip-migrate", action="store_true", help="跳过对合成库的显式迁移")
    parser.add_argument("--skip-guards", action="store_true", help="跳过测试运行器边界 guard")
    parser.add_argument("--evidence", type=Path, help="将 JSON 证据写入该路径")
    parser.add_argument("--test-count", type=int, help="记录本次 Linux cargo test 通过数量")
    args = parser.parse_args(argv)

    evidence = build_evidence(args)
    checks: dict[str, object] = evidence["checks"]  # type: ignore[assignment]

    # 目标校验在**任何 Docker/Compose 操作之前**完成；失败时直接返回，绝不清理或触碰 Docker。
    base_env = os.environ.copy()
    try:
        db_url, redis_url = resolve_targets(base_env)
    except VerifyError as exc:
        checks["result"] = "failed"
        evidence["error"] = redact(str(exc))
        print(f"[error] {exc}", file=sys.stderr)
        return finalize_return_code(1, args.evidence, evidence)

    # 固定已验证值到子进程环境，禁用隐式 .env；后续所有 Compose 调用都使用这份 env。
    env = base_env
    pin_target_env(env, db_url, redis_url)
    print("[ok] 目标校验通过：仅合成 lycoris_rust / Redis 56379（无覆写，已固定到子进程环境）")

    if not COMPOSE_FILE.is_file():
        print(f"[error] 找不到 compose 文件：{COMPOSE_FILE}", file=sys.stderr)
        return finalize_return_code(1, args.evidence, evidence)

    probe_name = f"verify-{uuid.uuid4().hex}.txt"
    probe_path = f"{UPLOAD_DIR}/{probe_name}"
    probe_value = f"lycoris-release-persistence-{uuid.uuid4().hex}"
    started = False
    return_code = 0

    try:
        if args.build:
            print("[info] 构建 app / negative 镜像…")
            compose(env, ["build", "app", "negative"], timeout=2400)
        preflight_images(env)
        checks["app_image_id"] = image_id(APP_IMAGE, env)
        checks["negative_image_id"] = image_id(NEGATIVE_IMAGE, env)
        preflight_dependencies(env)

        if not args.skip_guards:
            run_guard_tests(env)
            checks["runner_guards"] = "ok"

        if not args.skip_migrate:
            print("[info] 对合成库执行显式迁移（--migrate；仅 synthetic lycoris_rust）…")
            compose(env, ["run", "--rm", "--no-deps", "app", "--migrate"], timeout=300)
            checks["migrate"] = "lycoris_rust only"

        print("[info] 启动 app 容器…")
        compose(env, ["up", "-d", "app"], timeout=300)
        started = True
        wait_healthy(APP_CONTAINER, env, time.monotonic() + WAIT_SECONDS)
        checks["container_id"] = inspect(APP_CONTAINER, "{{.Id}}", env)

        if inspect(APP_CONTAINER, "{{.HostConfig.ReadonlyRootfs}}", env) != "true":
            raise VerifyError("容器根文件系统不是只读")
        checks["readonly_rootfs"] = True
        cap_drop = inspect(APP_CONTAINER, "{{json .HostConfig.CapDrop}}", env)
        if "ALL" not in cap_drop:
            raise VerifyError("未丢弃全部 capability")
        checks["cap_drop_all"] = True
        security_opt = inspect(APP_CONTAINER, "{{json .HostConfig.SecurityOpt}}", env)
        if "no-new-privileges" not in security_opt:
            raise VerifyError("缺少 no-new-privileges")
        checks["no_new_privileges"] = True
        tmpfs = inspect(APP_CONTAINER, "{{json .HostConfig.Tmpfs}}", env)
        if "/tmp" not in tmpfs:
            raise VerifyError("缺少 /tmp tmpfs")
        checks["tmpfs_tmp"] = True
        print("[ok] 加固生效：只读根 / cap_drop ALL / no-new-privileges / tmpfs /tmp")

        check_healthcheck_path(env, "/health/ready")
        check_healthcheck_path(env, "/api/markers/public")
        checks["healthcheck_ready"] = "ok"
        checks["healthcheck_public_read"] = "ok"
        uid = exec_in(APP_CONTAINER, ["id", "-u"], env).stdout.strip()
        gid = exec_in(APP_CONTAINER, ["id", "-g"], env).stdout.strip()
        if uid != APP_UID or gid != APP_GID:
            raise VerifyError(f"运行身份不是固定非 root {APP_UID}:{APP_GID}")
        checks["uid"] = uid
        checks["gid"] = gid
        checks["binary_sha256"] = exec_in(
            APP_CONTAINER, ["sha256sum", "/usr/local/bin/lycoris-backend"], env
        ).stdout.split()[0]
        if (
            exec_in(APP_CONTAINER, ["sh", "-c", "touch /etc/lycoris-should-fail"], env, check=False).returncode
            == 0
        ):
            raise VerifyError("只读根意外可写")
        checks["readonly_root_write_denied"] = True
        write = exec_in(
            APP_CONTAINER,
            ["sh", "-c", f"printf '%s' '{probe_value}' > '{probe_path}' && cat '{probe_path}'"],
            env,
            check=False,
        )
        if write.returncode != 0 or write.stdout.strip() != probe_value:
            raise VerifyError("上传持久卷不可写/不可读")
        checks["uploads_writable"] = True
        print(f"[ok] 非 root={uid}:{gid}；只读根不可写；上传卷可写")

        print("[info] 发送 stop（SIGTERM）并检查退出码…")
        compose(env, ["stop", "app"], timeout=120)
        exit_code = inspect(APP_CONTAINER, "{{.State.ExitCode}}", env)
        if exit_code != "0":
            raise VerifyError(f"SIGTERM 后退出码 {exit_code}，期望 0")
        checks["sigterm_exit_code"] = 0
        print("[ok] SIGTERM 优雅退出，退出码 0")

        print("[info] 重启 app 并读取停机前写入的上传文件…")
        compose(env, ["up", "-d", "app"], timeout=300)
        wait_healthy(APP_CONTAINER, env, time.monotonic() + WAIT_SECONDS)
        persisted = exec_in(APP_CONTAINER, ["cat", probe_path], env, check=False)
        if persisted.returncode != 0 or persisted.stdout.strip() != probe_value:
            raise VerifyError("上传文件重启后不可读")
        checks["upload_persisted_after_restart"] = True
        print("[ok] 上传文件在容器重启后仍可读")
        exec_in(APP_CONTAINER, ["rm", "-f", probe_path], env, check=False)

        print("[info] 负向演练：只读根且上传目录不可创建，期望启动失败…")
        negative = compose(env, ["run", "--rm", "negative"], timeout=300, check=False)
        combined = redact(f"{negative.stdout or ''}{negative.stderr or ''}")
        if negative.returncode == 0:
            raise VerifyError("负向容器意外启动成功")
        if NEGATIVE_REASON not in combined:
            raise VerifyError(
                "负向失败原因与上传目录初始化不可写不符（疑似镜像/依赖问题）\n"
                + combined.strip()[-600:]
            )
        checks["negative_failed_exit_code"] = negative.returncode
        checks["negative_reason"] = NEGATIVE_REASON
        print(f"[ok] 负向启动按预期失败（退出码 {negative.returncode}）：{NEGATIVE_REASON}")

        checks["result"] = "ok"
    except VerifyError as exc:
        checks["result"] = "failed"
        evidence["error"] = redact(str(exc))
        print(f"[error] {exc}", file=sys.stderr)
        return_code = 1
    finally:
        # 只清理本次真正启动过的演练；否则不触碰任何 Docker 对象，避免关闭其它运行。
        if started and not args.keep:
            compose(env, ["down", "--remove-orphans"], timeout=180, check=False)
            if args.remove_test_volumes:
                removed = remove_owned_volumes(env)
                evidence["removed_volumes"] = removed
                if removed:
                    print(f"[ok] 已删除自有命名卷: {', '.join(removed)}")
                else:
                    print("[info] 未发现可删除的自有命名卷")
            else:
                evidence["removed_volumes"] = []
                print("[info] 默认保留上传/测试缓存卷（如需删除请显式 --remove-test-volumes）")
        elif started and args.keep:
            evidence["removed_volumes"] = []
            evidence["kept"] = True
            print("[info] --keep：保留容器、网络与卷")
        else:
            evidence["removed_volumes"] = []
            evidence["cleanup"] = "skipped (no app container started by this run)"

    final_code = finalize_return_code(return_code, args.evidence, evidence)
    if final_code == 0:
        print("[done] 全部运行验证通过")
    return final_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
