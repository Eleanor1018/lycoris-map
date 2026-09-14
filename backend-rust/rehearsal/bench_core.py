#!/usr/bin/env python3
"""公平性能测量核心（纯标准库，独立于 CLI）。

要点（第三轮审查后）
- 有界负载参数；拒绝无限/过大。
- 每 worker 独立结果，主线程收集异常并汇总；网络超时/连接失败计错误。
- 正常场景（read/login/upload）成功仅认 200；**其它状态（含 401）一律计入错误率**，
  同时按状态细分类保留；拒绝负载另用 `reject-login` 场景（期望 401）。
- 成功/错误延迟分离；真实测量窗口。
- 采样一次 docker exec 取 memory/cpu/VmRSS；采样线程必须完全停止，否则报错、禁止进入下一轮。
- 受测容器配置核验：image/user/limits/白名单 env；Java BCrypt cost 10 用源码 + 实际 hash 证明。
- 默认读负载从合成库真实公开 APPROVED 四类点位选取，并将 ID 集合落盘 + 记录哈希，保证配对一致。

注意：urllib 的 timeout 是逐次 socket 操作超时，**不保证响应总时限**；本工具用较小的
request_timeout + 线程 join 上限拒绝卡住轮次，不宣称严格总 deadline。
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from http.cookiejar import CookieJar
from pathlib import Path

import common
import guard
import synthetic_media

BOUNDS = {
    "warmup": (0.0, 120.0),
    "duration": (1.0, 600.0),
    "concurrency": (1, 32),
    "repeats": (1, 5),
    "request_timeout": (0.5, 60.0),
}
# scenario -> 期望成功状态码（其它状态计错误）。
SCENARIOS = {
    "idle": 200,
    "read": 200,
    "login": 200,
    "upload": 200,
    "reject-login": 401,
}
READ_CATEGORIES = ("accessible_toilet", "friendly_clinic", "baby_room", "self_definition")
REHEARSAL_WEB_ORIGIN = "http://localhost:5198"
BACKEND_DIRECT = {"java": guard.JAVA_PORT, "rust": guard.RUST_PORT}
BACKEND_CONTAINER = {"java": common.JAVA_CONTAINER, "rust": common.RUST_CONTAINER}
WHITELIST_ENV_KEYS = (
    "BCRYPT_COST",
    "DB_MAX_CONNECTIONS",
    "DB_STATEMENT_TIMEOUT_MS",
    "DB_LOCK_TIMEOUT_MS",
    "PASSWORD_MAX_CONCURRENCY",
    "MEDIA_MAX_CONCURRENCY",
    "MARKER_CACHE_REDIS_ENABLED",
    "SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE",
    "SERVER_SSL_ENABLED",
    "APP_UPLOAD_DIR",
    "UPLOAD_DIR",
    "SESSION_NAMESPACE",
    "SESSION_COOKIE_NAME",
)
PROBE_MAX_BYTES = 8 * 1024 * 1024
# 上传负载用固定 512x512 合成 PNG（同后端/配对一致，不由 seed/worker 变化）。
UPLOAD_IMAGE_SIZE = 512
UPLOAD_IMAGE_SEED = 424242


def upload_image_info() -> dict[str, object]:
    data = synthetic_media.png_bytes(UPLOAD_IMAGE_SIZE, UPLOAD_IMAGE_SIZE, UPLOAD_IMAGE_SEED)
    return {
        "width": UPLOAD_IMAGE_SIZE,
        "height": UPLOAD_IMAGE_SIZE,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "seed": UPLOAD_IMAGE_SEED,
    }


class BenchError(RuntimeError):
    pass


class BenchNetworkError(BenchError):
    """连接失败/超时（计入错误，不静默消失）。"""


def validate_load_args(
    *, warmup: float, duration: float, concurrency: int, repeats: int, request_timeout: float
) -> None:
    for name, value in (("warmup", warmup), ("duration", duration), ("request_timeout", request_timeout)):
        if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise BenchError(f"{name} 必须是有限数值")
        low, high = BOUNDS[name]
        if not (low <= float(value) <= high):
            raise BenchError(f"{name} 必须在 [{low}, {high}] 内（实际 {value}）")
    for name, value in (("concurrency", concurrency), ("repeats", repeats)):
        low, high = BOUNDS[name]
        if not isinstance(value, int) or isinstance(value, bool):
            raise BenchError(f"{name} 必须是整数")
        if not (low <= value <= high):
            raise BenchError(f"{name} 必须在 [{low}, {high}] 内（实际 {value}）")


# --------------------------------------------------------------------------
# HTTP 客户端
# --------------------------------------------------------------------------


@dataclass
class Client:
    base_url: str
    timeout: float = 10.0
    cookies: CookieJar = field(default_factory=CookieJar)

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body=None,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
        timeout: float | None = None,
    ) -> tuple[int, bytes]:
        body = data
        request_headers = {
            "Origin": REHEARSAL_WEB_ORIGIN,
            "Referer": REHEARSAL_WEB_ORIGIN + "/",
            "Accept": "application/json, text/plain, */*",
        }
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        if headers:
            request_headers.update(headers)
        effective_timeout = self.timeout if timeout is None else timeout
        req = urllib.request.Request(
            self.base_url + path, data=body, method=method, headers=request_headers
        )
        try:
            with self._opener.open(req, timeout=effective_timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise BenchNetworkError(type(exc).__name__) from exc


def _multipart_png(png: bytes, filename: str) -> tuple[bytes, str]:
    boundary = "----lycorisBench" + uuid.uuid4().hex
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        "Content-Type: image/png\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    return head + png + tail, f"multipart/form-data; boundary={boundary}"


# --------------------------------------------------------------------------
# 采样（一次 exec 取三项；必须完全停止）
# --------------------------------------------------------------------------


@dataclass
class Sample:
    memory_current: int | None = None
    cpu_cores: float | None = None
    vm_rss_kb: int | None = None
    sample_cost_ms: float | None = None


class Sampler(threading.Thread):
    _SCRIPT = (
        "m=$(cat /sys/fs/cgroup/memory.current 2>/dev/null || "
        "cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null);"
        'echo "MEM:$m";'
        "grep -m1 '^usage_usec' /sys/fs/cgroup/cpu.stat 2>/dev/null;"
        "grep -m1 '^VmRSS' /proc/1/status 2>/dev/null"
    )
    # exec 命令自身 timeout 15s；join 至少覆盖它，避免返回后仍在写 samples。
    EXEC_TIMEOUT = 15.0

    def __init__(self, container: str, *, interval: float = 1.0):
        super().__init__(daemon=True)
        self.container = container
        self.interval = interval
        self._stop_event = threading.Event()
        self.samples: list[Sample] = []
        self.stop_failed = False
        self._last_cpu_usec: int | None = None
        self._last_cpu_ts: float | None = None

    def _sample_once(self) -> None:
        started = time.perf_counter()
        now = time.monotonic()
        result = common.run(
            ["docker", "exec", self.container, "sh", "-c", self._SCRIPT],
            check=False,
            timeout=int(self.EXEC_TIMEOUT),
        )
        text = result.stdout.decode("utf-8", errors="replace") if result.returncode == 0 else ""
        mem = cpu_usec = vm_rss = None
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("MEM:"):
                value = line[4:].strip()
                if value.isdigit():
                    mem = int(value)
            elif line.startswith("usage_usec"):
                parts = line.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    cpu_usec = int(parts[1])
            elif line.startswith("VmRSS:"):
                parts = line.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    vm_rss = int(parts[1])
        cores = None
        if cpu_usec is not None and self._last_cpu_usec is not None:
            delta_wall = now - (self._last_cpu_ts or now)
            if delta_wall > 0:
                cores = (cpu_usec - self._last_cpu_usec) / (delta_wall * 1_000_000)
        if cpu_usec is not None:
            self._last_cpu_usec = cpu_usec
            self._last_cpu_ts = now
        self.samples.append(
            Sample(mem, cores, vm_rss, round((time.perf_counter() - started) * 1000, 3))
        )

    def run(self) -> None:
        while not self._stop_event.wait(self.interval):
            self._sample_once()

    def stop_collect(self) -> list[Sample]:
        self._stop_event.set()
        deadline = time.monotonic() + self.EXEC_TIMEOUT + 5.0
        while self.is_alive() and time.monotonic() < deadline:
            self.join(timeout=0.5)
        if self.is_alive():
            self.stop_failed = True
        return list(self.samples)


def _range(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"min": None, "avg": None, "max": None, "samples": 0}
    return {
        "min": min(values),
        "avg": round(statistics.fmean(values), 3),
        "max": max(values),
        "samples": len(values),
    }


def aggregate_samples(samples: list[Sample], attr: str) -> dict[str, float | None]:
    values = [getattr(s, attr) for s in samples if getattr(s, attr) is not None]
    if not values:
        return {"min": None, "avg": None, "max": None}
    return {"min": min(values), "avg": round(statistics.fmean(values), 3), "max": max(values)}


# --------------------------------------------------------------------------
# 负载执行
# --------------------------------------------------------------------------


@dataclass
class WorkerStats:
    total: int = 0
    success: int = 0
    by_status: dict[str, int] = field(default_factory=dict)
    success_latencies_ms: list[float] = field(default_factory=list)
    error_latencies_ms: list[float] = field(default_factory=list)
    network_errors: int = 0
    fatal_errors: list[str] = field(default_factory=list)
    setup_samples_ms: list[float] = field(default_factory=list)

    def record(self, status: int, latency_ms: float, expected: int) -> None:
        self.total += 1
        self.by_status[str(status)] = self.by_status.get(str(status), 0) + 1
        if status == expected:
            self.success += 1
            self.success_latencies_ms.append(round(latency_ms, 3))
        else:
            self.error_latencies_ms.append(round(latency_ms, 3))

    def record_network(self, kind: str, latency_ms: float) -> None:
        self.total += 1
        self.network_errors += 1
        self.by_status[f"net:{kind}"] = self.by_status.get(f"net:{kind}", 0) + 1
        self.error_latencies_ms.append(round(latency_ms, 3))

    def merge_into(self, target: "WorkerStats") -> None:
        target.total += self.total
        target.success += self.success
        target.network_errors += self.network_errors
        for key, value in self.by_status.items():
            target.by_status[key] = target.by_status.get(key, 0) + value
        target.success_latencies_ms.extend(self.success_latencies_ms)
        target.error_latencies_ms.extend(self.error_latencies_ms)
        target.fatal_errors.extend(self.fatal_errors)
        target.setup_samples_ms.extend(self.setup_samples_ms)


def _read_request(client: Client, rng: random.Random, marker_ids: list[int]) -> int:
    choice = rng.random()
    if choice < 0.4:
        status, _ = client.request("GET", f"/api/markers/{rng.choice(marker_ids)}")
    elif choice < 0.7:
        status, _ = client.request(
            "GET",
            f"/api/markers/nearby?lat=31.23&lng=121.47&radius={rng.choice([500, 1000, 2000])}",
        )
    else:
        status, _ = client.request(
            "GET",
            "/api/markers/viewport?minLat=31.15&maxLat=31.31&minLng=121.38&maxLng=121.57",
        )
    return status


def _worker(
    *,
    index: int,
    scenario: str,
    base_url: str,
    deadline: float,
    stop_event: threading.Event,
    seed: int,
    marker_ids: list[int],
    usernames: list[str],
    password: str,
    request_timeout: float,
    expected: int,
    stats: WorkerStats,
) -> None:
    rng = random.Random(seed + index)
    try:
        setup_started = time.perf_counter()
        client = Client(base_url, timeout=request_timeout)
        username = usernames[index % len(usernames)]
        png = (
            synthetic_media.png_bytes(UPLOAD_IMAGE_SIZE, UPLOAD_IMAGE_SIZE, UPLOAD_IMAGE_SEED)
            if scenario == "upload"
            else b""
        )
        if scenario == "upload":
            status, _ = client.request(
                "POST", "/api/login", json_body={"username": username, "password": password}
            )
            if status != 200:
                stats.fatal_errors.append(f"uploadLoginFailed:{status}")
                stats.setup_samples_ms.append(round((time.perf_counter() - setup_started) * 1000, 3))
                return
        # 记录 worker 准备开销（client/png 生成/上传前登录），它落在测量窗口内但不计入单请求延迟。
        stats.setup_samples_ms.append(round((time.perf_counter() - setup_started) * 1000, 3))
        while not stop_event.is_set() and time.monotonic() < deadline:
            started = time.perf_counter()
            try:
                if scenario == "login":
                    status, _ = client.request(
                        "POST",
                        "/api/login",
                        json_body={"username": username, "password": password},
                    )
                elif scenario == "read":
                    status = _read_request(client, rng, marker_ids)
                elif scenario == "upload":
                    body, content_type = _multipart_png(png, "bench-upload.png")
                    status, _ = client.request(
                        "POST",
                        f"/api/markers/{rng.choice(marker_ids)}/image",
                        data=body,
                        headers={"Content-Type": content_type},
                    )
                elif scenario == "reject-login":
                    status, _ = client.request(
                        "POST",
                        "/api/login",
                        json_body={"username": f"{username}_invalid", "password": "bad"},
                    )
                else:
                    raise BenchError(f"未知场景 {scenario}")
                stats.record(status, (time.perf_counter() - started) * 1000, expected)
            except BenchNetworkError as exc:
                stats.record_network(str(exc), (time.perf_counter() - started) * 1000)
    except Exception as exc:  # noqa: BLE001 - 线程异常必须上报
        stats.fatal_errors.append(f"{type(exc).__name__}:{exc}"[:200])


def run_workers(
    *,
    scenario: str,
    base_url: str,
    duration: float,
    concurrency: int,
    seed: int,
    marker_ids: list[int],
    usernames: list[str],
    password: str,
    request_timeout: float,
) -> tuple[WorkerStats, list[str]]:
    expected = SCENARIOS[scenario]
    stats_list = [WorkerStats() for _ in range(concurrency)]
    stop_event = threading.Event()
    deadline = time.monotonic() + duration
    threads = []
    for index in range(concurrency):
        thread = threading.Thread(
            target=_worker,
            kwargs=dict(
                index=index,
                scenario=scenario,
                base_url=base_url,
                deadline=deadline,
                stop_event=stop_event,
                seed=seed,
                marker_ids=marker_ids,
                usernames=usernames,
                password=password,
                request_timeout=request_timeout,
                expected=expected,
                stats=stats_list[index],
            ),
            daemon=True,
        )
        threads.append(thread)
        thread.start()
    time.sleep(max(0.0, deadline - time.monotonic()))
    stop_event.set()
    join_deadline = time.monotonic() + request_timeout + 5.0
    stuck = []
    for index, thread in enumerate(threads):
        thread.join(timeout=max(0.0, join_deadline - time.monotonic()))
        if thread.is_alive():
            stuck.append(f"worker-{index}")
    merged = WorkerStats()
    for stats in stats_list:
        stats.merge_into(merged)
    return merged, stuck


# --------------------------------------------------------------------------
# 单轮
# --------------------------------------------------------------------------


@dataclass
class RoundResult:
    round: int
    stats: WorkerStats
    measure_started: str
    measure_ended: str
    measure_seconds: float
    stuck_threads: list[str]
    metrics: dict[str, object] = field(default_factory=dict)


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round((pct / 100.0) * (len(ordered) - 1))))
    return ordered[index]


def run_round(
    *,
    scenario: str,
    base_url: str,
    duration: float,
    concurrency: int,
    seed: int,
    marker_ids: list[int],
    usernames: list[str],
    password: str,
    request_timeout: float,
    container: str,
    round_index: int,
) -> RoundResult:
    from datetime import datetime, timezone

    sampler = Sampler(container)
    sampler.start()
    started = datetime.now(timezone.utc)
    if scenario == "idle":
        time.sleep(duration)
        stats, stuck = WorkerStats(), []
    else:
        stats, stuck = run_workers(
            scenario=scenario,
            base_url=base_url,
            duration=duration,
            concurrency=concurrency,
            seed=seed,
            marker_ids=marker_ids,
            usernames=usernames,
            password=password,
            request_timeout=request_timeout,
        )
    ended = datetime.now(timezone.utc)
    samples = sampler.stop_collect()
    if sampler.stop_failed:
        raise BenchError("采样线程未在超时内停止，禁止进入下一轮")
    if stuck:
        raise BenchError(f"第 {round_index} 轮有线程未在请求超时内结束：{stuck}")
    metrics = {
        "containerMemoryBytes": aggregate_samples(samples, "memory_current"),
        "containerCpuCores": aggregate_samples(samples, "cpu_cores"),
        "processVmRssKb": aggregate_samples(samples, "vm_rss_kb"),
        "sampleCount": len(samples),
        "sampleCostMs": aggregate_samples(samples, "sample_cost_ms"),
        "setupMs": _range(stats.setup_samples_ms),
        "setupNote": "worker 准备（client/512 图像生成/上传前登录）落在测量窗口内；单请求延迟不含登录/生成",
    }
    return RoundResult(
        round=round_index,
        stats=stats,
        measure_started=started.isoformat(),
        measure_ended=ended.isoformat(),
        measure_seconds=round((ended - started).total_seconds(), 3),
        stuck_threads=stuck,
        metrics=metrics,
    )


def assert_meaningful(result: RoundResult, scenario: str) -> None:
    if result.stats.fatal_errors:
        raise BenchError(f"worker 异常：{result.stats.fatal_errors[:3]}")
    if scenario != "idle" and result.stats.total == 0:
        raise BenchError("非 idle 场景没有任何请求完成（拒绝假成功）")
    if scenario != "idle" and result.stats.success == 0:
        raise BenchError("非 idle 场景成功数为 0（拒绝假成功）")


def summarize_rounds(rounds: list[RoundResult], scenario: str) -> dict[str, object]:
    total = sum(r.stats.total for r in rounds)
    success = sum(r.stats.success for r in rounds)
    network = sum(r.stats.network_errors for r in rounds)
    success_lat = [v for r in rounds for v in r.stats.success_latencies_ms]
    error_lat = [v for r in rounds for v in r.stats.error_latencies_ms]
    window = sum(r.measure_seconds for r in rounds)
    return {
        "scenario": scenario,
        "expectedStatus": SCENARIOS.get(scenario),
        "requestsTotal": total,
        "success": success,
        "networkErrors": network,
        "unexpectedErrors": total - success,
        "errorRate": round((total - success) / total, 4) if total else None,
        "successRate": round(success / total, 4) if total else None,
        "byStatus": _merge_status(rounds),
        "successLatencyMs": {
            "p50": _percentile(success_lat, 50),
            "p95": _percentile(success_lat, 95),
            "max": max(success_lat) if success_lat else None,
            "samples": len(success_lat),
        },
        "errorLatencyMs": {
            "p50": _percentile(error_lat, 50),
            "p95": _percentile(error_lat, 95),
            "max": max(error_lat) if error_lat else None,
            "samples": len(error_lat),
        },
        "throughputSuccessPerSecond": round(success / window, 3) if window else None,
        "requestsPerSecond": round(total / window, 3) if window else None,
        "measuredWindowSeconds": round(window, 3),
        "denominator": (
            "requestsTotal=成功(expected)+其余全部错误（含 401/5xx/网络）；"
            "吞吐窗口为各轮实际测量秒数之和；urllib timeout 为逐次 socket 超时，非严格总 deadline"
        ),
        "note": "不判定是否达到任意百分比目标，仅呈现原始测量",
    }


def _merge_status(rounds: list[RoundResult]) -> dict[str, int]:
    merged: dict[str, int] = {}
    for result in rounds:
        for status, count in result.stats.by_status.items():
            merged[status] = merged.get(status, 0) + count
    return merged


# --------------------------------------------------------------------------
# 读负载点位集合（真实公开 APPROVED 四类；落盘保证配对一致）
# --------------------------------------------------------------------------


def load_or_create_marker_set(
    *, user: str, set_file: Path, per_category: int = 25, refresh: bool = False
) -> dict[str, object]:
    if set_file.is_file() and not refresh:
        data = json.loads(set_file.read_text(encoding="utf-8"))
        if data.get("ids"):
            return data
    spec = common.TABLES["pg18"]
    in_list = ",".join(f"'{c}'" for c in READ_CATEGORIES)
    raw = common.psql(
        spec["container"],
        spec["database"],
        "SELECT category || '|' || id FROM public.map_markers "
        f"WHERE is_public AND review_status='APPROVED' AND category IN ({in_list}) "
        "ORDER BY category, id;",
        user=user,
    )
    by_category: dict[str, list[int]] = {}
    for line in raw.splitlines():
        category, _, marker_id = line.strip().partition("|")
        if marker_id.isdigit():
            by_category.setdefault(category, []).append(int(marker_id))
    if not by_category:
        raise BenchError("合成库没有公开 APPROVED 的四类点位，无法做正常读负载")
    selected: list[int] = []
    layout: dict[str, int] = {}
    for category in READ_CATEGORIES:
        ids = by_category.get(category, [])
        if not ids:
            raise BenchError(f"类别 {category} 没有公开 APPROVED 点位")
        step = max(1, len(ids) // per_category)
        picked = ids[::step][:per_category]
        selected.extend(picked)
        layout[category] = len(picked)
    selected = sorted(set(selected))
    digest = hashlib.sha256(",".join(str(i) for i in selected).encode()).hexdigest()
    result = {
        "ids": selected,
        "count": len(selected),
        "sha256": digest,
        "perCategory": layout,
        "source": "public APPROVED four categories",
    }
    set_file.parent.mkdir(parents=True, exist_ok=True)
    set_file.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    return result


# --------------------------------------------------------------------------
# 受测容器配置核验
# --------------------------------------------------------------------------


def _container_details(container: str) -> dict:
    result = common.run(["docker", "inspect", container], check=False, timeout=30)
    if result.returncode != 0:
        raise BenchError(f"无法 inspect 受测容器 {container}")
    try:
        return json.loads(result.stdout.decode("utf-8", errors="replace"))[0]
    except json.JSONDecodeError as exc:
        raise BenchError(f"inspect 输出无法解析：{exc}") from exc


def verify_target_config(container: str, backend: str, cache_state: str, *, user: str) -> dict[str, object]:
    data = _container_details(container)
    host = data.get("HostConfig", {})
    config = data.get("Config", {})
    memory = host.get("Memory")
    nano_cpus = host.get("NanoCpus") or 0
    cpus = round(nano_cpus / 1_000_000_000, 3) if nano_cpus else None
    container_user = config.get("User") or ""
    env = {}
    for entry in config.get("Env", []) or []:
        key, _, value = entry.partition("=")
        if key in WHITELIST_ENV_KEYS:
            env[key] = value
    facts = {
        "container": container,
        "backend": backend,
        "imageId": data.get("Image"),
        "imageTag": config.get("Image"),
        "user": container_user or "<image-default>",
        "memoryBytes": memory,
        "cpus": cpus,
        "envWhitelist": env,
    }
    if memory != 512 * 1024 * 1024:
        raise BenchError(f"受测容器内存限制不是 512MiB（实际 {memory}）")
    if cpus != 2.0:
        raise BenchError(f"受测容器 CPU 限制不是 2.0（实际 {cpus}）")
    expected_cache = {"on": "true", "off": "false"}.get(cache_state)
    if backend == "rust":
        if env.get("BCRYPT_COST") != "10":
            raise BenchError(f"Rust BCRYPT_COST 不是 10（实际 {env.get('BCRYPT_COST')}）")
        if env.get("DB_MAX_CONNECTIONS") != "10":
            raise BenchError("Rust DB_MAX_CONNECTIONS 不是 10")
        for key, expected_value in (
            ("DB_STATEMENT_TIMEOUT_MS", "20000"),
            ("DB_LOCK_TIMEOUT_MS", "5000"),
            ("PASSWORD_MAX_CONCURRENCY", "2"),
            ("MEDIA_MAX_CONCURRENCY", "1"),
        ):
            if env.get(key) != expected_value:
                raise BenchError(f"Rust {key} 不是 {expected_value}（实际 {env.get(key)}）")
        if container_user not in ("10001", "10001:10001"):
            raise BenchError(f"Rust 未以 UID 10001 运行（实际 {container_user!r}）")
    else:
        if env.get("SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE") != "10":
            raise BenchError("Java Hikari 池上限不是 10")
        if env.get("SERVER_SSL_ENABLED") not in (None, "false"):
            raise BenchError("Java 未关闭 SSL")
        if container_user not in ("10001", "10001:10001"):
            raise BenchError(f"Java 未以 UID 10001 运行（实际 {container_user!r}）")
    if expected_cache and env.get("MARKER_CACHE_REDIS_ENABLED") != expected_cache:
        raise BenchError("缓存开关与 --cache-state 不一致")
    facts["bcryptCostEvidence"] = verify_bcrypt_cost(backend, user=user, env=env)
    return facts


def verify_bcrypt_cost(backend: str, *, user: str, env: dict[str, str]) -> dict[str, object]:
    if backend == "rust":
        return {"source": "env BCRYPT_COST", "bcryptCost": env.get("BCRYPT_COST")}
    # Java：源码默认 + 实际库中 hash 前缀双证据。
    source = common.REPO_ROOT / "backend" / "src" / "main" / "java" / "com" / "lycoris" / "config" / "PasswordConfig.java"
    evidence: dict[str, object] = {"sourcePath": str(source)}
    if source.is_file():
        text = source.read_text(encoding="utf-8")
        evidence["sourceUsesDefaultEncoder"] = "new BCryptPasswordEncoder()" in text
        evidence["sourceSha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    spec = common.TABLES["pg18"]
    raw = common.psql(
        spec["container"],
        spec["database"],
        "SELECT DISTINCT substring(password from 1 for 7) FROM public.users "
        "WHERE password LIKE '$2%' LIMIT 5;",
        user=user,
        check=False,
        timeout=15,
    )
    prefixes = [line.strip() for line in raw.splitlines() if line.strip()]
    evidence["observedHashPrefixes"] = prefixes
    if not any(p in ("$2a$10$", "$2b$10$", "$2y$10$") for p in prefixes):
        raise BenchError(f"未观测到 cost 10 的 BCrypt 哈希前缀（{prefixes}）")
    return evidence


def verify_single_backend(backend: str, entry: str, work_dir: Path) -> dict[str, object]:
    other = "rust" if backend == "java" else "java"
    if _port_open("127.0.0.1", BACKEND_DIRECT[other]):
        raise BenchError(f"非目标后端 {other} 直连端口仍开放，拒绝运行")
    if not _port_open("127.0.0.1", BACKEND_DIRECT[backend]):
        raise BenchError(f"目标后端 {backend} 直连端口未开放")
    conf = work_dir / "nginx" / "conf.d" / "entry.conf"
    if not conf.is_file():
        raise BenchError("找不到渲染后的 Nginx entry.conf")
    text = conf.read_text(encoding="utf-8")
    expected = f'set $active_backend "{backend}:8080";'
    if expected not in text or "__ACTIVE_BACKEND__" in text:
        raise BenchError("入口 Nginx 未指向目标后端（或含未渲染占位符）")
    status = _entry_me_status(entry)
    if status not in (200, 401):
        raise BenchError(f"入口 /api/me 不可用（状态 {status}）")
    return {
        "targetBackend": backend,
        "nonTargetPortClosed": True,
        "entryConfPointsToTarget": True,
        "entryMeStatus": status,
    }


def _port_open(host: str, port: int, timeout: float = 0.5) -> bool:
    import socket

    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _entry_me_status(entry: str, timeout: float = 5.0) -> int:
    client = Client(entry, timeout=timeout)
    try:
        status, _ = client.request("GET", "/api/me")
        return status
    except BenchNetworkError:
        return 0


def dataset_state(work_dir: Path, user: str) -> dict[str, object]:
    spec = common.TABLES["pg18"]
    counts: dict[str, int] = {}
    try:
        for table in ("map_markers", "marker_image_proposals", "map_marker_translations"):
            raw = common.psql(
                spec["container"],
                spec["database"],
                f'SELECT count(*) FROM public."{table}";',
                user=user,
                check=False,
                timeout=15,
            )
            counts[table] = int(raw.strip() or 0)
    except Exception:  # noqa: BLE001
        counts = {}
    media = common.media_fingerprint(work_dir / "uploads")
    return {
        "tableCounts": counts,
        "mediaFileCount": media["fileCount"],
        "mediaCombinedSha256": media["combinedSha256"],
    }


def dataset_growth(before: dict[str, object], after: dict[str, object]) -> dict[str, object]:
    before_counts = before.get("tableCounts") or {}
    after_counts = after.get("tableCounts") or {}
    growth = {
        table: after_counts.get(table, 0) - before_counts.get(table, 0)
        for table in set(before_counts) | set(after_counts)
    }
    return {
        "tableGrowth": growth,
        "mediaFileGrowth": (after.get("mediaFileCount") or 0)
        - (before.get("mediaFileCount") or 0),
        "stateReset": False,
        "note": "上传/写入会累积；跨后端配对时需从受控基线重置或使用本增长记录比较",
    }
