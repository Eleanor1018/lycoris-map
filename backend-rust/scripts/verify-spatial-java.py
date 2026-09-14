#!/usr/bin/env python3
"""阶段 5 原 Java JAR 兼容验收工具（离线准备；真正执行需显式指令与实际 stage5 镜像）。

设计（第三轮返工后）
    - **不自行切换**：verify-data/finalize 只核验“由已审查的 check-rehearsal.py switch 完成的当前入口”，
      显式 `--backend rust|java`；generation 由 switch 命令严格递增，工具只读取并记录实际值。
    - **真实验证**：用 bench_core.verify_single_backend / verify_target_config 做 inspect/probe，
      Java 额外要求 DB_URL 指向 pg18/up 且 `ddl-auto=validate`；不以常量结果充数。
    - **state 隔离**：只把本轮 ID/字段/证据合入 stage5 状态；**不复制**含合成口令的阶段4登录状态；
      状态损坏即失败；原子写入。
    - **SQL 正确性**：geography 用 `location::geometry` 取 ST_X/ST_Y/ST_SRID；索引匹配用小写
      `using gist`；迁移核对 success=true 与 SHA-384 checksum；SQL 出错即失败，不当作“行不存在”。
    - **秘密**：连接串只从 fixture 读入内存且不打印；migrate 用已核对不可变 imageID + `--pull never`，
      `-e DATABASE_URL` 值由父进程 env 传入。
    - 只允许回环入口与受控网络/固定 `lycoris_rehearsal_up`；DDL 前先 guard 并校验 RUST_DATABASE_URL。

子命令
    plan / self-test（离线无网络）
    check-config / configure      实际 docker image inspect，核对 stage5 imageID 与 Java JAR SHA
    baseline                      保存阶段4最新配对基线 + 业务指纹 + 媒体清单
    migrate                       冻结+停后端，用已核对 imageID --migrate --pull never 应用 0002
    verify-0002                   迁移 success/checksum、generated location、两索引、业务指纹/媒体不变
    verify-data --backend ...     核验当前入口后端（不切换）
    java-crud                     Java 真实 HTTP CRUD + location 一致（须当前确为 Java）
    finalize                      核验当前确为 Rust stage5，写 stage5-java-compatibility.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
CRATE_ROOT = SCRIPT_DIR.parent
REHEARSAL_DIR = CRATE_ROOT / "rehearsal"
if str(REHEARSAL_DIR) not in sys.path:
    sys.path.insert(0, str(REHEARSAL_DIR))

sys.dont_write_bytecode = True

import bench_core  # noqa: E402
import common  # noqa: E402
import db_rehearsal  # noqa: E402
import guard  # noqa: E402
import http_flows  # noqa: E402
import switching  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

UP_DB = "lycoris_rehearsal_up"
NETWORK = "lycoris-rust-rehearsal-net"
EXPECTED_SRID = 4326
ADMIN_USER = "rehearsal_admin"
ADMIN_PASSWORD = "RehearsalPassw0rd!"
ADMIN_SECOND = "RehearsalSecond!"
KEEP_MARKER_ID = 5005
WEB_USERNAME = "rehearsal_user_2"
WEB_SIGNATURE = "Rust stage 4 Web review"
WEB_FAVORITE_MARKER = 369
SHA384_RE = re.compile(r"^[0-9a-fA-F]{96}$")
# main 最终 0001/0002 LF 原文的 SHA-384（B 工作树没有 0002，不猜；可作为等效精确来源覆盖）。
EXPECTED_MIGRATION_SHA384 = {
    "1": "8dbe74b7a0ec1ba8a6ffe28bfefadebfb39ac223b4522fcfd90de50a4feb8bbb8421341390ac0fce84527989739c3391",
    "2": "d1262eb9356b1e99b788ddea741a191d84aa30d567b0ec106d32dcc3e3a7a236ba9d1caceede93a4bfdd30a205a35cd5",
}
LOCATION_TYPE = "geography(Point,4326)"
NAMESPACE_ENV_KEY = {"java": "SPRING_SESSION_REDIS_NAMESPACE", "rust": "SESSION_NAMESPACE"}
# state 中允许持久化的键（绝不含合成口令/整份阶段4登录状态）。
STATE_KEYS = {
    "label", "businessBefore", "mediaBefore", "businessAfter0002", "mediaAfter0002",
    "verifiedImageId", "verifiedJarSha256", "verifiedImageTag",
    "stage4RustVerified", "javaVerified", "javaCrud", "javaKept",
    "final", "generations", "failureReports",
}

BUSINESS_COLUMNS = {
    "users": [
        "id", "avatar_url", "email", "nickname", "password", "pronouns", "public_id",
        "role", "signature", "username", "deleted", "deleted_at", "session_version", "row_version",
    ],
    "map_markers": [
        "id", "category", "created_at", "description", "is_active", "is_public",
        "last_edited_by", "last_edited_by_owner", "last_edited_by_public_id", "lat", "lng",
        "mark_image", "open_time_end", "open_time_start", "review_status", "title",
        "updated_at", "user_public_id", "username", "client_request_id", "version", "source_language",
    ],
    "map_marker_translations": [
        "id", "marker_id", "language", "title", "description", "source_hash", "origin", "updated_at",
    ],
    "marker_edit_proposals": [
        "id", "category", "created_at", "description", "is_active", "is_public", "marker_id",
        "marker_lat", "marker_lng", "marker_title", "open_time_end", "open_time_start",
        "proposer_is_owner", "proposer_public_id", "proposer_username", "reviewed_at",
        "reviewed_by", "status", "title", "version", "base_marker_version", "language",
    ],
    "marker_favorites": ["id", "created_at", "marker_id", "user_public_id"],
    "marker_image_proposals": [
        "id", "created_at", "image_url", "marker_id", "marker_title", "proposer_public_id",
        "proposer_username", "reviewed_at", "reviewed_by", "status",
    ],
}


class Stage5Error(RuntimeError):
    pass


# --------------------------------------------------------------------------
# 纯逻辑（离线可测）
# --------------------------------------------------------------------------


def business_fingerprint_sql(table: str) -> str:
    if table not in BUSINESS_COLUMNS:
        raise Stage5Error(f"未知业务表 {table}")
    cols = BUSINESS_COLUMNS[table]
    if "id" not in cols or "location" in cols:
        raise Stage5Error(f"{table} 业务列不合规")
    row = ", ".join(f'"{c}"' for c in cols)
    return (
        f"SELECT count(*)::text || '|' || "
        f"COALESCE(md5(string_agg(md5(({row})::text), '' ORDER BY id)), '') "
        f'FROM public."{table}";'
    )


def validate_rust_database_url(url: str, *, user: str, password: str, name: str = "RUST_DATABASE_URL") -> dict:
    """严格校验内网固定 URL：postgres 协议、host 精确 pg18、端口 5432、库 lycoris_rehearsal_up、
    无 query/fragment/编码覆写、凭据与已校验合成配置一致。不回显连接串。"""
    if not url or not url.strip():
        raise Stage5Error(f"{name} 为空")
    value = url.strip()
    if "?" in value or "#" in value:
        raise Stage5Error(f"{name} 含 query/fragment，拒绝 host/hostaddr 覆写")
    match = re.match(r"^(postgres|postgresql)://(?P<cred>.+)@(?P<host>[^:/@]+):(?P<port>\d+)/(?P<db>[^/]+)$", value)
    if not match:
        raise Stage5Error(f"{name} 格式不合法")
    db = match.group("db")
    if "%" in value or "\\" in value or "%2f" in value.lower():
        raise Stage5Error(f"{name} 含编码覆写，拒绝")
    if match.group("host") != "pg18":
        raise Stage5Error(f"{name} host 必须是固定内网服务名 pg18")
    if match.group("port") != "5432":
        raise Stage5Error(f"{name} 端口必须是 5432")
    if db != UP_DB:
        raise Stage5Error(f"{name} 数据库必须是 {UP_DB}")
    cred = match.group("cred")
    cred_user, _, cred_pass = cred.partition(":")
    if cred_user != user or cred_pass != password:
        raise Stage5Error(f"{name} 凭据与已校验合成配置不一致")
    return {"host": "pg18", "port": 5432, "database": UP_DB}


def validate_migration_rows(rows: list[dict], expected: dict[str, str] | None = None) -> None:
    expected = expected or EXPECTED_MIGRATION_SHA384
    versions = [r.get("version") for r in rows]
    if versions != [1, 2]:
        raise Stage5Error(f"期望 _sqlx_migrations versions=[1,2]，实际 {versions}")
    for row in rows:
        if row.get("success") is not True:
            raise Stage5Error(f"迁移 version={row.get('version')} success != true")
        checksum = str(row.get("checksum", ""))
        if not SHA384_RE.match(checksum):
            raise Stage5Error(f"迁移 version={row.get('version')} checksum 非 SHA-384 hex")
        want = expected.get(str(row.get("version")))
        if not want or checksum.lower() != want.lower():
            raise Stage5Error(f"迁移 version={row.get('version')} checksum 与 0001/0002 原文 SHA-384 不一致")


def parse_migration_line(line: str) -> dict | None:
    """解析 `version|success|hex`；psql 布尔文本为 true/false（兼容 t/f）。"""
    version, _, rest = line.strip().partition("|")
    success_text, _, checksum = rest.partition("|")
    if not version.isdigit():
        return None
    success = success_text.strip().lower() in ("true", "t", "1")
    return {"version": int(version), "success": success, "checksum": checksum.strip()}


def namespace_env_key(backend: str) -> str:
    return NAMESPACE_ENV_KEY[backend]


def parse_generation(namespace: str) -> int | None:
    match = re.search(r":g(\d+)$", namespace or "")
    return int(match.group(1)) if match else None


def validate_backend_identity(
    backend: str,
    *,
    config_image_id: str | None,
    verified_image_id: str | None,
    verified_jar_sha256: str | None,
    actual_jar_sha256: str | None,
) -> None:
    """Rust 核对 stage5 镜像 ID；Java 不比对 stage5 镜像，改核对运行容器 /app/app.jar SHA。"""
    if backend == "rust":
        if not verified_image_id or config_image_id != verified_image_id:
            raise Stage5Error("当前 Rust 镜像 ID 与已核对 stage5 imageID 不符")
    else:
        if not verified_jar_sha256 or not actual_jar_sha256:
            raise Stage5Error("缺少 Java JAR SHA 证据（运行容器 /app/app.jar）")
        if actual_jar_sha256.lower() != verified_jar_sha256.lower():
            raise Stage5Error("运行容器 /app/app.jar SHA256 与已验证原 JAR 不符")


def is_exact_location_type(coltype: str) -> bool:
    return coltype.strip() == LOCATION_TYPE


def check_index_defs(defs: list[str]) -> list[str]:
    """两索引：GiST(location non-null) 与 legacy-null，均 partial 且公开+APPROVED。"""
    missing = []
    gist = [
        d for d in defs
        if "using gist" in d.lower() and "location" in d.lower()
        and "is_public" in d.lower() and "approved" in d.lower()
        and "location is not null" in d.lower()
    ]
    legacy = [
        d for d in defs
        if "location is null" in d.lower() and "is_public" in d.lower() and "approved" in d.lower()
    ]
    if not gist:
        missing.append("GiST partial(public, APPROVED, location IS NOT NULL)")
    if not legacy:
        missing.append("legacy partial(public, APPROVED, location IS NULL)")
    return missing


def has_gist_location(index_defs: list[str]) -> bool:
    return any("using gist" in d.lower() and "location" in d.lower() for d in index_defs)


def matches_def(index_defs: list[str], needles: list[str]) -> list[str]:
    missing = []
    for needle in needles:
        if not any(needle.lower() in d.lower() for d in index_defs):
            missing.append(needle)
    return missing


def sha256_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_expected_hash(name: str, actual: str | None, expected: str | None) -> str:
    if not actual:
        raise Stage5Error(f"{name} 不存在或不可读")
    if expected and actual.lower() != expected.lower():
        raise Stage5Error(f"{name} hash 不匹配（期望 {expected[:12]}…，实际 {actual[:12]}…）")
    return actual


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    index = 2
    while path.with_name(f"{path.stem}-{index}{path.suffix}").exists():
        index += 1
    return path.with_name(f"{path.stem}-{index}{path.suffix}")


def merge_state(existing: dict, incoming: dict) -> dict:
    for key in incoming:
        if key not in STATE_KEYS:
            raise Stage5Error(f"拒绝写入非白名单 state 键：{key}")
    merged = dict(existing)
    merged.update(incoming)
    return merged


def assert_prereqs(state: dict, required: list[str]) -> None:
    missing = [k for k in required if not state.get(k)]
    if missing:
        raise Stage5Error(f"缺少前置阶段证据：{missing}")


# --------------------------------------------------------------------------
# 上下文
# --------------------------------------------------------------------------


class Ctx:
    def __init__(self, work_dir: Path):
        self.work_dir = work_dir.resolve()
        self.env_path = self.work_dir / ".env"
        self.env: dict[str, str] = {}
        self.report = common.Report(step="stage5", work_dir=self.work_dir)

    def load(self) -> dict[str, str]:
        self.env = common.read_env_file(self.env_path)
        return self.env

    def guard(self, *, require_rust_url: bool = False) -> dict[str, object]:
        if not self.env:
            self.load()
        if not self.env:
            raise Stage5Error("缺少演练 .env")
        targets = guard.verify_environment(self.env)
        pg18 = targets["pg18"]
        if pg18.database != UP_DB or pg18.port != guard.PG18_PORT:
            raise Stage5Error("阶段5 只允许 PG18 固定 up 合成库")
        user = guard.assert_synthetic_credential(self.env.get("PG_REHEARSAL_USER", ""), name="PG_REHEARSAL_USER")
        password = guard.assert_synthetic_credential(self.env.get("PG_REHEARSAL_PASSWORD", ""), name="PG_REHEARSAL_PASSWORD")
        result: dict[str, object] = {"user": user, "password": password, "targets": targets}
        if require_rust_url:
            result["rustDb"] = validate_rust_database_url(
                self.env.get("RUST_DATABASE_URL", ""), user=user, password=password
            )
        return result

    def pg18(self) -> tuple[str, str, str]:
        return common.PG18_CONTAINER, UP_DB, self.env["PG_REHEARSAL_USER"]

    def artifact_path(self, name: str) -> Path:
        return self.work_dir / "artifacts" / name

    def load_state(self) -> dict:
        path = self.artifact_path("stage5-compat.json")
        if not path.is_file():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise Stage5Error("stage5 状态文件损坏，拒绝继续") from exc
        if not isinstance(data, dict):
            raise Stage5Error("stage5 状态文件结构非法")
        return data

    def save_state(self, incoming: dict) -> dict:
        current = self.load_state()
        merged = merge_state(current, incoming)
        path = self.artifact_path("stage5-compat.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".stage5-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(merged, handle, ensure_ascii=False, indent=2, sort_keys=True)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return merged

    def failure_reports(self) -> dict[str, list[str]]:
        """按实际状态归类，成功报告不算失败；损坏文件单列。"""
        result: dict[str, list[str]] = {"failed": [], "blocked": [], "unparsable": []}
        reports = self.work_dir / "reports"
        if not reports.is_dir():
            return result
        for path in sorted(reports.glob("stage5-*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                result["unparsable"].append(path.name)
                continue
            status = data.get("status")
            if status == "failed":
                result["failed"].append(path.name)
            elif status == "blocked":
                result["blocked"].append(path.name)
        return result


def _load_stage4_state(ctx: Ctx) -> dict:
    path = ctx.work_dir / "artifacts" / "flow_state.json"
    if not path.is_file():
        raise Stage5Error("缺少阶段4 flow_state.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise Stage5Error("阶段4 flow_state 损坏") from exc
    if not isinstance(data, dict):
        raise Stage5Error("阶段4 flow_state 结构非法")
    return data


def _stage4_credentials_in_memory(flow_state: dict) -> dict:
    """仅供进程内 HTTP 核对使用；绝不写入 stage5 state/报告。"""
    needed = {}
    for key in ("newUser", "rustMarker", "translation", "media", "mediaHashes", "favoriteMarkerId", "javaBaseline"):
        if key in flow_state:
            needed[key] = flow_state[key]
    if not (needed.get("newUser") or {}).get("username"):
        raise Stage5Error("阶段4 flow_state 缺少 Rust 新用户凭据")
    return needed


# --------------------------------------------------------------------------
# 真实容器核验
# --------------------------------------------------------------------------


def _container_env(container: str) -> dict[str, str]:
    result = common.run(["docker", "inspect", "--format", "{{json .Config.Env}}", container], check=False, timeout=30)
    if result.returncode != 0:
        raise Stage5Error(f"无法 inspect 容器 {container}")
    try:
        entries = json.loads(result.stdout.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        raise Stage5Error("容器 env 解析失败") from exc
    env: dict[str, str] = {}
    for entry in entries or []:
        key, _, value = entry.partition("=")
        env[key] = value
    return env


def _container_jar_sha256(container: str) -> str:
    result = common.docker_exec(container, ["sha256sum", "/app/app.jar"], check=False, timeout=30)
    if result.returncode != 0:
        raise Stage5Error("无法在 Java 容器内计算 /app/app.jar SHA256（拒绝放行）")
    raw = result.stdout.decode("utf-8", errors="replace").strip()
    token = raw.split()[0] if raw else ""
    if not SHA384_RE.match(token) and not re.match(r"^[0-9a-fA-F]{64}$", token):
        raise Stage5Error("Java 容器内 JAR SHA256 解析失败")
    return token


def verify_current_backend(
    ctx: Ctx, backend: str, *, verified_image_id: str | None, verified_jar_sha256: str | None = None
) -> dict[str, object]:
    """核验当前入口/运行容器真实为指定后端（不切换、不写常量）。"""
    entry = ctx.env.get("ENTRY_URL", "http://127.0.0.1:18180")
    single = bench_core.verify_single_backend(backend, entry, ctx.work_dir)
    container = bench_core.BACKEND_CONTAINER[backend]
    config = bench_core.verify_target_config(
        container, backend, "on", user=ctx.env.get("PG_REHEARSAL_USER", "")
    )
    env = _container_env(container)
    db_url = env.get("DB_URL", "") if backend == "java" else env.get("DATABASE_URL", "")
    if "pg18:5432/lycoris_rehearsal_up" not in db_url:
        raise Stage5Error(f"当前 {backend} 未连接 pg18/lycoris_rehearsal_up")
    actual_jar_sha = None
    if backend == "java":
        if env.get("SPRING_JPA_HIBERNATE_DDL_AUTO") != "validate":
            raise Stage5Error("当前 Java ddl-auto 不是 validate")
        actual_jar_sha = _container_jar_sha256(container)
    validate_backend_identity(
        backend,
        config_image_id=config.get("imageId"),
        verified_image_id=verified_image_id,
        verified_jar_sha256=verified_jar_sha256,
        actual_jar_sha256=actual_jar_sha,
    )
    namespace = env.get(namespace_env_key(backend), "")
    generation = parse_generation(namespace)
    if generation is None:
        raise Stage5Error(f"未能从 {namespace_env_key(backend)} 解析实际代次")
    return {
        "backend": backend,
        "singleBackend": single,
        "imageId": config.get("imageId"),
        "imageTag": config.get("imageTag"),
        "containerUser": config.get("user"),
        "jarSha256": actual_jar_sha,
        "namespace": namespace,
        "generation": generation,
    }


# --------------------------------------------------------------------------
# SQL
# --------------------------------------------------------------------------


def _business_fingerprint(ctx: Ctx, user: str) -> dict[str, object]:
    container, database, _ = ctx.pg18()
    tables: dict[str, dict[str, object]] = {}
    for table in BUSINESS_COLUMNS:
        raw = common.psql(container, database, business_fingerprint_sql(table), user=user).strip()
        rows_text, _, checksum = raw.partition("|")
        tables[table] = {"rows": int(rows_text or 0), "md5": checksum}
    return {"tables": tables, "sequences": common.sequence_state(container, database, user=user)}


def compare_business(before: dict, after: dict) -> dict[str, object]:
    diffs: list[str] = []
    for table in BUSINESS_COLUMNS:
        a = (before.get("tables") or {}).get(table, {})
        b = (after.get("tables") or {}).get(table, {})
        if a.get("rows") != b.get("rows") or a.get("md5") != b.get("md5"):
            diffs.append(f"{table}: {a} != {b}")
    if before.get("sequences") != after.get("sequences"):
        diffs.append("sequences 变化")
    return {"equal": not diffs, "differences": diffs}


def _marker_location(ctx: Ctx, marker_id: int, user: str) -> dict[str, object]:
    container, database, _ = ctx.pg18()
    raw = common.psql(
        container, database,
        f"SELECT ST_X(location::geometry), ST_Y(location::geometry), ST_SRID(location::geometry) "
        f"FROM public.map_markers WHERE id = {int(marker_id)};",
        user=user, check=True, timeout=30,
    ).strip()
    x, _, rest = raw.partition("|")
    y, _, srid = rest.partition("|")
    if not (x and y and srid):
        raise Stage5Error(f"点位 {marker_id} 的 location 读取为空（SQL 失败不得当作不存在）")
    return {"x": float(x), "y": float(y), "srid": int(srid)}


def _marker_row_exists(ctx: Ctx, marker_id: int, user: str) -> bool:
    container, database, _ = ctx.pg18()
    raw = common.psql(
        container, database,
        f"SELECT count(*) FROM public.map_markers WHERE id = {int(marker_id)};",
        user=user, check=True, timeout=30,
    )
    return raw.strip() == "1"


# --------------------------------------------------------------------------
# 步骤
# --------------------------------------------------------------------------


def cmd_plan(ctx: Ctx, args: argparse.Namespace) -> int:
    for line in [
        "plan/self-test   离线无网络",
        "check-config/configure  docker image inspect 核对 stage5 imageID + Java JAR SHA（非纯离线）",
        "baseline   唯一 label 快照 + 业务指纹 + 媒体清单",
        "migrate    freeze+停后端；已核对 imageID --migrate --pull never（先校验 RUST_DATABASE_URL）",
        "verify-0002  迁移 success/SHA384、location::geometry、GiST+legacyNULL 索引、业务指纹/媒体不变",
        "verify-data --backend rust|java  仅核验当前入口（switch 由 check-rehearsal.py 完成）",
        "java-crud  确认当前为 Java PG18 validate 后真实 HTTP CRUD + location 一致",
        "finalize   确认当前为 Rust stage5，nearby 读取 Java 保留点位并写兼容报告",
    ]:
        print(line)
    return 0


def cmd_self_test(argv: list[str] | None = None) -> int:
    import unittest

    tests_dir = REHEARSAL_DIR / "tests"
    if str(tests_dir) not in sys.path:
        sys.path.insert(0, str(tests_dir))
    suite = unittest.TestLoader().discover(str(tests_dir), pattern="test_verify_spatial_java.py")
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


def _inspect_image_id(image: str) -> str:
    result = common.run(
        ["docker", "image", "inspect", image, "--format", "{{.Id}}"], check=False, timeout=30
    )
    if result.returncode != 0:
        raise Stage5Error(f"找不到镜像 {image}")
    return result.stdout.decode("utf-8", errors="replace").strip()


def _verify_artifacts(ctx: Ctx, *, rust_image: str, expected_image_id: str, jar: str, expected_jar: str) -> dict:
    if not rust_image:
        raise Stage5Error("缺少 stage5 Rust 镜像标签")
    actual_id = _inspect_image_id(rust_image)
    assert_expected_hash("Rust 镜像 ID", actual_id, expected_image_id)
    jar_path = Path(jar).resolve() if jar else None
    jar_sha = assert_expected_hash("Java JAR", sha256_file(jar_path) if jar_path else None, expected_jar)
    return {"imageTag": rust_image, "imageId": actual_id, "jarPath": str(jar_path), "jarSha256": jar_sha}


def cmd_check_config(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.report = common.Report(step="stage5-configure", work_dir=ctx.work_dir)
    try:
        ctx.guard()
        info = _verify_artifacts(
            ctx, rust_image=args.rust_image or ctx.env.get("RUST_REHEARSAL_IMAGE", ""),
            expected_image_id=args.rust_image_id or "", jar=args.java_jar or ctx.env.get("JAVA_JAR_PATH", ""),
            expected_jar=args.jar_sha256 or "",
        )
        report.add("actual", info)
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        print(f"[stage5] FAIL: {exc}", file=sys.stderr)
        return 1
    path = report.write()
    print(f"[stage5] check-config OK imageId={report.facts['actual']['imageId'][:12]}… -> {path}")
    return 0


def cmd_configure(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.report = common.Report(step="stage5-configure", work_dir=ctx.work_dir)
    try:
        ctx.guard()
        info = _verify_artifacts(
            ctx, rust_image=args.rust_image, expected_image_id=args.rust_image_id,
            jar=args.java_jar, expected_jar=args.jar_sha256,
        )
        env_values = common.read_env_file(ctx.env_path)
        env_values["RUST_REHEARSAL_IMAGE"] = args.rust_image
        env_values["JAVA_JAR_PATH"] = info["jarPath"]
        common.write_env_file(ctx.env_path, env_values)
        ctx.env = env_values
        ctx.save_state({
            "verifiedImageTag": info["imageTag"],
            "verifiedImageId": info["imageId"],
            "verifiedJarSha256": info["jarSha256"],
        })
        report.add("actual", info)
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        print(f"[stage5] FAIL: {exc}", file=sys.stderr)
        return 1
    path = report.write()
    print(f"[stage5] configure OK imageId={report.facts['actual']['imageId'][:12]}… -> {path}")
    return 0


def cmd_baseline(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.report = common.Report(step="stage5-baseline", work_dir=ctx.work_dir)
    try:
        info = ctx.guard()
        user = str(info["user"])
        if not args.label:
            raise Stage5Error("需要唯一 --label")
        db_rehearsal.run_snapshot_baseline(work_dir=ctx.work_dir, user=user, report=report, label=args.label)
        before = _business_fingerprint(ctx, user)
        media = common.media_fingerprint(ctx.work_dir / "uploads")
        ctx.save_state({
            "label": args.label,
            "businessBefore": before,
            "mediaBefore": {"fileCount": media["fileCount"], "combinedSha256": media["combinedSha256"]},
        })
        report.add("businessBefore", {t: v["rows"] for t, v in before["tables"].items()})
        report.add("mediaBefore", {"fileCount": media["fileCount"], "combinedSha256": media["combinedSha256"]})
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        print(f"[stage5] FAIL: {exc}", file=sys.stderr)
        return 1
    path = report.write()
    print(f"[stage5] baseline OK label={args.label} -> {path}")
    return 0


def cmd_migrate(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.report = common.Report(step="stage5-migrate", work_dir=ctx.work_dir)
    frozen = False
    try:
        info = ctx.guard(require_rust_url=True)
        state = ctx.load_state()
        assert_prereqs(state, ["label", "businessBefore", "mediaBefore", "verifiedImageId"])
        # 冻结/停机前：只读预检快照完整性（不 restore），并再次核对不可变镜像。
        db_rehearsal.preflight_restore(ctx.work_dir, str(state["label"]))
        report.add("snapshotPreflight", True)
        image_id = _inspect_image_id(str(state["verifiedImageId"]))
        assert_expected_hash("Rust 镜像 ID", image_id, str(state["verifiedImageId"]))
        switching.freeze_entry(ctx.work_dir)
        frozen = True
        for backend in ("java", "rust"):
            switching.stop_backend(ctx.work_dir, backend)
        # 用已核对不可变 imageID + --pull never；DATABASE_URL 值由父进程 env 传入。
        result = common.run(
            [
                "docker", "run", "--rm", "--pull", "never", "--network", NETWORK,
                "--user", "10001:10001", "-e", "DATABASE_URL", "-e", "REDIS_URL",
                str(state["verifiedImageId"]), "--migrate",
            ],
            env={
                "DATABASE_URL": ctx.env.get("RUST_DATABASE_URL", ""),
                "REDIS_URL": ctx.env.get("RUST_REDIS_URL", "redis://redis:6379"),
            },
            check=False, timeout=300,
        )
        report.add("migrateExit", result.returncode)
        out_text = (result.stdout or b"").decode("utf-8", errors="replace")[:4000]
        err_text = (result.stderr or b"").decode("utf-8", errors="replace")[:4000]
        report.add("migrateStdout", out_text)
        report.add("migrateStderr", err_text)
        if result.returncode != 0:
            print(f"[stage5] migrate exit={result.returncode}\n{out_text}\n{err_text}", file=sys.stderr)
            raise Stage5Error("--migrate 未成功；入口保持冻结，不启动旧 stage4 Rust")
        report.add("frozen", True)
    except Exception as exc:  # noqa: BLE001
        report.add("frozen", frozen)
        report.fail(str(exc))
        report.write()
        print(f"[stage5] FAIL: {exc}", file=sys.stderr)
        return 1
    path = report.write()
    print(f"[stage5] migrate OK -> {path}")
    return 0


def _migration_rows(ctx: Ctx, user: str) -> list[dict]:
    container, database, _ = ctx.pg18()
    raw = common.psql(
        container, database,
        "SELECT version || '|' || success || '|' || encode(checksum, 'hex') "
        "FROM _sqlx_migrations ORDER BY version;",
        user=user, check=True, timeout=30,
    )
    rows = [r for r in (parse_migration_line(line) for line in raw.splitlines()) if r]
    return rows


def _location_info(ctx: Ctx, user: str) -> dict[str, object]:
    container, database, _ = ctx.pg18()
    raw = common.psql(
        container, database,
        "SELECT attgenerated::text || '|' || format_type(atttypid, atttypmod) FROM pg_attribute "
        "WHERE attrelid = 'public.map_markers'::regclass AND attname = 'location';",
        user=user, check=True, timeout=30,
    ).strip()
    generated, _, coltype = raw.partition("|")
    indexes = common.psql(
        container, database,
        "SELECT indexname || '|' || indexdef FROM pg_indexes "
        "WHERE tablename = 'map_markers' AND indexdef ILIKE '%location%';",
        user=user, check=True, timeout=30,
    )
    defs = [line.strip() for line in indexes.splitlines() if line.strip()]
    return {"generated": generated, "type": coltype, "indexes": defs}


def cmd_verify_0002(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.report = common.Report(step="stage5-verify-0002", work_dir=ctx.work_dir)
    try:
        info = ctx.guard()
        user = str(info["user"])
        state = ctx.load_state()
        assert_prereqs(state, ["label", "businessBefore", "mediaBefore"])
        rows = _migration_rows(ctx, user)
        expected = dict(EXPECTED_MIGRATION_SHA384)
        for spec in args.expect_checksum or []:
            version_text, _, value = spec.partition("=")
            if version_text not in ("1", "2") or not SHA384_RE.match(value):
                raise Stage5Error("--expect-checksum 需形如 1=<96hex> 或 2=<96hex>")
            expected[version_text] = value
        validate_migration_rows(rows, expected)
        loc = _location_info(ctx, user)
        if loc["generated"] != "s" or not is_exact_location_type(str(loc["type"])):
            raise Stage5Error(f"location 生成列不符（要求 {LOCATION_TYPE}）：{loc}")
        defs = list(loc["indexes"])
        missing = check_index_defs(defs)
        if missing:
            raise Stage5Error(f"索引定义不符：{missing}")
        for spec in args.expect_index_name or []:
            if not any(d.partition("|")[0] == spec for d in defs):
                raise Stage5Error(f"缺少期望索引名 {spec}")
        after = _business_fingerprint(ctx, user)
        comparison = compare_business(state["businessBefore"], after)
        media = common.media_fingerprint(ctx.work_dir / "uploads")
        if not comparison["equal"]:
            raise Stage5Error("0002 后业务指纹/序列变化：" + "; ".join(comparison["differences"]))
        if state["mediaBefore"]["combinedSha256"] != media["combinedSha256"]:
            raise Stage5Error("0002 后媒体指纹变化")
        ctx.save_state({
            "businessAfter0002": after,
            "mediaAfter0002": {"fileCount": media["fileCount"], "combinedSha256": media["combinedSha256"]},
        })
        report.add("migrationRows", rows)
        report.add("locationColumn", loc)
        report.add("businessComparison", comparison)
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        print(f"[stage5] FAIL: {exc}", file=sys.stderr)
        return 1
    path = report.write()
    print(f"[stage5] verify-0002 OK -> {path}")
    return 0


def cmd_verify_data(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.report = common.Report(step=f"stage5-verify-data-{args.backend}", work_dir=ctx.work_dir)
    try:
        ctx.guard()
        if args.backend not in ("rust", "java"):
            raise Stage5Error("--backend 必须是 rust 或 java")
        state = ctx.load_state()
        assert_prereqs(state, ["label", "businessAfter0002"])
        backend_facts = verify_current_backend(
            ctx, args.backend,
            verified_image_id=state.get("verifiedImageId"),
            verified_jar_sha256=state.get("verifiedJarSha256"),
        )
        if args.expect_generation is not None and backend_facts.get("generation") != args.expect_generation:
            raise Stage5Error(f"实际 generation {backend_facts.get('generation')} != 期望 {args.expect_generation}")
        flow = _load_stage4_state(ctx)
        creds = _stage4_credentials_in_memory(flow)
        entry = ctx.env.get("ENTRY_URL", "http://127.0.0.1:18180")
        client = http_flows.Client(entry)
        verified = http_flows._verify_rust_writes(client, creds, where=f"{args.backend}(stage5)")
        key = "stage4RustVerified" if args.backend == "rust" else "javaVerified"
        gens = dict(state.get("generations") or {})
        gens[args.backend] = backend_facts.get("generation")
        ctx.save_state({key: {"backendFacts": backend_facts, "verified": verified}, "generations": gens})
        report.add("backendFacts", backend_facts)
        report.add("verified", verified)
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        print(f"[stage5] FAIL: {exc}", file=sys.stderr)
        return 1
    path = report.write()
    print(f"[stage5] verify-data({args.backend}) OK -> {path}")
    return 0


def _nearby_ids(client, *, lat: float, lng: float, radius: int, category: str) -> list[int]:
    resp = client.request("GET", f"/api/markers/nearby?lat={lat}&lng={lng}&radius={radius}&category={category}")
    http_flows._expect(resp, {200}, "匿名 nearby")
    payload = resp.json() or []
    return [m.get("id") for m in payload if isinstance(m, dict)]


def cmd_java_crud(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.report = common.Report(step="stage5-java-crud", work_dir=ctx.work_dir)
    try:
        ctx.guard()
        state = ctx.load_state()
        assert_prereqs(state, ["label", "businessAfter0002", "javaVerified"])
        backend_facts = verify_current_backend(
            ctx, "java",
            verified_image_id=state.get("verifiedImageId"),
            verified_jar_sha256=state.get("verifiedJarSha256"),
        )
        flow = _load_stage4_state(ctx)
        creds = _stage4_credentials_in_memory(flow)
        entry = ctx.env.get("ENTRY_URL", "http://127.0.0.1:18180")
        user = http_flows.Client(entry)
        admin = http_flows.Client(entry)
        anon = http_flows.Client(entry)
        http_flows._login(user, creds["newUser"]["username"], creds["newUser"]["password"])
        http_flows._login(admin, ADMIN_USER, ADMIN_PASSWORD)
        http_flows._admin_second_factor(admin, ADMIN_SECOND)
        import time as _time

        stamp = str(int(_time.time()))
        lat, lng = 31.2401, 121.4901
        category = "friendly_clinic"
        kept = http_flows._create_marker(user, lat=lat, lng=lng, title=f"Stage5 Java kept {stamp}")
        approve = admin.request("POST", f"/api/admin/markers/{kept}/approve")
        http_flows._expect(approve, {200}, "管理员审批新建点位")
        detail = http_flows._get_marker(anon, kept)
        if detail.get("title") != f"Stage5 Java kept {stamp}":
            raise Stage5Error("匿名公开查询标题与创建不一致")
        loc = _marker_location(ctx, kept, ctx.env["PG_REHEARSAL_USER"])
        if abs(loc["x"] - lng) > 1e-9 or abs(loc["y"] - lat) > 1e-9 or loc["srid"] != EXPECTED_SRID:
            raise Stage5Error(f"location 与 HTTP lat/lng 不一致：{loc}")
        resp = user.request(
            "PATCH", f"/api/markers/{kept}",
            json_body={"title": f"Stage5 Java edited {stamp}", "category": category, "isPublic": True, "language": "zh"},
        )
        http_flows._expect(resp, {200}, "PATCH 点位字段")
        http_flows._approve_latest_edit(admin, kept, language="zh")
        detail = http_flows._get_marker(anon, kept)
        if detail.get("title") != f"Stage5 Java edited {stamp}" or detail.get("category") != category or detail.get("isPublic") is not True:
            raise Stage5Error(f"修改后公开字段不一致：{detail}")
        if kept not in _nearby_ids(anon, lat=lat, lng=lng, radius=1000, category=category):
            raise Stage5Error("nearby 未按修改后类别发现保留点位")
        if kept in _nearby_ids(anon, lat=lat, lng=lng, radius=1000, category="accessible_toilet"):
            raise Stage5Error("保留点位仍出现在旧类别结果中")
        # 仅本轮点位：审批响应必须 200 才删除，随后 HTTP 详情 404、SQL 0、nearby 排除。
        throwaway = http_flows._create_marker(user, lat=31.2402, lng=121.4902, title=f"Stage5 Java throwaway {stamp}")
        t_approve = admin.request("POST", f"/api/admin/markers/{throwaway}/approve")
        http_flows._expect(t_approve, {200}, "审批仅本轮点位")
        deleted = user.request("DELETE", f"/api/markers/{throwaway}")
        http_flows._expect(deleted, {200}, "删除仅本轮点位")
        gone = anon.request("GET", f"/api/markers/{throwaway}")
        if gone.status != 404:
            raise Stage5Error(f"删除后 HTTP 详情非 404：{gone.status}")
        if _marker_row_exists(ctx, throwaway, ctx.env["PG_REHEARSAL_USER"]):
            raise Stage5Error("删除后数据库仍存在该点位")
        if throwaway in _nearby_ids(anon, lat=31.2402, lng=121.4902, radius=200, category="accessible_toilet"):
            raise Stage5Error("删除后 nearby 仍包含该点位")
        loc = _marker_location(ctx, kept, ctx.env["PG_REHEARSAL_USER"])
        ctx.save_state({
            "javaCrud": {
                "backendFacts": backend_facts,
                "crudResponses": {"create": 200, "approve": 200, "patch": 200, "approveEdit": 200},
                "throwaway": {"id": throwaway, "approve": 200, "delete": 200, "httpAfterDelete": gone.status},
            },
            "javaKept": {
                "id": kept, "title": f"Stage5 Java edited {stamp}", "category": category,
                "lat": lat, "lng": lng, "location": loc,
            },
        })
        report.add("keptMarkerId", kept)
        report.add("location", loc)
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        print(f"[stage5] FAIL: {exc}", file=sys.stderr)
        return 1
    path = report.write()
    print(f"[stage5] java-crud OK kept={report.facts.get('keptMarkerId')} -> {path}")
    return 0


def cmd_finalize(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.report = common.Report(step="stage5-finalize", work_dir=ctx.work_dir)
    try:
        ctx.guard()
        state = ctx.load_state()
        assert_prereqs(state, ["label", "businessAfter0002", "stage4RustVerified", "javaVerified", "javaCrud", "javaKept"])
        kept = state["javaKept"]
        facts = verify_current_backend(
            ctx, "rust",
            verified_image_id=state.get("verifiedImageId"),
            verified_jar_sha256=state.get("verifiedJarSha256"),
        )
        if args.expect_generation is not None and facts.get("generation") != args.expect_generation:
            raise Stage5Error(f"最终 Rust generation {facts.get('generation')} != 期望 {args.expect_generation}")
        if not state.get("generations", {}).get("java"):
            raise Stage5Error("缺少 Java 阶段 generation 记录")
        entry = ctx.env.get("ENTRY_URL", "http://127.0.0.1:18180")
        anon = http_flows.Client(entry)
        # 真实重跑阶段4 Rust 写入核对（新用户新密码登录/中英文/媒体/收藏），不复制旧证据。
        flow = _load_stage4_state(ctx)
        creds = _stage4_credentials_in_memory(flow)
        rust_client = http_flows.Client(entry)
        reverified = http_flows._verify_rust_writes(rust_client, creds, where="Rust(stage5-final)")
        ids = _nearby_ids(anon, lat=kept["lat"], lng=kept["lng"], radius=1000, category=kept["category"])
        if kept["id"] not in ids:
            raise Stage5Error("Rust stage5 nearby 未发现 Java 保留点位（类别/可见性不符）")
        detail = http_flows._get_marker(anon, kept["id"])
        for field, expected_value in (
            ("title", kept["title"]), ("category", kept["category"]), ("isPublic", True),
        ):
            if detail.get(field) != expected_value:
                raise Stage5Error(f"Java 保留点位字段 {field} 不一致：{detail.get(field)!r}")
        loc = _marker_location(ctx, kept["id"], ctx.env["PG_REHEARSAL_USER"])
        if abs(loc["x"] - kept["lng"]) > 1e-9 or abs(loc["y"] - kept["lat"]) > 1e-9 or loc["srid"] != EXPECTED_SRID:
            raise Stage5Error(f"Java 保留点位 location 与保存值不符：{loc}")
        if not _marker_row_exists(ctx, KEEP_MARKER_ID, ctx.env["PG_REHEARSAL_USER"]):
            raise Stage5Error(f"原 marker {KEEP_MARKER_ID} 不存在")
        container, database, _ = ctx.pg18()
        public_id = common.psql(
            container, database,
            f"SELECT public_id FROM public.users WHERE username = '{WEB_USERNAME}';",
            user=ctx.env["PG_REHEARSAL_USER"], check=True, timeout=30,
        ).strip()
        if not public_id:
            raise Stage5Error(f"未找到 Web 合成用户 {WEB_USERNAME}")
        web_sig = common.psql(
            container, database,
            f"SELECT signature FROM public.users WHERE public_id = '{public_id}';",
            user=ctx.env["PG_REHEARSAL_USER"], check=True, timeout=30,
        ).strip()
        if web_sig != WEB_SIGNATURE:
            raise Stage5Error(f"Web 用户2 签名不符：{web_sig!r}")
        web_fav = common.psql(
            container, database,
            f"SELECT count(*) FROM public.marker_favorites WHERE marker_id = {WEB_FAVORITE_MARKER} "
            f"AND user_public_id = '{public_id}';",
            user=ctx.env["PG_REHEARSAL_USER"], check=True, timeout=30,
        ).strip()
        if int(web_fav) < 1:
            raise Stage5Error(f"Web 用户2 收藏 {WEB_FAVORITE_MARKER} 不存在")
        media = common.media_fingerprint(ctx.work_dir / "uploads")
        if state["mediaBefore"]["combinedSha256"] != media["combinedSha256"]:
            raise Stage5Error("最终媒体指纹与基线不一致")
        result = {
            "snapshotLabel": state["label"],
            "verifiedImageId": state.get("verifiedImageId"),
            "verifiedJarSha256": state.get("verifiedJarSha256"),
            "migrationVersions": "1,2",
            "businessBefore": state["businessBefore"],
            "businessAfter0002": state["businessAfter0002"],
            "mediaBefore": state["mediaBefore"],
            "mediaAfter": {"fileCount": media["fileCount"], "combinedSha256": media["combinedSha256"]},
            "stage4RustVerified": state["stage4RustVerified"],
            "javaVerified": state["javaVerified"],
            "javaCrud": state["javaCrud"],
            "javaKept": kept,
            "reverifiedRustStage5": reverified,
            "final": {"backend": "rust", "database": UP_DB, "imageId": facts.get("imageId"),
                      "jarSha256": facts.get("jarSha256"),
                      "generation": facts.get("generation"), "namespace": facts.get("namespace")},
            "webUser2": {"publicId": public_id, "signature": web_sig, "favorite369": int(web_fav)},
            "marker5005Exists": _marker_row_exists(ctx, KEEP_MARKER_ID, ctx.env["PG_REHEARSAL_USER"]),
            "failureReports": ctx.failure_reports(),
            "note": "坐标 HTTP 编辑不在本轮范围（Java MarkerUpdateRequest 无 lat/lng）；自动派生由 C 的真实 SQL 回归覆盖",
        }
        ctx.save_state({"final": result})
        out = unique_path(ctx.work_dir / "reports" / "stage5-java-compatibility.json")
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
        report.artifact("compatibility", out)
        if args.compat_out:
            repo_out = Path(args.compat_out)
            repo_out.parent.mkdir(parents=True, exist_ok=True)
            repo_out = unique_path(repo_out)
            repo_out.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
            report.artifact("compatibilityCopy", repo_out)
        if args.reports_out:
            import shutil

            dest = Path(args.reports_out)
            dest.mkdir(parents=True, exist_ok=True)
            copied = []
            for src in sorted((ctx.work_dir / "reports").glob("stage5-*.json")):
                target = dest / src.name
                shutil.copy2(src, target)
                copied.append(target.name)
            report.add("copiedReports", copied)
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        print(f"[stage5] FAIL: {exc}", file=sys.stderr)
        return 1
    path = report.write()
    print(f"[stage5] finalize OK -> {path}")
    return 0


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="阶段5 原 Java JAR 兼容验收工具")
    parser.add_argument("--work-dir", type=Path, default=common.DEFAULT_WORK_DIR)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("plan", help="打印步骤计划（离线无网络）").set_defaults(func=cmd_plan)
    sub.add_parser("self-test", help="纯逻辑离线测试").set_defaults(func=cmd_self_test)

    p = sub.add_parser("check-config", help="docker inspect 核对 imageID/JAR（非纯离线）")
    p.add_argument("--rust-image")
    p.add_argument("--rust-image-id")
    p.add_argument("--java-jar")
    p.add_argument("--jar-sha256")
    p.set_defaults(func=cmd_check_config)

    p = sub.add_parser("configure", help="核对并写入 stage5 镜像/JAR")
    p.add_argument("--rust-image", required=True)
    p.add_argument("--rust-image-id", required=True)
    p.add_argument("--java-jar", required=True)
    p.add_argument("--jar-sha256", required=True)
    p.set_defaults(func=cmd_configure)

    p = sub.add_parser("baseline", help="保存阶段4最新配对基线 + 业务指纹")
    p.add_argument("--label", required=True)
    p.set_defaults(func=cmd_baseline)

    sub.add_parser("migrate", help="冻结+停后端，已核对 imageID --migrate --pull never").set_defaults(func=cmd_migrate)

    p = sub.add_parser("verify-0002", help="迁移 success/checksum/generated/索引/指纹")
    p.add_argument("--expect-checksum", action="append", help="VERSION=HEX（缺省用 0001/0002 原文 SHA-384）")
    p.add_argument("--expect-index-name", action="append")
    p.set_defaults(func=cmd_verify_0002)

    p = sub.add_parser("verify-data", help="核验当前入口后端（不切换）")
    p.add_argument("--backend", choices=["rust", "java"], required=True)
    p.add_argument("--expect-generation", type=int)
    p.set_defaults(func=cmd_verify_data)

    sub.add_parser("java-crud", help="Java 真实 HTTP CRUD + location 校验").set_defaults(func=cmd_java_crud)

    p = sub.add_parser("finalize", help="核验当前为 Rust stage5 并写兼容报告")
    p.add_argument("--expect-generation", type=int)
    p.add_argument("--compat-out", help="另写一份脱敏 compatibility JSON 到该路径（可用于文档旁）")
    p.add_argument("--reports-out", help="复制 reports/stage5-*.json 到该目录（文档旁）")
    p.set_defaults(func=cmd_finalize)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "self-test":
        return cmd_self_test(argv)
    ctx = Ctx(args.work_dir)
    try:
        return args.func(ctx, args)
    except Exception as exc:  # noqa: BLE001
        ctx.report.fail(str(exc))
        ctx.report.write()
        print(f"[stage5] error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
