#!/usr/bin/env python3
"""阶段 5 空间查询可重复性能 / EXPLAIN 工具（旧带 bbox Haversine vs 新 PostGIS 候选）。

设计要点（按温晓复审意见）：
  * 每个规模建自有 UUID 合成库并在结束时清理；从不连接 55433/私有备份/生产；
  * 确定性 `setseed(0.42)`：全球稀疏(60%) + 城市密集(40%)，四个真实类别
    (accessible_toilet / friendly_clinic / baby_room / self_definition)，另有少量有限越界
    (lng=360) 历史行；**不含** NaN/Infinity（旧查询三角函数对 Infinity 直接报错，
    该防故障修复由 tests/markers_spatial.rs 单列覆盖）；
  * 旧 SQL 使用 `scripts/find_nearby_legacy.sql` 的 0815d6b 逐字 LF 原文；
  * 在**同一个 psql 会话**内按顺序执行：1 次冷执行 + WARMUP 次预热 + REPEAT 次测量，
    模拟应用连接池的连接复用；冷执行单独列出，热中位数只统计预热之后的轮次；
  * 不设置 `SET jit = off`、不设置 `enable_seqscan`：保持 PG 实际配置并记录 `SHOW` 实测值；
  * 保留每轮完整 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`、耗时与 buffers；
  * 正常有限数据集若旧/新 ID 或顺序不一致、旧 SQL 报错或城市用例 0 命中，脚本非零退出，
    不把 warning 当通过；
  * 规模只允许 1000 / 10000 / 100000；正式大规模测量由温晓在独占窗口安排。

用法：
    # 本轮只做 1000 小检查
    python backend-rust/scripts/spatial_explain.py --scale 1000 \
        --output docs/rust-migration/stage5-spatial-perf.json
"""

import argparse
import hashlib
import json
import math
import statistics
import subprocess
import sys
import uuid
from pathlib import Path

CONTAINER = "lycoris-rust-postgres"
PG_USER = "lycoris"
ADMIN_DB = "lycoris_rust"
CRATE = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).resolve().parent
OLD_SQL_PATH = SCRIPTS / "find_nearby_legacy.sql"
NEW_SQL_PATH = CRATE / "src/modules/markers/sql/find_nearby.sql"
MIGRATIONS = [
    CRATE / "migrations/0001_baseline.sql",
    CRATE / "migrations/0002_spatial.sql",
]

ALLOWED_SCALES = {1000, 10000, 100000}
WARMUP = 3
REPEAT = 7
PSQL_TIMEOUT = 600
MARK = "__ROUND_END__"

CATEGORIES = ["accessible_toilet", "friendly_clinic", "baby_room", "self_definition"]

CITIES = [
    (31.2304, 121.4737),  # 上海
    (35.6762, 139.6503),  # 东京
    (40.7128, -74.0060),  # 纽约
    (51.5074, -0.1278),   # 伦敦
    (-33.8688, 151.2093), # 悉尼
    (-23.5505, -46.6333), # 圣保罗
    (30.0444, 31.2357),   # 开罗
    (19.4326, -99.1332),  # 墨西哥城
]

QUERY_CASES = [
    # (名称, lat, lng, radius, category, 要求非零)
    ("shanghai_dense_1km", 31.2304, 121.4737, 1000, "friendly_clinic", True),
    ("shanghai_dense_50km", 31.2304, 121.4737, 50000, "accessible_toilet", True),
    ("equator_sparse_50km", 0.0, 0.0, 50000, "baby_room", False),
]


def psql(db: str, sql: str, tuples: bool = True, timeout: int = PSQL_TIMEOUT) -> str:
    args = [
        "docker", "exec", "-i", CONTAINER, "psql", "-U", PG_USER, "-d", db,
        "-v", "ON_ERROR_STOP=1", "-f", "-",
    ]
    if tuples:
        args += ["-t", "-A"]
    try:
        result = subprocess.run(
            args, input=sql, text=True, encoding="utf-8",
            capture_output=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"psql 超时 ({timeout}s, db={db})") from exc
    if result.returncode != 0:
        raise RuntimeError(f"psql 失败 (db={db}): {result.stderr.strip()[:400]}")
    return result.stdout.strip()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    # 统一按 LF 计算，跨平台得到与源文件一致的结果。
    data = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def apply_migrations(db: str) -> None:
    script = "\n".join(path.read_text(encoding="utf-8") for path in MIGRATIONS)
    psql(db, script, tuples=False)


def seed_sql(scale: int) -> str:
    sparse = int(scale * 0.6)
    dense = scale - sparse
    cluster_values = ",\n".join(
        f"({i}, {lat}, {lng})" for i, (lat, lng) in enumerate(CITIES)
    )
    categories = "ARRAY[" + ",".join(f"'{name}'" for name in CATEGORIES) + "]"
    return f"""
SELECT setseed(0.42);
INSERT INTO map_markers (
    category, created_at, is_public, is_active, review_status, title, username,
    last_edited_by_owner, lat, lng, version, source_language, updated_at)
SELECT
    -- 每个城市内都要覆盖四个类别：城市步长为 8，按 i/8 轮换类别，避免与城市绑定。
    ({categories})[1 + ((g.i / 8) % {len(CATEGORIES)})],
    now(),
    (g.i % 50 <> 0),
    true,
    CASE WHEN g.i % 97 = 0 THEN 'PENDING' ELSE 'APPROVED' END,
    'bench-' || g.i,
    'bench',
    true,
    CASE
      WHEN g.i <= {sparse} THEN -60 + random() * 120
      ELSE c.lat + (random() - 0.5) * 0.02
    END,
    CASE
      WHEN g.i <= {sparse} THEN -180 + random() * 360
      ELSE c.lng + (random() - 0.5) * 0.02
    END,
    0,
    'zh',
    now()
FROM generate_series(1, {scale}) AS g(i)
LEFT JOIN (VALUES
{cluster_values}
) AS c(idx, lat, lng) ON g.i > {sparse} AND c.idx = ((g.i - {sparse} - 1) % {len(CITIES)});

-- 少量**有限**越界历史行（lng=360 周期折回，location 为 NULL，走 legacy 分支）；
-- 每个类别一行，使稀疏用例有确定命中。不含 NaN/Infinity。
INSERT INTO map_markers (
    category, created_at, is_public, is_active, review_status, title, username,
    last_edited_by_owner, lat, lng, version, source_language, updated_at)
SELECT category, now(), true, true, 'APPROVED', 'legacy-wrap', 'bench', true, 0, 360.0, 0, 'zh', now()
FROM unnest(ARRAY['accessible_toilet','friendly_clinic','baby_room','self_definition']) AS category;

ANALYZE map_markers;
"""


def legacy_bounds(lat: float, lng: float, radius: int):
    """逐字复刻已删除 Rust `NearbyBounds::from_request` 的旧 bbox（仅基准参考）。

    注意原实现是 `asin(ratio).min(1.0)`：`ratio` 超出 [-1,1] 时 Rust `asin` 得 NaN，
    而 `f64::min` 对 NaN 返回另一个操作数 `1.0`，即经度半宽被截到 1.0 rad，而不是
    先把 ratio clamp 到 1（那会得到 pi/2）。这里保持该语义。
    """
    earth = 6_371_000.0
    angular = radius / earth + math.radians(1e-9)
    latitude_delta = math.degrees(angular)
    min_lat = max(lat - latitude_delta, -90.0)
    max_lat = min(lat + latitude_delta, 90.0)
    all_longitudes = min_lat <= -90.0 or max_lat >= 90.0
    if all_longitudes:
        return True, min_lat, max_lat, -180.0, 180.0, True
    ratio = math.sin(angular) / math.cos(math.radians(lat))
    angle = math.asin(ratio) if -1.0 <= ratio <= 1.0 else math.nan
    delta_rad = 1.0 if math.isnan(angle) or angle > 1.0 else angle
    longitude_delta = math.degrees(delta_rad) + 1e-9
    min_lng = lng - longitude_delta
    max_lng = lng + longitude_delta
    if min_lng <= -180.0:
        min_lng += 360.0
    if max_lng >= 180.0:
        max_lng -= 360.0
    return True, min_lat, max_lat, min_lng, max_lng, False


def literal(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    return repr(float(value))


def render_legacy_sql(lat: float, lng: float, radius: int, category: str) -> str:
    use_bounds, min_lat, max_lat, min_lng, max_lng, all_longitudes = legacy_bounds(lat, lng, radius)
    text = OLD_SQL_PATH.read_text(encoding="utf-8")
    values = {
        1: lat, 2: lng, 3: float(radius), 4: category, 5: use_bounds,
        6: min_lat, 7: max_lat, 8: min_lng, 9: max_lng, 10: all_longitudes,
    }
    for index in range(10, 0, -1):
        text = text.replace(f"${index}", literal(values[index]))
    return text


def render_new_sql(lat: float, lng: float, radius: int, category: str) -> str:
    text = NEW_SQL_PATH.read_text(encoding="utf-8")
    values = {1: lat, 2: lng, 3: float(radius), 4: category}
    for index in range(4, 0, -1):
        text = text.replace(f"${index}", literal(values[index]))
    return text


def node_summary(plan_json: list) -> dict:
    plan = plan_json[0]
    nodes = []

    def walk(node: dict) -> None:
        nodes.append({
            "node": node.get("Node Type"),
            "index": node.get("Index Name"),
            "relation": node.get("Relation Name"),
            "actual_rows": node.get("Actual Rows"),
            "actual_total_time_ms": node.get("Actual Total Time"),
        })
        for child in node.get("Plans", []) or []:
            walk(child)

    walk(plan["Plan"])
    root = plan["Plan"]
    # PostgreSQL 的 BUFFERS 计数是**累计**的：父节点已包含其子树（例如 Nested Loop =
    # Append + Index Scan 的子节点计数）。因此总量只能取根节点，绝不对所有节点求和。
    buffers = {
        "shared_hit": root.get("Shared Hit Blocks", 0) or 0,
        "shared_read": root.get("Shared Read Blocks", 0) or 0,
        "shared_dirtied": root.get("Shared Dirtied Blocks", 0) or 0,
        "shared_written": root.get("Shared Written Blocks", 0) or 0,
        "temp_read": root.get("Temp Read Blocks", 0) or 0,
        "temp_written": root.get("Temp Written Blocks", 0) or 0,
    }
    return {
        "planned_rows": root.get("Plan Rows"),
        "execution_time_ms": plan.get("Execution Time"),
        "planning_time_ms": plan.get("Planning Time"),
        "jit": plan.get("JIT"),
        "buffers": buffers,
        "nodes": nodes,
    }


def build_explain_script(statement: str, total: int) -> str:
    """构造同一 psql 会话的 EXPLAIN 脚本；每条 EXPLAIN 都必须以分号结束。"""
    cleaned = statement.rstrip().rstrip(";")
    return "\n".join(
        f"\\echo {MARK}\nEXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {cleaned};"
        for _ in range(total)
    )


def explain_rounds(sql: str, db: str, cold: int = 1, warmup: int = WARMUP, repeat: int = REPEAT) -> dict:
    total = cold + warmup + repeat
    script = build_explain_script(sql, total)
    output = psql(db, script, tuples=True, timeout=PSQL_TIMEOUT)
    chunks = [chunk for chunk in output.split(MARK) if "[" in chunk]
    if len(chunks) != total:
        raise RuntimeError(f"EXPLAIN 轮数不符：期望 {total}，得到 {len(chunks)}")
    rounds = []
    for index, chunk in enumerate(chunks):
        plan_json = json.loads(chunk[chunk.find("["):])
        summary = node_summary(plan_json)
        if index < cold:
            kind = "cold"
        elif index < cold + warmup:
            kind = "warmup"
        else:
            kind = "hot"
        summary["kind"] = kind
        summary["plan"] = plan_json
        rounds.append(summary)
    hot = [r["execution_time_ms"] for r in rounds if r["kind"] == "hot"]
    return {
        "cold_first_ms": rounds[0]["execution_time_ms"],
        "hot_median_ms": statistics.median(hot),
        "hot_all_ms": hot,
        "rounds": rounds,
    }


def settings(db: str) -> dict:
    rows = psql(db, """
SELECT 'jit', current_setting('jit');
SELECT 'max_parallel_workers_per_gather', current_setting('max_parallel_workers_per_gather');
SELECT 'work_mem', current_setting('work_mem');
SELECT 'shared_buffers', current_setting('shared_buffers');
SELECT 'server_version', current_setting('server_version');
SELECT 'postgis', COALESCE((SELECT extversion FROM pg_extension WHERE extname='postgis'), '<none>');
""")
    out = {}
    for line in rows.splitlines():
        key, _, value = line.partition("|")
        out[key] = value
    return out


def relation_sizes(db: str) -> dict:
    table = int(psql(db, "SELECT pg_relation_size('public.map_markers')"))
    index_rows = psql(db, "SELECT indexrelname, pg_relation_size(indexrelid) FROM pg_stat_user_indexes WHERE relname='map_markers' ORDER BY 1")
    indexes = {}
    for line in index_rows.splitlines():
        name, _, size = line.partition("|")
        indexes[name] = int(size)
    return {"table_bytes": table, "indexes": indexes}


def city_category_counts(db: str) -> list:
    values = ",\n".join(f"({i}, {lat}, {lng})" for i, (lat, lng) in enumerate(CITIES))
    rows = psql(db, f"""
WITH cities(idx, lat, lng) AS (VALUES
{values}
)
SELECT c.idx, m.category, count(*)
FROM map_markers m
JOIN cities c ON abs(m.lat - c.lat) <= 0.02 AND abs(m.lng - c.lng) <= 0.02
WHERE m.is_public AND m.review_status = 'APPROVED'
GROUP BY 1, 2 ORDER BY 1, 2;
""")
    result = []
    for line in rows.splitlines():
        idx, category, count = line.split("|")
        result.append({"city_idx": int(idx), "category": category, "count": int(count)})
    return result


def fetch_ids(sql: str, db: str) -> list:
    output = psql(db, sql.rstrip().rstrip(";"))
    return [int(line.split("|", 1)[0]) for line in output.splitlines() if line.strip()]


def run_scale(scale: int) -> dict:
    name = f"lycoris_test_{uuid.uuid4().hex}"
    print(f"[perf] scale={scale} fixture={name}")
    psql(ADMIN_DB, f'CREATE DATABASE "{name}"', tuples=False)
    failures = []
    try:
        apply_migrations(name)
        seed_text = seed_sql(scale)
        psql(name, seed_text, tuples=False)
        report = {
            "scale": scale,
            "fixture": name,
            "rows": int(psql(name, "SELECT count(*) FROM map_markers")),
            "settings": settings(name),
            "sizes": relation_sizes(name),
            "distribution": city_category_counts(name),
            "seed_sql_sha256": sha256_text(seed_text),
            "cases": [],
        }
        for case_name, lat, lng, radius, category, require_hit in QUERY_CASES:
            old_sql = render_legacy_sql(lat, lng, radius, category)
            new_sql = render_new_sql(lat, lng, radius, category)
            new_ids = fetch_ids(new_sql, name)
            old_error = None
            old_ids = None
            try:
                old_ids = fetch_ids(old_sql, name)
            except RuntimeError as error:
                old_error = str(error).splitlines()[-1]
            ids_match = old_ids is not None and old_ids == new_ids
            case = {
                "case": case_name,
                "lat": lat,
                "lng": lng,
                "radius": radius,
                "category": category,
                "old_sql_sha256": sha256_text(old_sql),
                "new_sql_sha256": sha256_text(new_sql),
                "old_error": old_error,
                "old_result_count": len(old_ids) if old_ids is not None else None,
                "result_count": len(new_ids),
                "ids_match": ids_match,
                "order_match": ids_match,
                "new": explain_rounds(new_sql, name),
                "old": explain_rounds(old_sql, name) if old_error is None else None,
            }
            report["cases"].append(case)
            if old_error is not None:
                failures.append(f"{case_name}: 旧 SQL 报错 {old_error}")
            elif not ids_match:
                failures.append(f"{case_name}: 旧/新 ID 或顺序不一致")
            if require_hit and len(new_ids) == 0:
                failures.append(f"{case_name}: 城市用例 0 命中")
            print(
                f"[perf] {case_name}: result={len(new_ids)} ids_match={ids_match} "
                f"new_hot_median={case['new']['hot_median_ms']}ms "
                f"old_hot_median={case['old']['hot_median_ms'] if case['old'] else 'n/a'}ms"
            )
        report["failures"] = failures
        return report
    finally:
        psql(ADMIN_DB, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)', tuples=False)
        print(f"[perf] cleaned {name}")


def self_check() -> int:
    """纯 Python 离线检查：证明同一会话脚本的 EXPLAIN 轮数与分号正确，无需数据库。"""
    total = 1 + WARMUP + REPEAT
    sql = render_new_sql(31.2304, 121.4737, 1000, "friendly_clinic")
    script = build_explain_script(sql, total)
    explain_count = script.count("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)")
    # 以 `\echo MARK` 切段：每段应恰含一条 EXPLAIN 且以分号结束。
    segments = [seg for seg in script.split(f"\\echo {MARK}") if seg.strip()]
    terminated = all(seg.rstrip().endswith(";") for seg in segments)
    semicolon_count = script.count(";")
    ok = (
        explain_count == total
        and len(segments) == total
        and terminated
        and semicolon_count == total
    )
    # 用真实嵌套计划（父节点 BUFFERS 为累计值）核对：报告总量取根节点，不等于节点求和。
    nested = [{
        "Plan": {
            "Node Type": "Sort",
            "Shared Hit Blocks": 921,
            "Plan Rows": 2,
            "Plans": [{
                "Node Type": "Nested Loop",
                "Shared Hit Blocks": 915,
                "Plans": [
                    {
                        "Node Type": "Append",
                        "Shared Hit Blocks": 648,
                        "Plans": [
                            {"Node Type": "Index Scan", "Shared Hit Blocks": 435,
                             "Index Name": "idx_map_markers_location_gist"},
                            {"Node Type": "Seq Scan", "Shared Hit Blocks": 213,
                             "Relation Name": "map_markers"},
                        ],
                    },
                    {"Node Type": "Index Scan", "Shared Hit Blocks": 267,
                     "Index Name": "map_markers_pkey"},
                ],
            }],
        },
        "Execution Time": 1.0,
        "Planning Time": 0.5,
    }]
    root_buffers = node_summary(nested)["buffers"]["shared_hit"]
    buffer_ok = root_buffers == 921
    ok = ok and buffer_ok
    summary = {
        "explain_rounds": explain_count,
        "expected_rounds": total,
        "chunks": len(segments),
        "terminated_with_semicolon": terminated,
        "semicolons": semicolon_count,
        "root_shared_hit": root_buffers,
        "buffer_totals_from_root": buffer_ok,
        "ok": ok,
        "sample_head": script.splitlines()[:3],
    }
    print(json.dumps(summary, ensure_ascii=True, indent=2))
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scale", default="1000", help="只允许 1000/10000/100000，逗号分隔")
    parser.add_argument("--output", help="JSON 报告路径（相对仓库根）")
    parser.add_argument("--self-check", action="store_true", help="离线校验 EXPLAIN 会话脚本结构")
    args = parser.parse_args()

    if args.self_check:
        return self_check()

    scales = [int(part) for part in args.scale.split(",") if part.strip()]
    invalid = [s for s in scales if s not in ALLOWED_SCALES]
    if invalid:
        print(f"[perf] 非法规模 {invalid}，只允许 {sorted(ALLOWED_SCALES)}", file=sys.stderr)
        return 2

    environment = {
        "old_sql_path": str(OLD_SQL_PATH.relative_to(CRATE.parent)),
        "old_sql_sha256": sha256_file(OLD_SQL_PATH),
        "new_sql_sha256": sha256_file(NEW_SQL_PATH),
        "migration_0001_sha256": sha256_file(MIGRATIONS[0]),
        "migration_0002_sha256": sha256_file(MIGRATIONS[1]),
        "tool_sha256": sha256_file(Path(__file__)),
    }
    report = {
        "dataset": "setseed(0.42) 全球稀疏(60%) + 城市密集(40%)，四真实类别 + 少量有限越界 legacy 行；无 NaN/Infinity",
        "warmup": WARMUP,
        "repeat": REPEAT,
        "seed": 0.42,
        "note": "同一 psql 会话内 1 次冷执行 + 预热 + 重复；不改 jit/enable_seqscan，记录 SHOW 实测值",
        "environment": environment,
        "runs": [],
    }
    any_failure = False
    for scale in scales:
        try:
            run = run_scale(scale)
        except Exception as error:  # noqa: BLE001 - 保留失败报告而非直接退出
            run = {"scale": scale, "error": str(error), "failures": [str(error)]}
            print(f"[perf] scale={scale} 异常: {error}", file=sys.stderr)
        report["runs"].append(run)
        if run.get("failures"):
            any_failure = True

    # 即使前面失败也写报告（run_scale 异常不应绕过最终报告）。
    try:
        if args.output:
            out = Path(args.output)
            if not out.is_absolute():
                out = CRATE.parent / out
            out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"[perf] report written to {out}")
        else:
            print(json.dumps(report, ensure_ascii=True, indent=2))
    except OSError as error:
        print(f"[perf] 写报告失败: {error}", file=sys.stderr)
        return 3

    if any_failure:
        print("[perf] FAILED: 存在不一致/旧 SQL 错误/城市 0 命中/异常，见报告", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
