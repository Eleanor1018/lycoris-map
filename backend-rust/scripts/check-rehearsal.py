#!/usr/bin/env python3
"""Lycoris 阶段 4 发布/回退演练工具（纯标准库）。

设计
    - 每个子命令是一个短步骤，失败退出非 0，并在 <work-dir>/reports/<step>.json
      留下 JSON 事实（成功/失败/阻塞都写），便于逐步验收。
    - 所有会触碰数据库/容器的步骤在动作前先过 rehearsal/guard.py：
      只允许回环端口 55434/55435/56380 与合成库
      lycoris_rehearsal_src/up/back，拒绝 SQLx host/hostaddr/dbname 覆盖 query。
    - 应用容器在专用网络内用服务名互连（pg17/pg18/redis/java/rust），主机侧工具
      一律走 127.0.0.1。
    - 不打印密码/Cookie/完整个人信息；报告只放数量、对象 ID 与校验。

步骤（可分别运行）
    render        渲染 work-dir、Nginx 配置与 .env（无 DB/容器副作用）
    guard         校验环境与合成凭据（无副作用）
    up-deps       启动 pg17/pg18/redis/nginx 并核验版本与回环端口
    seed          PG17 载入 6 表基线 + 合成数据 + 受控 PNG，登记指纹
    fingerprint   计算并保存某个库的稳定指纹
    upgrade       PG17 -> PG18 官方工具导出/恢复并比对指纹
    adopt         调用已交付 Rust --check-baseline/--adopt-baseline（依赖未交付则 blocked）
    switch        同一入口切换 Java/Rust，reload 前 nginx -t，分代会话命名空间
    flow          分阶段真实 HTTP 业务写入/回读（Java 基线 / Rust 写入 / 回退核对）
    db-rollback   PG18 -> 新 PG17 目标库逻辑恢复并核对
    probe         经入口做健康/匿名探针
    status        仅本项目 compose 状态
    down          仅本项目 compose down（默认保留卷）
    report-index  汇总所有步骤报告
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 不生成 __pycache__/*.pyc（演练工具不应提交编译缓存）。
sys.dont_write_bytecode = True

SCRIPT_DIR = Path(__file__).resolve().parent
CRATE_ROOT = SCRIPT_DIR.parent
REHEARSAL_DIR = CRATE_ROOT / "rehearsal"
if str(REHEARSAL_DIR) not in sys.path:
    sys.path.insert(0, str(REHEARSAL_DIR))

import common  # noqa: E402
import db_rehearsal  # noqa: E402
import guard  # noqa: E402
import http_flows  # noqa: E402
import switching  # noqa: E402
import synthetic_media  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

EXAMPLE_ENV = REHEARSAL_DIR / "rehearsal-env.example"
SEED_SQL = REHEARSAL_DIR / "sql" / "02_synthetic_seed.sql"

OTHER_BACKEND = {"java": "rust", "rust": "java"}

SYNTH_USER_PASSWORD = "RehearsalPassw0rd!"
SYNTH_SECOND_PASSWORD = "RehearsalSecond!"
SYNTH_ADMIN_USERNAME = "rehearsal_admin"
SYNTH_USERNAME = "rehearsal_user_2"


def log(message: str) -> None:
    print(message, flush=True)


class Ctx:
    def __init__(self, work_dir: Path, overrides: dict[str, str] | None = None):
        self.work_dir = work_dir.resolve()
        self.env_path = self.work_dir / ".env"
        self.overrides = {k: v for k, v in (overrides or {}).items() if v}
        self.env: dict[str, str] = {}
        self.report = common.Report(step="unknown", work_dir=self.work_dir)

    def start(self, step: str) -> common.Report:
        self.report = common.Report(step=step, work_dir=self.work_dir)
        return self.report

    def load_env(self) -> dict[str, str]:
        values = common.read_env_file(self.env_path)
        merged = {**values, **{k: v for k, v in self.overrides.items()}}
        self.env = merged
        return merged

    def guard(self) -> dict[str, object]:
        if not self.env:
            self.load_env()
        if not self.env:
            raise guard.GuardError("缺少演练 .env；请先运行 render")
        user = guard.assert_synthetic_credential(
            self.env.get("PG_REHEARSAL_USER", ""), name="PG_REHEARSAL_USER"
        )
        # 只校验合成口令合法性，不在内存/报告中保留该值（psql 走容器内 local socket）。
        guard.assert_synthetic_credential(
            self.env.get("PG_REHEARSAL_PASSWORD", ""), name="PG_REHEARSAL_PASSWORD"
        )
        targets = guard.verify_environment(self.env)
        return {
            "user": user,
            "targets": targets,
            "workDir": str(self.work_dir),
        }

    def pg(self, target: str) -> tuple[str, str, str]:
        """返回 (container, database, user)。psql 走容器内 local socket，不传口令。"""
        info = common.TABLES[target]
        return (
            info["container"],
            info["database"],
            self.env["PG_REHEARSAL_USER"],
        )


def _sha256_file(path: Path) -> str | None:
    import hashlib

    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------
# 无副作用步骤
# --------------------------------------------------------------------------


def render_nginx(work_dir: Path, backend: str) -> Path:
    return switching.render_entry(work_dir, backend)


def cmd_render(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("render")
    ctx.work_dir.mkdir(parents=True, exist_ok=True)
    (ctx.work_dir / "uploads").mkdir(parents=True, exist_ok=True)
    (ctx.work_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    (ctx.work_dir / "reports").mkdir(parents=True, exist_ok=True)

    env_values: dict[str, str] = {}
    for line in EXAMPLE_ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            env_values[key.strip()] = value.strip()
    env_values["REHEARSAL_WORK_DIR"] = ctx.work_dir.as_posix()
    jar_path = None
    if args.java_jar:
        jar_path = Path(args.java_jar).resolve()
        env_values["JAVA_JAR_PATH"] = jar_path.as_posix()
    elif env_values.get("JAVA_JAR_PATH"):
        jar_path = Path(env_values["JAVA_JAR_PATH"])
    if args.rust_image:
        env_values["RUST_REHEARSAL_IMAGE"] = args.rust_image
    if args.pg_password:
        env_values["PG_REHEARSAL_PASSWORD"] = args.pg_password
    common.write_env_file(ctx.env_path, env_values)
    # env_file 原样传入二级密码哈希（含 '$'，不能经 compose 插值）。
    secrets_path = ctx.work_dir / "secrets.env"
    if not secrets_path.is_file():
        secrets_path.write_text("ADMIN_SECOND_PASSWORD_HASH=\n", encoding="utf-8")
    report.artifact("secretsFile", secrets_path)
    nginx_path = render_nginx(ctx.work_dir, "java")
    report.add("workDir", str(ctx.work_dir))
    report.add("envFile", str(ctx.env_path))
    report.add("activeBackend", "java")
    report.artifact("nginx", nginx_path)
    if jar_path is not None:
        report.add(
            "javaJar",
            {
                "path": str(jar_path),
                "exists": jar_path.is_file(),
                "sizeBytes": jar_path.stat().st_size if jar_path.is_file() else None,
                "sha256": _sha256_file(jar_path),
            },
        )
    path = report.write()
    log(f"[render] work-dir={ctx.work_dir}")
    log(f"[render] nginx 入口默认 java:8080 -> {nginx_path}")
    if report.facts.get("javaJar"):
        jar_info = report.facts["javaJar"]
        log(
            f"[render] Java JAR exists={jar_info['exists']} size={jar_info['sizeBytes']} "
            f"sha256={jar_info['sha256']}"
        )
    log(f"[render] 报告 {path}")
    return 0


def cmd_guard(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("guard")
    try:
        info = ctx.guard()
    except guard.GuardError as exc:
        report.fail(str(exc))
        report.write()
        log(f"[guard] FAIL: {exc}")
        return 1
    if not common.COMPOSE_FILE.is_file():
        report.fail("compose.rehearsal.yml 缺失")
        report.write()
        return 1
    if not SEED_SQL.is_file():
        report.fail("合成种子 SQL 缺失")
        report.write()
        return 1
    report.add("targets", {k: v.label() for k, v in info["targets"].items()})
    report.add("composeFile", str(common.COMPOSE_FILE))
    path = report.write()
    log("[guard] OK 只连接回环演练端口与合成库")
    for key, value in report.facts["targets"].items():
        log(f"[guard]   {key}: {value}")
    log(f"[guard] 报告 {path}")
    return 0


# --------------------------------------------------------------------------
# 依赖容器
# --------------------------------------------------------------------------


def _docker_inspect_field(container: str, template: str) -> str:
    result = common.run(
        ["docker", "inspect", "--format", template, container], check=False, timeout=30
    )
    return result.stdout.decode("utf-8", errors="replace").strip()


def _container_env(container: str) -> dict[str, str]:
    raw = _docker_inspect_field(container, "{{json .Config.Env}}")
    if not raw:
        return {}
    try:
        entries = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    env: dict[str, str] = {}
    for entry in entries or []:
        key, _, value = entry.partition("=")
        env[key] = value
    return env


def _loopback_bindings(container: str) -> dict[str, str]:
    raw = _docker_inspect_field(container, "{{json .NetworkSettings.Ports}}")
    if not raw:
        return {}
    try:
        ports = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    bindings: dict[str, str] = {}
    for container_port, entries in (ports or {}).items():
        for entry in entries or []:
            host_ip = entry.get("HostIp", "")
            host_port = entry.get("HostPort", "")
            bindings[container_port] = f"{host_ip}:{host_port}"
    return bindings


def _assert_loopback_binding(container: str, container_port: str, host_port: str) -> str:
    bindings = _loopback_bindings(container)
    actual = bindings.get(container_port, "")
    if actual != f"127.0.0.1:{host_port}":
        raise RuntimeError(
            f"{container} {container_port} 绑定不是 127.0.0.1:{host_port}（实际 {actual!r}）"
        )
    return actual


def _psql_restrict_support(container: str, database: str, *, user: str) -> bool:
    """实测容器内 psql 是否支持 PG18 dump 使用的 \\restrict/\\unrestrict。

    不假设版本；用真实 psql 执行一段带安全元命令的薄脚本判定。
    """
    probe = b"\\restrict lycoris_rehearsal_probe\nSELECT 1;\n\\unrestrict lycoris_rehearsal_probe\n"
    result = common.docker_exec(
        container,
        ["psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-tA", "-f", "-"],
        input_bytes=probe,
        check=False,
        timeout=30,
    )
    return result.returncode == 0 and result.stdout.decode("utf-8", errors="replace").strip() == "1"


def check_versions(ctx: Ctx, report: common.Report) -> None:
    user = ctx.env["PG_REHEARSAL_USER"]
    for target, expected_major in (("pg17", "17"), ("pg18", "18")):
        container, database, _ = ctx.pg(target)
        version = common.psql(
            container, database, "SHOW server_version;", user=user
        ).strip()
        version_num = common.psql(
            container, database, "SHOW server_version_num;", user=user
        ).strip()
        postgis = common.psql(
            container,
            database,
            "SELECT extversion FROM pg_extension WHERE extname = 'postgis';",
            user=user,
        ).strip()
        if not version_num.startswith(expected_major):
            raise RuntimeError(f"{target} 主版本不符：期望 {expected_major}，实际 {version}")
        report.add(f"{target}ServerVersion", version)
        report.add(f"{target}PostgisVersion", postgis)
    report.add(
        "pg17PsqlRestrictSupported",
        _psql_restrict_support(common.PG17_CONTAINER, "lycoris_rehearsal_src", user=user),
    )
    redis_version = _docker_inspect_field(common.REDIS_CONTAINER, "{{.Config.Image}}")
    result = common.run(
        ["docker", "exec", common.REDIS_CONTAINER, "redis-server", "--version"],
        check=False,
        timeout=30,
    )
    redis_text = (result.stdout or b"").decode("utf-8", errors="replace")
    report.add("redisImage", redis_version)
    report.add("redisServerVersion", redis_text.strip())
    nginx_result = common.run(
        ["docker", "exec", common.NGINX_CONTAINER, "nginx", "-v"],
        check=False,
        timeout=30,
    )
    nginx_text = (nginx_result.stderr or b"").decode("utf-8", errors="replace").strip()
    report.add("nginxVersion", nginx_text)
    report.add("nginxImage", _docker_inspect_field(common.NGINX_CONTAINER, "{{.Config.Image}}"))


def cmd_up_deps(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("up-deps")
    try:
        ctx.guard()
    except guard.GuardError as exc:
        report.fail(str(exc))
        report.write()
        log(f"[up-deps] FAIL: {exc}")
        return 1
    try:
        common.compose(
            ["up", "-d", "pg17", "pg18", "redis", "nginx"],
            work_dir=ctx.work_dir,
            timeout=900,
        )
        for container in (
            common.PG17_CONTAINER,
            common.PG18_CONTAINER,
            common.REDIS_CONTAINER,
            common.NGINX_CONTAINER,
        ):
            state = common.wait_healthy(container, timeout=180)
            report.add(f"{container}:state", state)
        report.add(
            "pg17Binding",
            _assert_loopback_binding(common.PG17_CONTAINER, "5432/tcp", str(guard.PG17_PORT)),
        )
        report.add(
            "pg18Binding",
            _assert_loopback_binding(common.PG18_CONTAINER, "5432/tcp", str(guard.PG18_PORT)),
        )
        report.add(
            "redisBinding",
            _assert_loopback_binding(common.REDIS_CONTAINER, "6379/tcp", str(guard.REDIS_PORT)),
        )
        report.add(
            "nginxBinding",
            _assert_loopback_binding(common.NGINX_CONTAINER, "80/tcp", str(guard.ENTRY_PORT)),
        )
        check_versions(ctx, report)
        report.add("resolvedConfig", switching.verify_resolved_config(ctx.work_dir))
    except Exception as exc:  # noqa: BLE001 - 失败也要留报告
        report.fail(str(exc))
        report.write()
        log(f"[up-deps] FAIL: {exc}")
        return 1
    path = report.write()
    log("[up-deps] OK 依赖容器就绪且仅绑定回环回演练端口")
    log(f"[up-deps] 报告 {path}")
    return 0


# --------------------------------------------------------------------------
# 种子与指纹
# --------------------------------------------------------------------------


def _table_count(ctx: Ctx, target: str, table: str) -> int:
    container, database, user = ctx.pg(target)
    raw = common.psql(
        container,
        database,
        f'SELECT count(*) FROM public."{table}";',
        user=user,
    )
    return int(raw.strip() or 0)


def _category_counts(ctx: Ctx, target: str, user: str) -> dict[str, dict[str, int]]:
    container, database = common.TABLES[target]["container"], common.TABLES[target]["database"]
    raw = common.psql(
        container,
        database,
        "SELECT category || '|' || count(*)::text || '|' || "
        "count(*) FILTER (WHERE is_public AND review_status='APPROVED')::text || '|' || "
        "count(*) FILTER (WHERE mark_image IS NOT NULL)::text "
        "FROM public.map_markers GROUP BY category ORDER BY category;",
        user=user,
    )
    result: dict[str, dict[str, int]] = {}
    for line in raw.splitlines():
        parts = line.strip().split("|")
        if len(parts) != 4:
            continue
        result[parts[0]] = {
            "total": int(parts[1]),
            "publicApproved": int(parts[2]),
            "withImage": int(parts[3]),
        }
    return result


def cmd_seed(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("seed")
    try:
        ctx.guard()
    except guard.GuardError as exc:
        report.fail(str(exc))
        report.write()
        log(f"[seed] FAIL: {exc}")
        return 1
    container, database, user = ctx.pg("pg17")
    try:
        common.wait_healthy(common.PG17_CONTAINER, timeout=120)
        if not common.database_exists(container, database, user=user):
            common.create_database(container, database, user=user)
        exists = common.psql(
            container,
            database,
            "SELECT (to_regclass('public.users') IS NOT NULL)::int;",
            user=user,
        ).strip()
        already = exists == "1" and _table_count(ctx, "pg17", "users") > 0
        if already and not args.recreate:
            report.fail("PG17 合成库已存在数据；如需重建请显式使用 --recreate（仅限演练库）")
            report.write()
            return 1
        if already and args.recreate:
            common.drop_database(common.PG17_CONTAINER, database, user=user)
            common.create_database(common.PG17_CONTAINER, database, user=user)
        common.psql(
            container,
            database,
            sql_file=common.BASELINE_SQL,
            user=user,
        )
        common.psql(
            container,
            database,
            sql_file=SEED_SQL,
            user=user,
        )
        media = synthetic_media.write_media(
            ctx.work_dir / "uploads", users=20, markers=5000
        )
        report.add(
            "media",
            {
                "fileCount": media["fileCount"],
                "combinedSha256": media["combinedSha256"],
            },
        )
        second_hash = common.psql(
            container,
            database,
            f"SELECT crypt('{SYNTH_SECOND_PASSWORD}', gen_salt('bf', 10));",
            user=user,
        ).strip()
        if not second_hash.startswith("$2"):
            raise RuntimeError("二级密码哈希生成失败")
        secrets_path = ctx.work_dir / "secrets.env"
        # Compose 会插值 env_file 中的 '$'；写成 '$$' 才能原样得到单个 '$'。
        secrets_path.write_text(
            "ADMIN_SECOND_PASSWORD_HASH=" + second_hash.replace("$", "$$") + "\n",
            encoding="utf-8",
        )
        report.artifact("secretsFile", secrets_path)
        report.add(
            "adminSecondHash",
            {
                "length": len(second_hash),
                "escapedForCompose": True,
            },
        )
        env_values = common.read_env_file(ctx.env_path)
        env_values.pop("ADMIN_SECOND_PASSWORD_HASH", None)
        common.write_env_file(ctx.env_path, env_values)
        counts = {
            table: _table_count(ctx, "pg17", table) for table in common.BUSINESS_TABLES
        }
        report.add("counts", counts)
        report.add("categoryCounts", _category_counts(ctx, "pg17", user))
        # 新演练：新 runId + 计数归零 + 清理 flow/marker/cookie 依赖状态，避免跨基线串联。
        report.add("runId", switching.start_new_run(ctx.work_dir))
        fp = common.database_fingerprint("pg17", user=user)
        fp_path = ctx.work_dir / "fingerprints" / "pg17.json"
        fp_path.parent.mkdir(parents=True, exist_ok=True)
        fp_path.write_text(
            json.dumps(fp, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
        )
        report.artifact("pg17Fingerprint", fp_path)
        report.add("sequences", fp["sequences"])
        report.add("adminSecondHashConfigured", True)
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        log(f"[seed] FAIL: {exc}")
        return 1
    path = report.write()
    log(f"[seed] OK 表行数 {report.facts['counts']}")
    log(f"[seed] 报告 {path}")
    return 0


def cmd_fingerprint(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("fingerprint")
    try:
        ctx.guard()
        target = args.target
        container, database, user = ctx.pg(target)
        fp = common.fingerprint_database(
            container, database, user=user, label=target
        )
        out = ctx.work_dir / "fingerprints" / f"{target}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps(fp, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
        )
        report.add("tables", {t: v["rows"] for t, v in fp["tables"].items()})
        report.artifact("fingerprint", out)
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        log(f"[fingerprint] FAIL: {exc}")
        return 1
    path = report.write()
    log(f"[fingerprint] OK {args.target} 行数 {report.facts['tables']}")
    log(f"[fingerprint] 报告 {path}")
    return 0


# --------------------------------------------------------------------------
# 大版本升级 / 回退
# --------------------------------------------------------------------------


def cmd_upgrade(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("upgrade")
    try:
        ctx.guard()
        container17, db17, user = ctx.pg("pg17")
        container18, db18, _ = ctx.pg("pg18")
        common.wait_healthy(common.PG17_CONTAINER, timeout=120)
        common.wait_healthy(common.PG18_CONTAINER, timeout=120)
        if _table_count(ctx, "pg17", "users") == 0:
            raise RuntimeError("PG17 合成库为空，请先运行 seed")
        source_fp = common.database_fingerprint("pg17", user=user)
        dump = common.pg_dump_bytes(container17, db17, user=user, plain=False)
        dump_path = ctx.work_dir / "artifacts" / "pg17_src.dump"
        dump_path.parent.mkdir(parents=True, exist_ok=True)
        dump_path.write_bytes(dump)
        report.artifact("pg17Dump", dump_path)
        if common.database_exists(container18, db18, user=user):
            if not args.recreate:
                raise RuntimeError("PG18 目标库已存在；如需重建请显式 --recreate")
            common.drop_database(container18, db18, user=user)
        common.create_database(container18, db18, user=user)
        common.pg_restore_stdin(container18, db18, user=user, data=dump)
        target_fp = common.fingerprint_database(
            container18, db18, user=user, label="pg18"
        )
        comparison = common.compare_fingerprints(source_fp, target_fp)
        comp_path = ctx.work_dir / "fingerprints" / "upgrade_compare.json"
        comp_path.write_text(
            json.dumps(comparison, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        report.artifact("comparison", comp_path)
        if not comparison["equal"]:
            report.fail("PG17 -> PG18 指纹不一致：" + "; ".join(comparison["differences"]))
            report.write()
            log("[upgrade] FAIL 指纹不一致")
            return 1
        report.add("rows", {t: v["rows"] for t, v in target_fp["tables"].items()})
        report.add("fingerprintEqual", True)
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        log(f"[upgrade] FAIL: {exc}")
        return 1
    path = report.write()
    log("[upgrade] OK PG18 与 PG17 业务表指纹/序列一致")
    log(f"[upgrade] 报告 {path}")
    return 0


def cmd_db_rollback(ctx: Ctx, args: argparse.Namespace) -> int:
    """PG18 最新状态 -> 新 PG17 目标库（冻结写者 + 原样恢复 + 指纹/媒体核对）。"""
    report = ctx.start("db-rollback")
    try:
        ctx.guard()
        _, _, user = ctx.pg("pg17")
        db_rehearsal.run_db_rollback(
            work_dir=ctx.work_dir,
            user=user,
            report=report,
            recreate=args.recreate,
            strip_restrict=args.strip_restrict_metacommands,
        )
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        log(f"[db-rollback] FAIL: {exc}")
        return 1
    path = report.write()
    log(
        "[db-rollback] OK PG18 最新状态已恢复到新 PG17 库且指纹/媒体一致"
        f"（模式 {report.facts.get('restoreMode')}，入口保持维护态）"
    )
    log(f"[db-rollback] 报告 {path}")
    return 0


# --------------------------------------------------------------------------
# Rust 基线接管（依赖其它任务）
# --------------------------------------------------------------------------


def _rust_image_available(image: str) -> bool:
    result = common.run(["docker", "image", "inspect", image], check=False, timeout=30)
    return result.returncode == 0


def cmd_snapshot_baseline(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("snapshot-baseline")
    try:
        ctx.guard()
        _, _, user = ctx.pg("pg17")
        db_rehearsal.run_snapshot_baseline(
            work_dir=ctx.work_dir, user=user, report=report, label=args.label
        )
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        log(f"[snapshot-baseline] FAIL: {exc}")
        return 1
    path = report.write()
    log(f"[snapshot-baseline] OK label={args.label}（入口保持维护态）")
    log(f"[snapshot-baseline] 报告 {path}")
    return 0


def cmd_restore_baseline(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("restore-baseline")
    try:
        ctx.guard()
        _, _, user = ctx.pg("pg17")
        db_rehearsal.run_restore_baseline(
            work_dir=ctx.work_dir, user=user, report=report, label=args.label
        )
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        log(f"[restore-baseline] FAIL: {exc}")
        return 1
    path = report.write()
    log(f"[restore-baseline] OK label={args.label}（指纹/媒体一致，入口保持维护态）")
    log(f"[restore-baseline] 报告 {path}")
    return 0


def cmd_adopt(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("adopt-baseline")
    try:
        ctx.guard()
        image = args.rust_image or ctx.env.get("RUST_REHEARSAL_IMAGE", "")
        if not image:
            report.blocked(
                "未提供 Rust release 镜像（RUST_REHEARSAL_IMAGE）；--check-baseline/"
                "--adopt-baseline 由另一任务交付，集成后再实跑"
            )
            report.write()
            log("[adopt] BLOCKED: 缺少 Rust release 镜像/入口")
            return 2
        if not _rust_image_available(image):
            report.blocked(f"Rust 镜像不可用：{image}")
            report.write()
            log(f"[adopt] BLOCKED: 镜像不存在 {image}")
            return 2
        _, db18, _ = ctx.pg("pg18")
        # 秘密不出现在 docker argv：`-e KEY` 不带值，值由父进程环境经 subprocess env 传入。
        base = [
            "docker",
            "run",
            "--rm",
            "--network",
            "lycoris-rust-rehearsal-net",
            "-e",
            "DATABASE_URL",
            "-e",
            "REDIS_URL",
        ]
        run_env = {
            "DATABASE_URL": (
                f"postgres://{ctx.env['PG_REHEARSAL_USER']}:"
                f"{ctx.env['PG_REHEARSAL_PASSWORD']}@pg18:5432/{db18}"
            ),
            "REDIS_URL": "redis://redis:6379",
        }
        check = common.run(
            base + [image, "--check-baseline"], env=run_env, check=False, timeout=300
        )
        report.add("checkBaselineExit", check.returncode)
        report.add("checkBaselineStdout", _safe_text(check.stdout))
        if check.returncode != 0:
            report.fail("--check-baseline 未通过")
            report.write()
            log("[adopt] FAIL --check-baseline")
            return 1
        adopt = common.run(
            base + [image, "--adopt-baseline"], env=run_env, check=False, timeout=300
        )
        report.add("adoptBaselineExit", adopt.returncode)
        report.add("adoptBaselineStdout", _safe_text(adopt.stdout))
        if adopt.returncode != 0:
            report.fail("--adopt-baseline 未通过")
            report.write()
            log("[adopt] FAIL --adopt-baseline")
            return 1
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        log(f"[adopt] FAIL: {exc}")
        return 1
    path = report.write()
    log("[adopt] OK 基线检查与登记通过")
    log(f"[adopt] 报告 {path}")
    return 0


def _safe_text(raw: bytes | None, limit: int = 4000) -> str:
    if not raw:
        return ""
    return raw.decode("utf-8", errors="replace")[:limit]


# --------------------------------------------------------------------------
# 切换与探针
# --------------------------------------------------------------------------


def _app_ready(ctx: Ctx, target: str) -> str | None:
    """返回缺失依赖说明；就绪返回 None。"""
    if target == "java":
        jar = ctx.env.get("JAVA_JAR_PATH", "")
        if not jar:
            return "未设置 JAVA_JAR_PATH（需要预热构建的平台无关 Java JAR）"
        if not Path(jar).is_file():
            return f"JAVA_JAR_PATH 不存在：{jar}"
    else:
        image = ctx.env.get("RUST_REHEARSAL_IMAGE", "")
        if not image:
            return "未设置 RUST_REHEARSAL_IMAGE（Linux Rust release 镜像由另一任务交付）"
        if not _rust_image_available(image):
            return f"Rust 镜像不可用：{image}"
    return None


def _stop_all_writers(work_dir: Path) -> list[str]:
    stopped = []
    for backend in ("java", "rust"):
        switching.stop_backend(work_dir, backend)
        stopped.append(backend)
    return stopped


def _probe_and_record(ctx: Ctx, report: common.Report) -> None:
    entry = ctx.env.get("ENTRY_URL", "http://127.0.0.1:18180")
    report.facts.update({"entryProbe": switching.probe_entry(entry)})


def _verify_java_secret(ctx: Ctx) -> None:
    got = _container_env(common.JAVA_CONTAINER).get("ADMIN_SECOND_PASSWORD_HASH", "")
    expected = common.read_env_file(ctx.work_dir / "secrets.env").get(
        "ADMIN_SECOND_PASSWORD_HASH", ""
    ).replace("$$", "$")
    if got != expected:
        raise switching.SwitchError("二级密码哈希未原样传入 Java 容器（compose 插值破坏）")


def cmd_switch(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start(f"switch-{args.to}-g{args.generation}")
    target = args.to
    entry = ctx.env.get("ENTRY_URL", "http://127.0.0.1:18180") if ctx.env else ""
    try:
        ctx.guard()
        entry = ctx.env.get("ENTRY_URL", "http://127.0.0.1:18180")
        missing = _app_ready(ctx, target)
        if missing:
            report.blocked(missing)
            report.write()
            log(f"[switch] BLOCKED: {missing}")
            return 2

        # 采集旧代次真实 Cookie（读操作，先于冻结）；有记录代次但采集失败即失败。
        old_backend = (
            "java" if switching.backend_running("java")
            else ("rust" if switching.backend_running("rust") else None)
        )
        old_run = switching.run_id(ctx.work_dir)
        if old_backend and old_run:
            old_generation = switching.current_generation(ctx.work_dir, old_backend)
            if old_generation > 0:
                cookie_name = switching.cookie_for(old_run, old_backend, old_generation)
                cookie = switching.capture_session_cookie(
                    entry,
                    username=SYNTH_USERNAME,
                    password=SYNTH_USER_PASSWORD,
                    cookie_name=cookie_name,
                )
                if cookie is None:
                    raise switching.SwitchError(
                        f"旧会话 Cookie 采集失败（{old_backend} g{old_generation}），无法证明隔离"
                    )
                switching.save_cookie(ctx.work_dir, old_backend, old_generation, cookie)
                report.add("capturedOldCookie", f"{old_backend}:g{old_generation}")
        elif old_backend:
            report.add("legacyRunningWithoutRunId", True)

        cookies_to_verify = tuple(switching.load_cookies(ctx.work_dir).values())
        report.add("cookiesToVerify", len(cookies_to_verify))

        # generation：正整数、严格递增、启动前原子登记为已用。
        generation = switching.validate_generation(ctx.work_dir, target, args.generation)
        env_values = common.read_env_file(ctx.env_path)
        if target == "java":
            env_values["JAVA_SESSION_NAMESPACE"] = str(generation["namespace"])
            env_values["JAVA_SESSION_COOKIE"] = str(generation["cookie"])
            db_map = {
                "pg17": "jdbc:postgresql://pg17:5432/lycoris_rehearsal_src",
                "pg18": "jdbc:postgresql://pg18:5432/lycoris_rehearsal_up",
                "back": "jdbc:postgresql://pg17:5432/lycoris_rehearsal_back",
            }
            if args.db:
                env_values["JAVA_DB_URL"] = db_map[args.db]
            report.add("javaDatabase", env_values.get("JAVA_DB_URL"))
        else:
            env_values["RUST_SESSION_NAMESPACE"] = str(generation["namespace"])
            env_values["RUST_SESSION_COOKIE"] = str(generation["cookie"])
        report.add("runId", generation["runId"])
        report.add("generation", args.generation)
        report.add("runningNamespace", generation["namespace"])
        report.add("runningCookieName", generation["cookie"])

        def start_target() -> None:
            common.write_env_file(ctx.env_path, env_values)
            ctx.env = env_values
            switching.start_backend(ctx.work_dir, target)
            if target == "java":
                _verify_java_secret(ctx)

        deps = switching.SwitchDeps(
            freeze=lambda: switching.freeze_entry(ctx.work_dir),
            stop=lambda: _stop_all_writers(ctx.work_dir),
            start=start_target,
            wait_ready=lambda: switching.wait_direct_ready(target),
            activate=lambda: switching.activate_entry(ctx.work_dir, target),
            probe=lambda: _probe_and_record(ctx, report),
            replay_cookie=lambda cookie: switching.replay_cookie(entry, cookie),
        )
        facts = switching.run_switch(deps, cookies_to_verify=cookies_to_verify)
        report.facts.update(facts)
        switching.commit_generation(ctx.work_dir, target, args.generation)
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, switching.SwitchError) and exc.facts:
            report.facts.update(exc.facts)
        container = common.JAVA_CONTAINER if target == "java" else common.RUST_CONTAINER
        logs = common.run(["docker", "logs", "--tail", "60", container], check=False, timeout=30)
        tail = _safe_text(logs.stderr) or _safe_text(logs.stdout)
        if tail.strip():
            report.add("containerLogTail", tail.strip()[:4000])
        report.fail(str(exc))
        report.write()
        log(f"[switch] FAIL: {exc}")
        return 1
    path = report.write()
    log(
        f"[switch] OK 入口现指向 {target}（第 {args.generation} 代）；"
        f"旧 Cookie 重放 {report.facts.get('cookieReplayStatuses', 'n/a')}"
    )
    log(f"[switch] 报告 {path}")
    return 0


def cmd_probe(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("probe")
    try:
        ctx.guard()
        _probe_and_record(ctx, report)
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        log(f"[probe] FAIL: {exc}")
        return 1
    path = report.write()
    log(f"[probe] OK health/me/nearby 正常（{report.facts.get('entryProbe')}）")
    log(f"[probe] 报告 {path}")
    return 0


# --------------------------------------------------------------------------
# HTTP 业务流
# --------------------------------------------------------------------------


def cmd_flow(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start(f"flow-{args.phase}")
    try:
        ctx.guard()
        entry = args.entry or ctx.env.get("ENTRY_URL", "http://127.0.0.1:18180")
        guard.assert_http_endpoint(entry, name="ENTRY_URL")
        result = http_flows.run_phase(
            phase=args.phase,
            base_url=entry,
            work_dir=ctx.work_dir,
            admin_username=SYNTH_ADMIN_USERNAME,
            admin_password=SYNTH_USER_PASSWORD,
            admin_second=SYNTH_SECOND_PASSWORD,
            user_username=SYNTH_USERNAME,
            user_password=SYNTH_USER_PASSWORD,
        )
        report.facts.update(result)
    except http_flows.FlowError as exc:
        report.fail(str(exc))
        report.write()
        log(f"[flow] FAIL: {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        log(f"[flow] FAIL: {exc}")
        return 1
    path = report.write()
    log(f"[flow] OK phase={args.phase}")
    log(f"[flow] 报告 {path}")
    return 0


# --------------------------------------------------------------------------
# 生命周期
# --------------------------------------------------------------------------


def cmd_status(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("status")
    result = common.compose(
        ["ps", "-a", "--format", "json"], work_dir=ctx.work_dir, check=False
    )
    text = _safe_text(result.stdout) or _safe_text(result.stderr)
    report.add("composePs", text[:8000])
    path = report.write()
    log(text.strip() or "(no containers)")
    log(f"[status] 报告 {path}")
    return 0 if result.returncode == 0 else 1


def cmd_down(ctx: Ctx, args: argparse.Namespace) -> int:
    report = ctx.start("down")
    try:
        ctx.guard()
        # 先确认当前项目容器全部属于本任务前缀，避免误伤。
        ps = common.compose(
            ["ps", "-a", "--format", "json"], work_dir=ctx.work_dir, check=False
        )
        for line in (_safe_text(ps.stdout) or "").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            name = item.get("Name", "")
            if name and not name.startswith(common.CONTAINER_PREFIX):
                raise RuntimeError(f"发现非本任务容器，拒绝 down：{name}")
        args_list = ["down", "--remove-orphans"]
        if args.volumes:
            args_list.append("--volumes")
        common.compose(args_list, work_dir=ctx.work_dir, check=True)
        report.add("removedVolumes", bool(args.volumes))
    except Exception as exc:  # noqa: BLE001
        report.fail(str(exc))
        report.write()
        log(f"[down] FAIL: {exc}")
        return 1
    path = report.write()
    log("[down] OK 仅本任务 compose 已停止")
    log(f"[down] 报告 {path}")
    return 0


def cmd_report_index(ctx: Ctx, args: argparse.Namespace) -> int:
    reports_dir = ctx.work_dir / "reports"
    summary = {"workDir": str(ctx.work_dir), "gitHead": common.git_head(), "steps": {}}
    if reports_dir.is_dir():
        for path in sorted(reports_dir.glob("*.json")):
            if path.name == "rehearsal-summary.json":
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if "step" not in data:
                summary.setdefault("nonStepReports", []).append(path.stem)
                continue
            summary["steps"][path.stem] = {
                "step": data.get("step"),
                "status": data.get("status"),
                "ok": data.get("ok"),
                "error": data.get("error"),
                "timestamp": data.get("timestamp"),
            }
    out = reports_dir / "rehearsal-summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )
    log(json.dumps(summary["steps"], ensure_ascii=False, indent=2))
    log(f"[report-index] {out}")
    blocked = [s for s, d in summary["steps"].items() if d.get("status") == "blocked"]
    failed = [s for s, d in summary["steps"].items() if d.get("status") == "failed"]
    if failed:
        return 1
    if blocked:
        return 2
    return 0


def cmd_self_test(ctx: Ctx, args: argparse.Namespace) -> int:
    import unittest

    tests_dir = REHEARSAL_DIR / "tests"
    if str(tests_dir) not in sys.path:
        sys.path.insert(0, str(tests_dir))
    suite = unittest.TestLoader().discover(str(tests_dir), pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = ctx.start("self-test")
    report.add("testsRun", result.testsRun)
    report.add("failures", len(result.failures))
    report.add("errors", len(result.errors))
    if not result.wasSuccessful():
        report.fail("工具自检用例失败")
    path = report.write()
    log(f"[self-test] tests={result.testsRun} failures={len(result.failures)} errors={len(result.errors)}")
    log(f"[self-test] 报告 {path}")
    return 0 if result.wasSuccessful() else 1


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Lycoris 阶段 4 发布/回退演练")
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=common.DEFAULT_WORK_DIR,
        help="可追踪的临时演练目录（默认 %%TEMP%%/lycoris-rust-rehearsal）",
    )
    parser.add_argument("--pg-password", help="覆盖合成口令（默认取 .env）")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("render", help="渲染 work-dir / Nginx / .env")
    p.add_argument("--java-jar", help="平台无关 Java JAR 路径")
    p.add_argument("--rust-image", help="Rust release 镜像")
    p.set_defaults(func=cmd_render)

    sub.add_parser("guard", help="校验环境与合成凭据").set_defaults(func=cmd_guard)
    sub.add_parser("up-deps", help="启动依赖容器并核验").set_defaults(func=cmd_up_deps)

    p = sub.add_parser("seed", help="PG17 载入基线与合成数据")
    p.add_argument("--recreate", action="store_true", help="重建演练库（仅限白名单合成库）")
    p.set_defaults(func=cmd_seed)

    p = sub.add_parser("fingerprint", help="计算稳定指纹")
    p.add_argument("--target", choices=["pg17", "pg18"], required=True)
    p.set_defaults(func=cmd_fingerprint)

    p = sub.add_parser("upgrade", help="PG17 -> PG18 导出/恢复并比对")
    p.add_argument("--recreate", action="store_true")
    p.set_defaults(func=cmd_upgrade)

    p = sub.add_parser("db-rollback", help="PG18 -> 新 PG17 目标库恢复并比对")
    p.add_argument("--recreate", action="store_true")
    p.add_argument(
        "--strip-restrict-metacommands",
        action="store_true",
        help="仅在原样恢复失败且人工确认后，受控删除 \\restrict/\\unrestrict 并记录证据",
    )
    p.set_defaults(func=cmd_db_rollback)

    sub.add_parser("adopt", help="调用 Rust --check-baseline/--adopt-baseline")
    p = sub.choices["adopt"]
    p.add_argument("--rust-image", help="覆盖 Rust 镜像")
    p.set_defaults(func=cmd_adopt)

    p = sub.add_parser("snapshot-baseline", help="保存配对性能基线（完整新增写入验证后）")
    p.add_argument("--label", required=True, help="基线标签 [A-Za-z0-9_-]")
    p.set_defaults(func=cmd_snapshot_baseline)

    p = sub.add_parser("restore-baseline", help="恢复配对性能基线（仅既有 up 库与 uploads）")
    p.add_argument("--label", required=True, help="基线标签 [A-Za-z0-9_-]")
    p.set_defaults(func=cmd_restore_baseline)

    p = sub.add_parser("switch", help="同一入口切换 Java/Rust")
    p.add_argument("--to", choices=["java", "rust"], required=True)
    p.add_argument("--generation", type=int, required=True)
    p.add_argument(
        "--db",
        choices=["pg17", "pg18", "back"],
        help="仅 java：JAVA_DB_URL 指向 PG17 来源、PG18 升级库或 PG17 回退目标库",
    )
    p.set_defaults(func=cmd_switch)

    p = sub.add_parser("flow", help="分阶段真实 HTTP 业务流")
    p.add_argument(
        "--phase",
        required=True,
        choices=[
            "java-baseline",
            "java-pg18",
            "rust-writes",
            "rollback-verify",
            "db-final-verify",
        ],
    )
    p.add_argument("--entry", help="入口 URL（默认 ENTRY_URL）")
    p.set_defaults(func=cmd_flow)

    p = sub.add_parser("probe", help="经入口做健康/匿名探针")
    p.set_defaults(func=cmd_probe)

    sub.add_parser("status", help="本项目 compose 状态").set_defaults(func=cmd_status)

    p = sub.add_parser("down", help="仅本项目 compose down")
    p.add_argument("--volumes", action="store_true", help="同时删除本任务演练卷")
    p.set_defaults(func=cmd_down)

    sub.add_parser("report-index", help="汇总所有步骤报告").set_defaults(func=cmd_report_index)
    sub.add_parser("self-test", help="运行工具单元测试").set_defaults(func=cmd_self_test)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    ctx = Ctx(args.work_dir, {"PG_REHEARSAL_PASSWORD": args.pg_password})
    try:
        return args.func(ctx, args)
    except Exception as exc:  # noqa: BLE001 - 兜底：任何步骤失败都非 0 且留报告
        ctx.report.fail(str(exc))
        ctx.report.write()
        log(f"[error] {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
