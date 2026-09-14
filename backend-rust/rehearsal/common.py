#!/usr/bin/env python3
"""阶段 4 演练共享工具（纯标准库）。

提供 docker/compose 调用封装、脱敏子进程执行、JSON 报告与稳定指纹计算。
所有可能产生副作用的入口都在调用前先过 `guard.assert_container_name` / 环境 guard。
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

from guard import (  # noqa: E402  (同目录模块)
    CONTAINER_PREFIX,
    ALLOWED_DATABASES,
    GuardError,
    assert_container_name,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CRATE_ROOT = REPO_ROOT / "backend-rust"
REHEARSAL_ROOT = CRATE_ROOT / "rehearsal"
COMPOSE_FILE = REHEARSAL_ROOT / "compose.rehearsal.yml"
BASELINE_SQL = REPO_ROOT / "docs" / "rust-migration" / "schema-baseline.sql"

PROJECT_NAME = "lycoris-rust-rehearsal"

PG17_CONTAINER = f"{CONTAINER_PREFIX}pg17"
PG18_CONTAINER = f"{CONTAINER_PREFIX}pg18"
REDIS_CONTAINER = f"{CONTAINER_PREFIX}redis"
NGINX_CONTAINER = f"{CONTAINER_PREFIX}nginx"
JAVA_CONTAINER = f"{CONTAINER_PREFIX}java"
RUST_CONTAINER = f"{CONTAINER_PREFIX}rust"

# 业务表（6 张），全部有 id 主键，指纹按 id 排序取 md5。
BUSINESS_TABLES = (
    "users",
    "map_markers",
    "map_marker_translations",
    "marker_favorites",
    "marker_edit_proposals",
    "marker_image_proposals",
)

TABLES = {
    "pg17": {
        "container": PG17_CONTAINER,
        "host": "127.0.0.1",
        "port": 55435,
        "database": "lycoris_rehearsal_src",
    },
    "pg18": {
        "container": PG18_CONTAINER,
        "host": "127.0.0.1",
        "port": 55434,
        "database": "lycoris_rehearsal_up",
    },
}

DEFAULT_WORK_DIR = Path(
    os.environ.get(
        "REHEARSAL_WORK_DIR",
        str(Path(tempfile.gettempdir()) / PROJECT_NAME),
    )
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def git_head(repo: Path = REPO_ROOT) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return out.stdout.strip() if out.returncode == 0 else "unknown"
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"


def run(
    argv: list[str],
    *,
    env: Mapping[str, str] | None = None,
    input_bytes: bytes | None = None,
    timeout: int = 300,
    check: bool = True,
    label: str | None = None,
) -> subprocess.CompletedProcess:
    """以 argv 列表执行命令（不经 shell）；失败时返回码非 0 或抛错。"""
    merged = os.environ.copy()
    if env:
        merged.update(env)
    try:
        result = subprocess.run(
            argv,
            capture_output=True,
            input=input_bytes,
            env=merged,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"找不到可执行文件: {argv[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"命令超时({timeout}s): {' '.join(argv[:2])} …") from exc
    if check and result.returncode != 0:
        detail = _decode(result.stderr) or _decode(result.stdout)
        detail = detail.strip()[:2000]
        raise RuntimeError(
            f"命令失败({result.returncode}): {' '.join(argv[:3])} …\n{detail}"
        )
    return result


def _decode(raw: bytes | None) -> str:
    if not raw:
        return ""
    return raw.decode("utf-8", errors="replace")


def compose(
    args: list[str],
    *,
    work_dir: Path,
    env: Mapping[str, str] | None = None,
    timeout: int = 900,
    check: bool = True,
) -> subprocess.CompletedProcess:
    env_file = work_dir / ".env"
    argv = [
        "docker",
        "compose",
        "-f",
        str(COMPOSE_FILE),
        "--project-name",
        PROJECT_NAME,
    ]
    if env_file.is_file():
        argv += ["--env-file", str(env_file)]
    argv += args
    # Compose 插值优先级：宿主环境 > --env-file。把已验证的 .env 显式并入子进程环境，
    # 使其覆盖宿主同名变量，避免实际目标与 guard 校验值不一致。
    overrides: dict[str, str] = {}
    if env_file.is_file():
        overrides.update(read_env_file(env_file))
    if env:
        overrides.update(env)
    return run(argv, env=overrides, timeout=timeout, check=check)


def docker_exec(
    container: str,
    args: list[str],
    *,
    input_bytes: bytes | None = None,
    env: Mapping[str, str] | None = None,
    timeout: int = 300,
    check: bool = True,
) -> subprocess.CompletedProcess:
    assert_container_name(container)
    return run(
        ["docker", "exec", "-i", container, *args],
        input_bytes=input_bytes,
        env=env,
        timeout=timeout,
        check=check,
    )


def psql(
    container: str,
    database: str,
    sql: str | None = None,
    *,
    user: str,
    sql_file: Path | None = None,
    timeout: int = 600,
    check: bool = True,
    tuples_only: bool = True,
) -> str:
    """在容器内执行 psql；SQL **始终** 经 stdin（`-f -`），不出现在主机 argv。

    口令：容器内 psql 走 local socket（镜像默认 `local all all trust`），因此不传
    PGPASSWORD。注意 `docker exec` 的 `-e`/主机 env 不会自动进入容器，本工具不伪装
    已传口令；如未来确需 TCP+口令，应显式 `docker exec -e PGPASSWORD` 且值来自宿主
    环境，而不是放进 argv。
    """
    if database not in ALLOWED_DATABASES:
        raise GuardError("拒绝向非演练合成库执行 psql（不显示原值）")
    if (sql is None) == (sql_file is None):
        raise GuardError("psql 必须且只能提供 sql 或 sql_file 之一")
    args = [
        "psql",
        "-U",
        user,
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-X",
        "-q",
    ]
    if tuples_only:
        args.append("-tA")
    args += ["-f", "-"]
    payload = sql_file.read_bytes() if sql_file is not None else sql.encode("utf-8")
    result = docker_exec(
        container,
        args,
        input_bytes=payload,
        timeout=timeout,
        check=check,
    )
    return _decode(result.stdout)


def _assert_maintenance_container(container: str) -> None:
    assert_container_name(container)
    if container not in (PG17_CONTAINER, PG18_CONTAINER):
        raise GuardError("维护操作只允许 PG17/PG18 演练容器（不显示原值）")


def admin_psql(
    container: str,
    sql: str,
    *,
    user: str,
    timeout: int = 120,
) -> str:
    """仅用于演练集群维护库 `postgres` 的固定库名维护 SQL（CREATE/DROP DATABASE）。

    只允许 PG17/PG18 演练容器；维护库仅本集群的 `postgres`，不含业务数据。
    业务读写一律通过 psql() 走白名单合成库。SQL 经 stdin，不进 argv。
    """
    _assert_maintenance_container(container)
    result = docker_exec(
        container,
        ["psql", "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-tA", "-f", "-"],
        input_bytes=sql.encode("utf-8"),
        timeout=timeout,
    )
    return _decode(result.stdout)


def database_exists(container: str, database: str, *, user: str) -> bool:
    if database not in ALLOWED_DATABASES:
        raise GuardError("拒绝查询非演练合成库（不显示原值）")
    raw = admin_psql(
        container,
        f"SELECT 1 FROM pg_database WHERE datname = '{database}';",
        user=user,
    )
    return raw.strip() == "1"


def drop_database(container: str, database: str, *, user: str) -> None:
    """仅允许删除本任务三个合成库之一；删除前终止其连接。"""
    if database not in ALLOWED_DATABASES:
        raise GuardError("拒绝删除非演练合成库（不显示原值）")
    admin_psql(
        container,
        f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        f"WHERE datname = '{database}' AND pid <> pg_backend_pid();",
        user=user,
    )
    admin_psql(
        container,
        f'DROP DATABASE IF EXISTS "{database}";',
        user=user,
    )


def create_database(container: str, database: str, *, user: str) -> None:
    if database not in ALLOWED_DATABASES:
        raise GuardError("拒绝创建非演练合成库（不显示原值）")
    admin_psql(
        container,
        f'CREATE DATABASE "{database}" TEMPLATE template0;',
        user=user,
    )


def pg_dump_bytes(
    container: str,
    database: str,
    *,
    user: str,
    plain: bool,
    exclude_extensions: Iterable[str] = (),
    timeout: int = 900,
) -> bytes:
    """在容器内 pg_dump 到 stdout（local socket，无口令），返回原始字节。

    exclude_extensions：可选、明确具名的排除；默认不排除任何扩展。
    """
    if database not in ALLOWED_DATABASES:
        raise GuardError("拒绝导出非演练合成库（不显示原值）")
    args = ["pg_dump", "-U", user, "-d", database, "--no-owner", "--no-privileges"]
    for ext in exclude_extensions:
        args += ["--exclude-extension", ext]
    if plain:
        args += ["--format=plain", "--no-comments"]
    else:
        args.append("--format=custom")
    result = docker_exec(container, args, timeout=timeout)
    return result.stdout


def pg_restore_stdin(
    container: str,
    database: str,
    *,
    user: str,
    data: bytes,
    timeout: int = 900,
) -> None:
    """从 stdin 用 pg_restore 恢复 custom 格式归档（local socket，无口令）。"""
    if database not in ALLOWED_DATABASES:
        raise GuardError("拒绝恢复到非演练合成库（不显示原值）")
    docker_exec(
        container,
        [
            "pg_restore",
            "-U",
            user,
            "-d",
            database,
            "--no-owner",
            "--no-privileges",
            "--exit-on-error",
        ],
        input_bytes=data,
        timeout=timeout,
    )


def wait_healthy(container: str, *, timeout: float = 120.0) -> str:
    assert_container_name(container)
    deadline = time.monotonic() + timeout
    last = "not found"
    while time.monotonic() < deadline:
        result = run(
            [
                "docker",
                "inspect",
                "--format",
                "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
                container,
            ],
            check=False,
            timeout=30,
        )
        if result.returncode == 0:
            status, _, health = _decode(result.stdout).strip().partition("|")
            last = f"status={status}, health={health}"
            if status == "running" and health in ("healthy", "none"):
                return last
        time.sleep(2)
    raise RuntimeError(f"{container} 在 {timeout:.0f}s 内未就绪（{last}）")


# --------------------------------------------------------------------------
# JSON 报告
# --------------------------------------------------------------------------


@dataclass
class Report:
    """单个步骤的 JSON 报告；失败时也写出，保留已发生的事实。"""

    step: str
    work_dir: Path
    ok: bool = True
    status: str = "ok"
    error: str | None = None
    facts: dict[str, Any] = field(default_factory=dict)
    artifacts: dict[str, str] = field(default_factory=dict)

    def add(self, key: str, value: Any) -> None:
        self.facts[key] = value

    def artifact(self, key: str, path: Path) -> None:
        self.artifacts[key] = str(path)

    def fail(self, message: str) -> None:
        self.ok = False
        self.status = "failed"
        self.error = message

    def blocked(self, message: str) -> None:
        self.ok = False
        self.status = "blocked"
        self.error = message

    def write(self) -> Path:
        reports = self.work_dir / "reports"
        reports.mkdir(parents=True, exist_ok=True)
        payload = {
            "step": self.step,
            "status": self.status,
            "ok": self.ok,
            "error": self.error,
            "timestamp": now_iso(),
            "gitHead": git_head(),
            "workDir": str(self.work_dir),
            "facts": self.facts,
            "artifacts": self.artifacts,
        }
        # 不覆盖既有报告：同名重跑追加 -N，保留已发生的动作与失败记录。
        path = reports / f"{self.step}.json"
        if path.exists():
            index = 2
            while (reports / f"{self.step}-{index}.json").exists():
                index += 1
            path = reports / f"{self.step}-{index}.json"
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        return path


# --------------------------------------------------------------------------
# 稳定指纹
# --------------------------------------------------------------------------


def table_fingerprint(
    container: str, database: str, table: str, *, user: str
) -> dict[str, Any]:
    if table not in BUSINESS_TABLES:
        raise GuardError("指纹只允许 6 张业务表")
    sql = (
        f"SELECT count(*)::text || '|' || "
        f"COALESCE(md5(string_agg(md5(t::text), '' ORDER BY t.id)), '') "
        f'FROM public."{table}" t;'
    )
    raw = psql(container, database, sql, user=user).strip()
    rows_text, _, checksum = raw.partition("|")
    return {"table": table, "rows": int(rows_text or 0), "md5": checksum}


def sequence_state(container: str, database: str, *, user: str) -> dict[str, int]:
    sql = (
        "SELECT sequencename || '=' || last_value FROM pg_sequences "
        "WHERE schemaname = 'public' ORDER BY sequencename;"
    )
    raw = psql(container, database, sql, user=user)
    state: dict[str, int] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        name, _, value = line.partition("=")
        try:
            state[name] = int(value)
        except ValueError:
            continue
    return state


def fingerprint_database(
    container: str, database: str, *, user: str, label: str
) -> dict[str, Any]:
    tables = [
        table_fingerprint(container, database, t, user=user)
        for t in BUSINESS_TABLES
    ]
    return {
        "label": label,
        "database": database,
        "tables": {entry["table"]: entry for entry in tables},
        "sequences": sequence_state(container, database, user=user),
    }


def database_fingerprint(target: str, *, user: str) -> dict[str, Any]:
    spec = TABLES[target]
    return fingerprint_database(
        spec["container"],
        spec["database"],
        user=user,
        label=target,
    )


def compare_fingerprints(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    diffs: list[str] = []
    for table in BUSINESS_TABLES:
        a = left["tables"].get(table, {})
        b = right["tables"].get(table, {})
        if a.get("rows") != b.get("rows") or a.get("md5") != b.get("md5"):
            diffs.append(f"{table}: {a} != {b}")
    if left.get("sequences") != right.get("sequences"):
        diffs.append(f"sequences: {left.get('sequences')} != {right.get('sequences')}")
    return {"equal": not diffs, "differences": diffs}


def media_fingerprint(upload_root: Path) -> dict[str, Any]:
    """对演练上传目录内所有常规文件取 sha256（按相对路径排序）。"""
    entries: list[dict[str, str]] = []
    if upload_root.is_dir():
        for path in sorted(upload_root.rglob("*")):
            if not path.is_file():
                continue
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            entries.append(
                {"path": path.relative_to(upload_root).as_posix(), "sha256": digest}
            )
    combined = hashlib.sha256(
        "\n".join(f"{e['path']}:{e['sha256']}" for e in entries).encode("utf-8")
    ).hexdigest()
    return {"fileCount": len(entries), "combinedSha256": combined, "files": entries}


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def write_env_file(path: Path, values: Mapping[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"{k}={v}" for k, v in values.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    print(json.dumps({"workDir": str(DEFAULT_WORK_DIR), "gitHead": git_head()}, indent=2))
