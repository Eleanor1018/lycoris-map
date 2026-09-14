#!/usr/bin/env python3
"""Lycoris 阶段 4 公平性能测量 CLI（纯标准库）。

核心逻辑在 rehearsal/bench_core.py；本文件只做参数、编排与报告。
原则：一次只压一个后端、预热后测量、原始每轮数据 + 汇总、不判定百分比目标；
受测容器配置（image/user/2cpu/512MiB/成本/池/缓存/UID10001）实测核验；
默认读/上传负载使用合成库真实公开 APPROVED 四类点位并落盘同一 ID 集合。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
CRATE_ROOT = SCRIPT_DIR.parent
REHEARSAL_DIR = CRATE_ROOT / "rehearsal"
if str(REHEARSAL_DIR) not in sys.path:
    sys.path.insert(0, str(REHEARSAL_DIR))

sys.dont_write_bytecode = True

import bench_core  # noqa: E402
import common  # noqa: E402
import guard  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

import os  # noqa: E402

DEFAULT_USER_PREFIX = "rehearsal_user"
DEFAULT_USER_PASSWORD = os.environ.get("REHEARSAL_USER_PASSWORD", "RehearsalPassw0rd!")


def _sha256_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_hashes() -> dict[str, str | None]:
    return {
        "benchmark-http.py": _sha256_file(Path(__file__).resolve()),
        "bench_core.py": _sha256_file(REHEARSAL_DIR / "bench_core.py"),
    }


def _git_state() -> dict[str, object]:
    status = common.run(["git", "status", "--porcelain"], check=False, timeout=15)
    porcelain = status.stdout.decode("utf-8", errors="replace").strip() if status.returncode == 0 else ""
    lines = [line for line in porcelain.splitlines() if line.strip()]
    return {"gitHead": common.git_head(), "gitDirty": bool(lines), "gitDirtyEntries": len(lines)}


def _self_test() -> int:
    import guard as _guard

    rc = _guard._selftest()
    checks = []

    def check(label: str, fn) -> None:
        try:
            fn()
            checks.append((label, True))
        except Exception:  # noqa: BLE001
            checks.append((label, False))

    check("reject inf duration", lambda: _expect_raises(warmup=1, duration=float("inf"), concurrency=1, repeats=1, request_timeout=5))
    check("reject big concurrency", lambda: _expect_raises(warmup=1, duration=5, concurrency=64, repeats=1, request_timeout=5))
    check("reject zero repeats", lambda: _expect_raises(warmup=0, duration=5, concurrency=1, repeats=0, request_timeout=5))
    check("accept valid", lambda: bench_core.validate_load_args(warmup=1, duration=5, concurrency=8, repeats=3, request_timeout=10))
    failed = [label for label, ok in checks if not ok]
    for label, ok in checks:
        print(f"[{'ok' if ok else 'FAIL'}] {label}")
    if failed:
        return 1
    print("[bench] self-test OK（guard + 负载边界）")
    return rc


def _expect_raises(**kwargs) -> None:
    try:
        bench_core.validate_load_args(**kwargs)
    except Exception:
        return
    raise AssertionError("expected failure")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Lycoris 阶段 4 公平性能测量")
    parser.add_argument("--backend", choices=["java", "rust"])
    parser.add_argument("--entry", default="http://127.0.0.1:18180", help="入口 URL")
    parser.add_argument("--scenario", choices=list(bench_core.SCENARIOS))
    parser.add_argument("--warmup", type=float, default=10.0)
    parser.add_argument("--duration", type=float, default=20.0)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--request-timeout", type=float, default=10.0)
    parser.add_argument("--seed", type=int, default=20260914)
    parser.add_argument("--cache-state", choices=["on", "off", "unknown"], default="unknown")
    parser.add_argument("--marker-ids", help="逗号分隔点位 id（覆盖自动集合；仍会记录哈希）")
    parser.add_argument("--per-category", type=int, default=25, help="自动集合每类取样数")
    parser.add_argument("--refresh-marker-set", action="store_true", help="重新从库生成点位集合")
    parser.add_argument("--work-dir", type=Path, default=common.DEFAULT_WORK_DIR)
    parser.add_argument("--out", type=Path, help="报告输出路径")
    parser.add_argument(
        "--assert-single-backend",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="默认总是执行：非目标直连端口必须关闭且入口指向目标",
    )
    parser.add_argument("--quick", action="store_true", help="smoke：warmup 2s / 测量 5s / 1 轮")
    parser.add_argument("--list-scenarios", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.self_test:
        return _self_test()
    if args.list_scenarios:
        print(json.dumps({"scenarios": list(bench_core.SCENARIOS)}, indent=2))
        return 0
    if not args.backend or not args.scenario:
        print("[error] 需要 --backend 与 --scenario（或 --self-test/--list-scenarios）", file=sys.stderr)
        return 1

    warmup, duration, repeats = args.warmup, args.duration, args.repeats
    if args.quick:
        warmup, duration, repeats = 2.0, 5.0, 1
    try:
        bench_core.validate_load_args(
            warmup=warmup, duration=duration, concurrency=args.concurrency,
            repeats=repeats, request_timeout=args.request_timeout,
        )
    except bench_core.BenchError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1

    # 报告路径在**任何负载/业务写入之前**确定：显式 --out 已存在即拒绝（不先跑一分钟再失败）。
    if args.out:
        if args.out.exists():
            print(f"[error] 报告 {args.out} 已存在，拒绝覆盖；请换文件名或删除后重试", file=sys.stderr)
            return 1
        out = args.out
    else:
        base = args.work_dir / "reports" / f"bench-{args.backend}-{args.scenario}.json"
        out = base
        index = 2
        while out.exists():
            out = base.with_name(f"{base.stem}-{index}{base.suffix}")
            index += 1

    try:
        guard.assert_http_endpoint(args.entry, name="ENTRY_URL")
    except guard.GuardError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1

    env = common.read_env_file(args.work_dir / ".env")
    pg_user = env.get("PG_REHEARSAL_USER", "")
    if not pg_user:
        print("[error] 缺少 .env 中的合成 PG 用户；先 render/seed", file=sys.stderr)
        return 1
    pg_container = common.TABLES["pg18"]["container"]
    pg_database = common.TABLES["pg18"]["database"]

    container = bench_core.BACKEND_CONTAINER[args.backend]
    meta: dict[str, object] = {
        "backend": args.backend,
        "entry": args.entry,
        "scenario": args.scenario,
        "expectedStatus": bench_core.SCENARIOS[args.scenario],
        "cacheState": args.cache_state,
        "concurrency": args.concurrency,
        "warmupSeconds": warmup,
        "durationSeconds": duration,
        "repeats": repeats,
        "requestTimeoutSeconds": args.request_timeout,
        "requestTimeoutNote": "urllib timeout 为逐次 socket 超时，非严格总 deadline",
        "seed": args.seed,
        "quickMode": bool(args.quick),
        "resourceLimits": "java/rust 2cpu/512MiB, pg 1GiB, redis 128MiB",
        "generatedAt": common.now_iso(),
        "sourceHashes": _source_hashes(),
        "uploadImage": bench_core.upload_image_info(),
    }
    meta.update(_git_state())

    try:
        if args.assert_single_backend:
            meta["singleBackend"] = bench_core.verify_single_backend(
                args.backend, args.entry, args.work_dir
            )
        meta["targetConfig"] = bench_core.verify_target_config(
            container, args.backend, args.cache_state, user=pg_user
        )
    except bench_core.BenchError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1

    try:
        if args.marker_ids:
            ids = [int(x) for x in args.marker_ids.split(",") if x.strip()]
            marker_set = {
                "ids": sorted(set(ids)),
                "count": len(set(ids)),
                "sha256": hashlib.sha256(",".join(str(i) for i in sorted(set(ids))).encode()).hexdigest(),
                "perCategory": {},
                "source": "cli override",
            }
        else:
            marker_set = bench_core.load_or_create_marker_set(
                user=pg_user,
                set_file=args.work_dir / "artifacts" / "bench-marker-set.json",
                per_category=args.per_category,
                refresh=args.refresh_marker_set,
            )
    except bench_core.BenchError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    meta["markerSet"] = {
        "count": marker_set["count"],
        "sha256": marker_set["sha256"],
        "perCategory": marker_set.get("perCategory", {}),
        "source": marker_set.get("source"),
    }
    marker_ids = list(marker_set["ids"])
    usernames = [f"{DEFAULT_USER_PREFIX}_{i}" for i in range(2, 20)]
    starting_state = bench_core.dataset_state(args.work_dir, pg_user)
    meta["startingDataset"] = starting_state

    try:
        warmup_facts = None
        if warmup > 0 and args.scenario != "idle":
            warm_concurrency = min(2, args.concurrency)
            warm_stats, warm_stuck = bench_core.run_workers(
                scenario=args.scenario,
                base_url=args.entry,
                duration=warmup,
                concurrency=warm_concurrency,
                seed=args.seed,
                marker_ids=marker_ids,
                usernames=usernames,
                password=DEFAULT_USER_PASSWORD,
                request_timeout=args.request_timeout,
            )
            total = warm_stats.total
            success = warm_stats.success
            warmup_facts = {
                "concurrency": warm_concurrency,
                "requestsTotal": total,
                "success": success,
                "error": total - success,
                "successRate": round(success / total, 4) if total else None,
                "byStatus": warm_stats.by_status,
                "networkErrors": warm_stats.network_errors,
            }
            meta["warmup"] = warmup_facts
            if warm_stuck:
                raise bench_core.BenchError(f"预热线程未结束：{warm_stuck}")
            if warm_stats.fatal_errors:
                raise bench_core.BenchError(f"预热出现异常：{warm_stats.fatal_errors[:3]}")
            if total == 0 or success == 0:
                raise bench_core.BenchError(
                    "预热零成功（或零请求），拒绝进入正式测量；不隐藏非 200"
                )
        rounds: list[bench_core.RoundResult] = []
        growth = []
        for index in range(repeats):
            before = bench_core.dataset_state(args.work_dir, pg_user)
            result = bench_core.run_round(
                scenario=args.scenario,
                base_url=args.entry,
                duration=duration,
                concurrency=args.concurrency,
                seed=args.seed + index,
                marker_ids=marker_ids,
                usernames=usernames,
                password=DEFAULT_USER_PASSWORD,
                request_timeout=args.request_timeout,
                container=container,
                pg_container=pg_container,
                pg_database=pg_database,
                pg_user=pg_user,
                round_index=index,
            )
            bench_core.assert_meaningful(result, args.scenario)
            after = bench_core.dataset_state(args.work_dir, pg_user)
            growth.append(bench_core.dataset_growth(before, after))
            rounds.append(result)
            print(
                f"[bench] round {index + 1}/{repeats}: total={result.stats.total} "
                f"success={result.stats.success} status={result.stats.by_status}"
            )
    except (bench_core.BenchError, common.GuardError) as exc:
        print(f"[bench] FAIL: {exc}", file=sys.stderr)
        return 1

    raw_rounds = [
        {
            "round": r.round,
            "measureStartedAt": r.measure_started,
            "measureEndedAt": r.measure_ended,
            "measureSeconds": r.measure_seconds,
            "total": r.stats.total,
            "success": r.stats.success,
            "error": r.stats.total - r.stats.success,
            "networkErrors": r.stats.network_errors,
            "byStatus": r.stats.by_status,
            "fatalErrors": r.stats.fatal_errors,
            "successLatenciesMs": r.stats.success_latencies_ms,
            "errorLatenciesMs": r.stats.error_latencies_ms,
            "metrics": r.metrics,
            "datasetGrowth": growth[index] if index < len(growth) else None,
        }
        for index, r in enumerate(rounds)
    ]
    summary = bench_core.summarize_rounds(rounds, args.scenario)
    report = {
        "meta": meta,
        "rounds": raw_rounds,
        "summary": summary,
        "endingDataset": bench_core.dataset_state(args.work_dir, pg_user),
    }
    if not args.out:
        # 运行期间若同名文件出现，再顺延避免覆盖（显式 --out 已在运行前拒绝）。
        base = args.work_dir / "reports" / f"bench-{args.backend}-{args.scenario}.json"
        index = 2
        while out.exists():
            out = base.with_name(f"{base.stem}-{index}{base.suffix}")
            index += 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    meta["reportPath"] = str(out)
    print(f"[bench] summary {json.dumps(summary, ensure_ascii=False)}")
    print(f"[bench] 报告 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
