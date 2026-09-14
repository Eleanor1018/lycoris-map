#!/usr/bin/env python3
"""数据库大版本回退演练（PG18 最新状态 -> 新 PG17 目标库）。

要求
    - dump/fingerprint 前冻结入口并确认两个应用写者已停止；任一冻结/停止失败即中止，不得继续 dump。
    - 用 PG18 官方工具导出**含新增写入**的最新普通 SQL；来源库不删除。
    - PG17.11 psql 支持 `\\restrict`/`\\unrestrict`，默认原样恢复；仅当原样失败且显式
      `strip_restrict=True` 时才受控删除安全元命令并记录 sha256 证据（不盲目 sed）。
    - 恢复后核对六表指纹/序列与媒体前后 sha256。
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

import common
import switching

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

META_RE = re.compile(r"^\\(?:un)?restrict\b.*$", re.MULTILINE)
BACK_DB = "lycoris_rehearsal_back"
UP_DB = "lycoris_rehearsal_up"
_LABEL_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")


class DbRollbackError(RuntimeError):
    pass


def _is_hex64(value: object) -> bool:
    return isinstance(value, str) and bool(_HEX64_RE.match(value))


def _safe_label(label: str) -> str:
    if not isinstance(label, str) or not _LABEL_RE.match(label):
        raise DbRollbackError("label 只允许 [A-Za-z0-9_-]{1,64}")
    return label


def _within(base: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def baseline_paths(work_dir: Path, label: str) -> dict[str, Path]:
    """快照/恢复只允许 work_dir/artifacts 与 work_dir/uploads 内的固定路径。"""
    safe = _safe_label(label)
    artifacts = work_dir / "artifacts"
    paths = {
        "dump": artifacts / f"baseline-{safe}.dump",
        "manifest": artifacts / f"baseline-{safe}.manifest.json",
        "media": artifacts / f"baseline-{safe}-uploads",
        "uploads": work_dir / "uploads",
    }
    for key, path in paths.items():
        if not _within(work_dir, path):
            raise DbRollbackError(f"{key} 路径逃逸演练目录，拒绝")
    return paths


def read_manifest(path: Path, label: str) -> dict:
    if not path.is_file():
        raise DbRollbackError(f"找不到基线快照 manifest：{path.name}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise DbRollbackError("基线 manifest 损坏，拒绝恢复") from exc
    if not isinstance(data, dict):
        raise DbRollbackError("基线 manifest 结构非法（非对象）")
    if data.get("label") != label:
        raise DbRollbackError("基线 manifest label 不匹配")
    if data.get("database") != UP_DB:
        raise DbRollbackError(f"基线 manifest database 必须为 {UP_DB}")
    if not _is_hex64(data.get("dumpSha256")):
        raise DbRollbackError("基线 manifest dumpSha256 必须是 64 位 hex")
    fingerprint = data.get("fingerprint")
    if not isinstance(fingerprint, dict) or not isinstance(fingerprint.get("tables"), dict) \
            or not isinstance(fingerprint.get("sequences"), dict):
        raise DbRollbackError("基线 manifest fingerprint 结构非法")
    media = data.get("media")
    if not isinstance(media, dict):
        raise DbRollbackError("基线 manifest media 结构非法")
    file_count = media.get("fileCount")
    if not isinstance(file_count, int) or isinstance(file_count, bool) or file_count < 0:
        raise DbRollbackError("基线 manifest media.fileCount 必须为非负整数")
    if not _is_hex64(media.get("combinedSha256")):
        raise DbRollbackError("基线 manifest media.combinedSha256 必须是 64 位 hex")
    return data


def verify_media_dir(media_dir: Path, manifest: dict) -> None:
    if not media_dir.is_dir():
        raise DbRollbackError("基线媒体目录不存在")
    actual = common.media_fingerprint(media_dir)
    expected = manifest.get("media", {})
    if actual["combinedSha256"] != expected.get("combinedSha256") or actual["fileCount"] != expected.get("fileCount"):
        raise DbRollbackError("基线媒体 sha256/数量与 manifest 不一致")


def preflight_restore(work_dir: Path, label: str) -> tuple[dict[str, Path], dict, bytes]:
    """恢复前全部**只读**预检：label/manifest/dump/media；不做任何 freeze/DDL/删除。"""
    paths = baseline_paths(work_dir, label)
    manifest = read_manifest(paths["manifest"], _safe_label(label))
    if not paths["dump"].is_file():
        raise DbRollbackError("缺少基线 dump 文件")
    dump = paths["dump"].read_bytes()
    if hashlib.sha256(dump).hexdigest() != manifest["dumpSha256"]:
        raise DbRollbackError("基线 dump sha256 与 manifest 不一致")
    verify_media_dir(paths["media"], manifest)
    return paths, manifest, dump


def run_snapshot_baseline(
    *, work_dir: Path, user: str, report: common.Report, label: str
) -> None:
    """在完整 Java→Rust→Java 新增写入验证之后建立配对基线（显式操作）。

    同 label 已有 dump/manifest/media 即拒绝覆盖（保留已验收证据），请换新 label。
    """
    paths = baseline_paths(work_dir, label)
    existing = [k for k in ("dump", "manifest", "media") if paths[k].exists()]
    if existing:
        raise DbRollbackError(
            f"基线 label {label} 已存在 {existing}，拒绝覆盖；请使用新 label"
        )
    switching.freeze_entry(work_dir)
    report.add("frozen", True)
    for backend in ("java", "rust"):
        switching.stop_backend(work_dir, backend)
    common.wait_healthy(common.PG18_CONTAINER, timeout=120)
    fp = common.fingerprint_database(common.PG18_CONTAINER, UP_DB, user=user, label="up")
    dump = common.pg_dump_bytes(common.PG18_CONTAINER, UP_DB, user=user, plain=False)
    paths["dump"].parent.mkdir(parents=True, exist_ok=True)
    paths["dump"].write_bytes(dump)
    if paths["media"].exists():
        shutil.rmtree(paths["media"])
    shutil.copytree(paths["uploads"], paths["media"])
    media = common.media_fingerprint(paths["media"])
    manifest = {
        "label": _safe_label(label),
        "createdAt": common.now_iso(),
        "database": UP_DB,
        "dumpSha256": hashlib.sha256(dump).hexdigest(),
        "fingerprint": fp,
        "media": {"fileCount": media["fileCount"], "combinedSha256": media["combinedSha256"]},
        "note": "配对性能基线；须在完整新增写入验证后建立，恢复只用于既有 up 库与 uploads",
    }
    _atomic_write_json(paths["manifest"], manifest)
    report.artifact("baselineDump", paths["dump"])
    report.artifact("baselineManifest", paths["manifest"])
    report.add("rows", {t: v["rows"] for t, v in fp["tables"].items()})
    report.add("media", manifest["media"])


def run_restore_baseline(
    *, work_dir: Path, user: str, report: common.Report, label: str
) -> None:
    """恢复配对基线：**先完成全部只读预检**，再 freeze/stop/重建/恢复。

    预检（label/路径/manifest/database/dump hash/media）任一失败都在任何冻结、停应用、
    DDL 或删除之前中止，绝不先删已有数据。
    """
    paths, manifest, dump = preflight_restore(work_dir, label)
    # 预检全部通过后才进入有副作用阶段。
    switching.freeze_entry(work_dir)
    report.add("frozen", True)
    for backend in ("java", "rust"):
        switching.stop_backend(work_dir, backend)
    common.wait_healthy(common.PG18_CONTAINER, timeout=120)
    if common.database_exists(common.PG18_CONTAINER, UP_DB, user=user):
        common.drop_database(common.PG18_CONTAINER, UP_DB, user=user)
    common.create_database(common.PG18_CONTAINER, UP_DB, user=user)
    common.pg_restore_stdin(common.PG18_CONTAINER, UP_DB, user=user, data=dump)
    if not _within(work_dir, paths["uploads"]):
        raise DbRollbackError("uploads 路径逃逸演练目录，拒绝")
    if paths["uploads"].exists():
        shutil.rmtree(paths["uploads"])
    shutil.copytree(paths["media"], paths["uploads"])
    after_fp = common.fingerprint_database(common.PG18_CONTAINER, UP_DB, user=user, label="up")
    comparison = common.compare_fingerprints(manifest["fingerprint"], after_fp)
    if not comparison["equal"]:
        raise DbRollbackError("基线恢复后指纹不一致：" + "; ".join(comparison["differences"]))
    verify_media_dir(paths["uploads"], manifest)
    report.add("rows", {t: v["rows"] for t, v in after_fp["tables"].items()})
    report.add("mediaStable", True)
    report.add("fingerprintEqual", True)


def _atomic_write_json(path: Path, data: dict) -> None:
    import os
    import tempfile

    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def strip_pg18_dump_metacommands(text: str) -> tuple[str, dict[str, object]]:
    """受控转换：仅删除 PG18 pg_dump 的 psql 安全元命令，并记录证据。"""
    removed = META_RE.findall(text)
    converted = META_RE.sub("", text)
    evidence = {
        "removedCount": len(removed),
        "rawSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "convertedSha256": hashlib.sha256(converted.encode("utf-8")).hexdigest(),
        "transformation": "strip-only-psql-restrict-metacommands",
    }
    return converted, evidence


def _count(container: str, database: str, table: str, *, user: str) -> int:
    raw = common.psql(
        container, database, f'SELECT count(*) FROM public."{table}";', user=user
    )
    return int(raw.strip() or 0)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run_db_rollback(
    *,
    work_dir: Path,
    user: str,
    report: common.Report,
    recreate: bool,
    strip_restrict: bool,
) -> None:
    container17 = common.PG17_CONTAINER
    db17 = common.TABLES["pg17"]["database"]
    container18 = common.PG18_CONTAINER
    db18 = common.TABLES["pg18"]["database"]

    # 1) 冻结入口；失败即中止。
    switching.freeze_entry(work_dir)
    report.add("frozen", True)

    # 2) 停止所有写者并核验。
    stopped = []
    for backend in ("java", "rust"):
        switching.stop_backend(work_dir, backend)
        stopped.append(backend)
    report.add("stoppedWriters", stopped)

    common.wait_healthy(common.PG17_CONTAINER, timeout=120)
    common.wait_healthy(common.PG18_CONTAINER, timeout=120)

    # 3) 媒体前指纹（写者已停，状态稳定）。
    media_before = common.media_fingerprint(work_dir / "uploads")
    report.add(
        "mediaBefore",
        {
            "fileCount": media_before["fileCount"],
            "combinedSha256": media_before["combinedSha256"],
        },
    )

    if _count(container18, db18, "users", user=user) == 0:
        raise DbRollbackError("PG18 演练库为空，无法执行回退演练")

    # 4) PG18 最新状态原样导出（来源库不删除）。
    dump = common.pg_dump_bytes(container18, db18, user=user, plain=True)
    raw_path = work_dir / "artifacts" / "pg18_latest.sql"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_bytes(dump)
    report.artifact("pg18RawDump", raw_path)
    report.add("rawDumpSha256", _sha256_bytes(dump))
    report.add("containsTransactionTimeout", b"transaction_timeout" in dump)
    report.add("containsRestrictMetacommand", b"\\restrict" in dump)
    report.add("restoreMode", "raw")

    def recreate_back() -> None:
        if common.database_exists(container17, BACK_DB, user=user):
            if not recreate:
                raise DbRollbackError("PG17 回退目标库已存在；如需重建请显式 --recreate")
            common.drop_database(container17, BACK_DB, user=user)
        common.create_database(container17, BACK_DB, user=user)

    recreate_back()
    try:
        common.psql(container17, BACK_DB, sql_file=raw_path, user=user, timeout=1800)
        report.add("rawRestoreSucceeded", True)
    except Exception as exc:  # noqa: BLE001
        report.add("rawRestoreSucceeded", False)
        report.add("rawRestoreError", str(exc)[:600])
        if not strip_restrict:
            raise DbRollbackError(
                "PG18 dump 原样恢复到 PG17 失败；已记录错误，未自动转换。"
                "人工确认后可用 --strip-restrict-metacommands"
            ) from exc
        converted, evidence = strip_pg18_dump_metacommands(
            dump.decode("utf-8", errors="replace")
        )
        conv_path = work_dir / "artifacts" / "pg18_latest_pg17_compat.sql"
        conv_path.write_text(converted, encoding="utf-8")
        report.artifact("pg18CompatDump", conv_path)
        report.add("restoreMode", "strip-restrict-metacommands")
        report.add("compatEvidence", evidence)
        recreate_back()
        common.psql(container17, BACK_DB, sql_file=conv_path, user=user, timeout=1800)

    # 5) 指纹与媒体核对。
    source_fp = common.fingerprint_database(container18, db18, user=user, label="pg18")
    back_fp = common.fingerprint_database(container17, BACK_DB, user=user, label="pg17_back")
    comparison = common.compare_fingerprints(source_fp, back_fp)
    comp_path = work_dir / "fingerprints" / "rollback_compare.json"
    comp_path.write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )
    report.artifact("comparison", comp_path)
    report.add(
        "note",
        "大版本逻辑恢复不是 PostgreSQL 保证的任意兼容；仅本次 schema 实际演练通过为准",
    )
    if not comparison["equal"]:
        raise DbRollbackError("PG18 -> PG17(back) 指纹不一致：" + "; ".join(comparison["differences"]))

    media_after = common.media_fingerprint(work_dir / "uploads")
    report.add(
        "mediaAfter",
        {
            "fileCount": media_after["fileCount"],
            "combinedSha256": media_after["combinedSha256"],
        },
    )
    if media_after["combinedSha256"] != media_before["combinedSha256"]:
        raise DbRollbackError("回退期间媒体 sha256 发生变化（写者未真正停止）")
    report.add("mediaStable", True)
    report.add("rows", {t: v["rows"] for t, v in back_fp["tables"].items()})
    report.add("fingerprintEqual", True)
