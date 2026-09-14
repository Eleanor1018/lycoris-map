#!/usr/bin/env python3
"""汇总 benchmark-http 的正式报告为机器汇总 JSON + 可读对照表（纯标准库）。

规则
- 输入为本工具汇总格式（顶层 `reports`、且非 benchmark）的文件**显式跳过**，不会把
  自己生成的 `perf-summary*.json` 当输入（否则第二次运行会读入并产生全 None 行）。
- 匹配到的输入若 JSON 损坏或不是合法 benchmark 报告（缺 meta/rounds/summary 或类型错）
  则**失败返回非 0 且不写成功汇总**；合法 summary 文件才允许跳过。
- 缺失指标显示 n/a，不伪造 0。表格列 `errRate` 为 0..1 的错误率。
- 输出唯一文件名（已存在追加 -N），不覆盖，也不改动原报告。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def _metrics(rnd: dict, key: str) -> dict:
    return (rnd.get("metrics") or {}).get(key, {}) or {}


def classify(data: object) -> str:
    """'benchmark' | 'summary'（本工具汇总，合法跳过）| 'invalid'。"""
    if not isinstance(data, dict):
        return "invalid"
    if "reports" in data and "meta" not in data and "rounds" not in data:
        return "summary"
    if not isinstance(data.get("meta"), dict):
        return "invalid"
    if not isinstance(data.get("rounds"), list):
        return "invalid"
    if not isinstance(data.get("summary"), dict):
        return "invalid"
    return "benchmark"


def summarize(report: dict) -> dict:
    meta = report.get("meta", {})
    summary = report.get("summary", {})
    rounds = report.get("rounds", [])
    cfg = meta.get("targetConfig", {}) if isinstance(meta.get("targetConfig"), dict) else {}
    pg = []
    for rnd in rounds:
        conns = _metrics(rnd, "pgConnections")
        pg.append(
            {
                "round": rnd.get("round"),
                "total": (conns.get("total") or {}).get("max"),
                "active": (conns.get("active") or {}).get("max"),
                "nonActive": (conns.get("nonActive") or {}).get("max"),
                "validSamples": conns.get("validSamples"),
                "failedSamples": conns.get("failedSamples"),
            }
        )
    return {
        "backend": meta.get("backend"),
        "scenario": meta.get("scenario"),
        "cacheState": meta.get("cacheState"),
        "imageTag": cfg.get("imageTag"),
        "imageId": cfg.get("imageId"),
        "containerUser": cfg.get("user"),
        "cpu": cfg.get("cpus"),
        "memoryBytes": cfg.get("memoryBytes"),
        "uploadImage": meta.get("uploadImage"),
        "markerSet": meta.get("markerSet"),
        "requestsTotal": summary.get("requestsTotal"),
        "success": summary.get("success"),
        "unexpectedErrors": summary.get("unexpectedErrors"),
        "errorRate": summary.get("errorRate"),
        "p50Ms": (summary.get("successLatencyMs") or {}).get("p50"),
        "p95Ms": (summary.get("successLatencyMs") or {}).get("p95"),
        "throughput": summary.get("throughputSuccessPerSecond"),
        "measuredSeconds": summary.get("measuredWindowSeconds"),
        "pgConnectionsPerRound": pg,
        "rounds": [
            {
                "round": rnd.get("round"),
                "total": rnd.get("total"),
                "success": rnd.get("success"),
                "error": rnd.get("error"),
                "byStatus": rnd.get("byStatus"),
                "metrics": rnd.get("metrics"),
                "datasetGrowth": rnd.get("datasetGrowth"),
            }
            for rnd in rounds
        ],
    }


def _cell(value: object) -> str:
    return "n/a" if value is None else str(value)


def _unique(path: Path) -> Path:
    if not path.exists():
        return path
    index = 2
    while path.with_name(f"{path.stem}-{index}{path.suffix}").exists():
        index += 1
    return path.with_name(f"{path.stem}-{index}{path.suffix}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="汇总正式 benchmark 报告")
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--pattern", default="perf-*.json")
    parser.add_argument("--out", type=Path, help="机器汇总输出路径")
    args = parser.parse_args(argv)

    reports_dir = args.work_dir / "reports"
    files = sorted(reports_dir.glob(args.pattern))
    if not files:
        print(f"[summary] 未找到 {args.pattern}", file=sys.stderr)
        return 1

    rows: list[dict] = []
    skipped_summary: list[str] = []
    invalid: list[str] = []
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            invalid.append(f"{path.name}: 损坏 JSON")
            continue
        kind = classify(data)
        if kind == "summary":
            skipped_summary.append(path.name)  # 本工具汇总，显式跳过
            continue
        if kind == "invalid":
            invalid.append(f"{path.name}: 非合法 benchmark 结构")
            continue
        row = summarize(data)
        row["file"] = path.name
        rows.append(row)

    if invalid:
        for line in invalid:
            print(f"[summary] 无效输入：{line}", file=sys.stderr)
        print("[summary] 存在无效输入，拒绝写成功汇总", file=sys.stderr)
        return 1
    if not rows:
        print("[summary] 没有有效的 benchmark 报告", file=sys.stderr)
        return 1

    rows.sort(key=lambda r: (str(r["scenario"]), str(r["cacheState"]), str(r["backend"])))
    out = args.out or (reports_dir / "perf-summary.json")
    out = _unique(out)
    out.write_text(json.dumps({"reports": rows}, ensure_ascii=False, indent=2), encoding="utf-8")

    header = (
        f"{'scenario':12} {'cache':5} {'backend':6} {'n':>7} {'succ':>7} "
        f"{'errRate':>8} {'p50':>9} {'p95':>9} {'rps':>8} {'win(s)':>8}"
    )
    print(header)
    for r in rows:
        print(
            f"{_cell(r['scenario']):12} {_cell(r['cacheState']):5} {_cell(r['backend']):6} "
            f"{_cell(r['requestsTotal']):>7} {_cell(r['success']):>7} {_cell(r['errorRate']):>8} "
            f"{_cell(r['p50Ms']):>9} {_cell(r['p95Ms']):>9} {_cell(r['throughput']):>8} "
            f"{_cell(r['measuredSeconds']):>8}"
        )
    print(
        f"[summary] benchmark={len(rows)} skippedSummary={len(skipped_summary)} -> {out.name}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
