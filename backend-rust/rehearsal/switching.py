#!/usr/bin/env python3
"""同一入口切换编排：维护冻结、写者停止核验、目标就绪、入口激活、分代 Cookie 隔离。

要点（第三轮审查后）
- 失败必须重新 freeze 并**实测** 503；freeze 失败则报“未知/未冻结”，绝不误报维护态。
- 入口探测设明确响应上限并检测超限，不截断后当全量解析。
- 旧 Cookie 真实采集并以严格 401 证明失效；非 401 视为未验证/失败。
- generation 用持久 runId + 单调序号；启动前原子登记为已用，失败也不可复用；状态损坏即拒绝。
- 旧 Cookie 存本地合成 vault（仅内存/本地文件，不打印、不提交），返回 Java 时重放**最初** Java Cookie。
- compose 最终 resolved config 实测（不打印 secret），确保运行目标与 guard 一致。
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from http.client import RemoteDisconnected
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Callable

import common
import guard

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ENTRY_TMPL = common.REHEARSAL_ROOT / "nginx" / "entry.conf.tmpl"
MAINT_TMPL = common.REHEARSAL_ROOT / "nginx" / "entry-maintenance.conf.tmpl"
ACTIVE_BACKENDS = {"java": "java:8080", "rust": "rust:8080"}
DIRECT_PORT = {"java": 18182, "rust": 18181}
CONTAINER = {"java": common.JAVA_CONTAINER, "rust": common.RUST_CONTAINER}
GENERATIONS_FILE = "generations.json"
COOKIE_VAULT_FILE = "session-cookies.json"
MAX_PROBE_BYTES = 8 * 1024 * 1024
REHEARSAL_WEB_ORIGIN = "http://localhost:5198"


class SwitchError(RuntimeError):
    """切换失败；携带结构化 facts（steps/refrozen 等）供失败报告收录。"""

    def __init__(self, message: str, *, facts: dict | None = None):
        super().__init__(message)
        self.facts: dict = facts or {}


# --------------------------------------------------------------------------
# Nginx 渲染 / reload / 探针
# --------------------------------------------------------------------------


def _write_conf(work_dir: Path, template: Path, backend: str | None) -> Path:
    text = template.read_text(encoding="utf-8")
    if backend is not None:
        text = text.replace("__ACTIVE_BACKEND__", ACTIVE_BACKENDS[backend])
    conf_dir = work_dir / "nginx" / "conf.d"
    conf_dir.mkdir(parents=True, exist_ok=True)
    (conf_dir / "entry.conf").write_text(text, encoding="utf-8")
    return conf_dir / "entry.conf"


def render_entry(work_dir: Path, backend: str) -> Path:
    return _write_conf(work_dir, ENTRY_TMPL, backend)


def render_maintenance(work_dir: Path) -> Path:
    return _write_conf(work_dir, MAINT_TMPL, None)


def nginx_test_reload() -> None:
    test = common.docker_exec(common.NGINX_CONTAINER, ["nginx", "-t"], check=False, timeout=30)
    if test.returncode != 0:
        raise SwitchError("nginx -t 失败：" + _decode(test.stderr)[:400])
    reload_result = common.docker_exec(
        common.NGINX_CONTAINER, ["nginx", "-s", "reload"], check=False, timeout=30
    )
    if reload_result.returncode != 0:
        raise SwitchError("nginx reload 失败：" + _decode(reload_result.stderr)[:400])


def _decode(raw: bytes | None) -> str:
    return (raw or b"").decode("utf-8", errors="replace")


def _http_bounded(
    url: str, *, cookie: str | None = None, timeout: float = 5.0, cap: int = MAX_PROBE_BYTES
) -> tuple[int, str, bool]:
    """返回 (status, body, overflow)。读取至多 cap+1 字节；超限标记 overflow，不截断当全量。"""
    headers = {"Cookie": cookie} if cookie else {}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read(cap + 1)
            return resp.status, _decode(data), len(data) > cap
    except urllib.error.HTTPError as exc:
        data = exc.read(cap + 1)
        return exc.code, _decode(data), len(data) > cap
    except (urllib.error.URLError, RemoteDisconnected, ConnectionError, TimeoutError, OSError) as exc:
        return 0, f"url-error:{type(exc).__name__}", False


def freeze_entry(work_dir: Path, *, timeout: float = 30.0) -> None:
    render_maintenance(work_dir)
    nginx_test_reload()
    entry = common.read_env_file(work_dir / ".env").get("ENTRY_URL", "http://127.0.0.1:18180")
    deadline = time.monotonic() + timeout
    last = "no-response"
    while time.monotonic() < deadline:
        status, _, _ = _http_bounded(entry.rstrip("/") + "/api/me")
        last = str(status)
        if status == 503:
            return
        time.sleep(0.5)
    raise SwitchError(f"入口未进入维护态（最近 /api/me 状态 {last}）")


def activate_entry(work_dir: Path, backend: str, *, timeout: float = 30.0) -> None:
    render_entry(work_dir, backend)
    nginx_test_reload()
    entry = common.read_env_file(work_dir / ".env").get("ENTRY_URL", "http://127.0.0.1:18180")
    deadline = time.monotonic() + timeout
    last = "no-response"
    while time.monotonic() < deadline:
        status, _, _ = _http_bounded(entry.rstrip("/") + "/api/me")
        last = str(status)
        if status in (200, 401, 403):
            return
        time.sleep(0.5)
    raise SwitchError(f"入口激活后未恢复（最近 /api/me 状态 {last}）")


def probe_entry(entry: str) -> dict[str, object]:
    base = entry.rstrip("/")
    health_status, _, health_overflow = _http_bounded(base + "/health/rehearsal")
    if health_overflow or health_status != 200:
        raise SwitchError(f"入口健康探针异常（{health_status} overflow={health_overflow}）")
    me_status, _, me_overflow = _http_bounded(base + "/api/me")
    if me_overflow or me_status != 401:
        raise SwitchError(f"匿名 /api/me 期望 401，实际 {me_status} overflow={me_overflow}")
    nearby_status, body, overflow = _http_bounded(
        base + "/api/markers/nearby?lat=31.23&lng=121.47&radius=1000"
    )
    if overflow:
        raise SwitchError(f"nearby 响应超过 {MAX_PROBE_BYTES} 字节上限，拒绝当全量解析")
    if nearby_status != 200:
        raise SwitchError(f"nearby 期望 200，实际 {nearby_status}")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise SwitchError("nearby 响应不是合法 JSON") from exc
    if not isinstance(payload, list):
        raise SwitchError("nearby 响应不是 JSON 数组")
    for item in payload[:3]:
        if not isinstance(item, dict) or "id" not in item:
            raise SwitchError("nearby 元素缺少 id 字段")
    return {
        "healthStatus": health_status,
        "meStatus": me_status,
        "nearbyStatus": nearby_status,
        "nearbyCount": len(payload),
    }


def wait_direct_ready(backend: str, *, timeout: float = 240.0) -> dict[str, object]:
    url = f"http://127.0.0.1:{DIRECT_PORT[backend]}/api/me"
    deadline = time.monotonic() + timeout
    last = "no-response"
    while time.monotonic() < deadline:
        status, _, _ = _http_bounded(url)
        last = str(status)
        if status in (200, 401, 403):
            return {"directPort": DIRECT_PORT[backend], "meStatus": status}
        time.sleep(2)
    raise SwitchError(f"{backend} 直连在 {timeout:.0f}s 内未就绪（最近 {last}）")


# --------------------------------------------------------------------------
# 容器控制
# --------------------------------------------------------------------------


def backend_running(backend: str) -> bool:
    result = common.run(
        ["docker", "inspect", "--format", "{{.State.Running}}", CONTAINER[backend]],
        check=False, timeout=30,
    )
    return _decode(result.stdout).strip() == "true"


def stop_backend(work_dir: Path, backend: str) -> None:
    common.compose(["stop", backend], work_dir=work_dir, check=True)
    if backend_running(backend):
        raise SwitchError(f"{backend} 停止后仍在运行")


def start_backend(work_dir: Path, backend: str) -> None:
    common.compose(["--profile", "apps", "up", "-d", backend], work_dir=work_dir, check=True)


def verify_resolved_config(work_dir: Path) -> dict[str, object]:
    """校验最终运行目标：用 compose config 原文提取 DB URL 与端口绑定（不打印 secret）。"""
    result = common.compose(["--profile", "apps", "config"], work_dir=work_dir, check=True)
    text = _decode(result.stdout)
    file_env = common.read_env_file(work_dir / ".env")

    def extract(key: str) -> str:
        pattern = rf"{key}['\"]?\s*[:=]\s*['\"]?([^\s'\"}},]+)"
        match = re.search(pattern, text)
        return match.group(1) if match else ""

    facts: dict[str, object] = {}
    for svc, key, env_key in (
        ("java", "DB_URL", "JAVA_DB_URL"),
        ("rust", "DATABASE_URL", "RUST_DATABASE_URL"),
    ):
        value = extract(key)
        match = re.search(r"@(pg17|pg18):\d+/([A-Za-z0-9_]+)", value) or re.search(
            r"//(pg17|pg18):\d+/([A-Za-z0-9_]+)", value
        )
        if not match:
            raise SwitchError(f"{svc} 解析出的数据库目标不是专用 pg17/pg18 服务名")
        host, database = match.group(1), match.group(2)
        if database not in guard.ALLOWED_DATABASES:
            raise SwitchError(f"{svc} 数据库不是合成库")
        file_value = file_env.get(env_key, "")
        if f"{host}:5432/{database}" not in file_value:
            raise SwitchError(f"{svc} resolved 配置与 .env 目标不一致")
        facts[f"{svc}Db"] = {"service": host, "database": database}
    host_ips = re.findall(r"host_ip:\s*(\S+)", text)
    if not host_ips or any(ip.strip('"') != "127.0.0.1" for ip in host_ips):
        raise SwitchError(f"存在非 127.0.0.1 端口绑定：{host_ips}")
    facts["allPortsLoopback"] = True
    return facts


# --------------------------------------------------------------------------
# 分代状态（持久 runId + 单调序号 + 启动前原子登记）
# --------------------------------------------------------------------------


def _state_path(work_dir: Path) -> Path:
    return work_dir / GENERATIONS_FILE


def _load_state(work_dir: Path) -> dict:
    path = _state_path(work_dir)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SwitchError("generation 状态文件损坏，拒绝继续（防代次重置碰撞）") from exc
    if not isinstance(data, dict):
        raise SwitchError("generation 状态文件格式非法，拒绝继续")
    return data


def _atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _write_state(work_dir: Path, state: dict) -> None:
    _atomic_write_json(_state_path(work_dir), state)


def namespace_for(run_id: str, backend: str, generation: int) -> str:
    if backend == "java":
        return f"lycoris:session:rehearsal:{run_id}:java:g{generation}"
    return f"lycoris:rust:rehearsal:{run_id}:g{generation}"


def cookie_for(run_id: str, backend: str, generation: int) -> str:
    base = "LYCORIS_REHEARSAL" if backend == "rust" else "LYCORIS_REHEARSAL_JAVA"
    return f"{base}_{run_id.upper()}_G{generation}"


def validate_generation(work_dir: Path, backend: str, generation: int) -> dict[str, object]:
    if not isinstance(generation, int) or isinstance(generation, bool) or generation <= 0:
        raise SwitchError("generation 必须是正整数")
    state = _load_state(work_dir)
    run_id = state.get("runId")
    if not run_id:
        run_id = uuid.uuid4().hex[:12]
        state["runId"] = run_id
    entry = state.setdefault(backend, {"current": 0, "reserved": [], "history": []})
    current = int(entry.get("current", 0))
    reserved = [int(x) for x in entry.get("reserved", []) if str(x).isdigit()]
    highest = max([current, *reserved]) if reserved else current
    if generation <= highest:
        raise SwitchError(
            f"generation 必须大于已登记最高代次 {highest}（请求 {generation}），拒绝复用失败代次"
        )
    if generation - highest > 1000:
        raise SwitchError("generation 跳变过大，拒绝")
    # 启动前原子登记为已用（失败也不可复用）。
    entry.setdefault("reserved", []).append(generation)
    _write_state(work_dir, state)
    return {
        "runId": run_id,
        "backend": backend,
        "generation": generation,
        "previous": current,
        "namespace": namespace_for(run_id, backend, generation),
        "cookie": cookie_for(run_id, backend, generation),
    }


def commit_generation(work_dir: Path, backend: str, generation: int) -> None:
    state = _load_state(work_dir)
    entry = state.setdefault(backend, {"current": 0, "reserved": [], "history": []})
    entry["reserved"] = [x for x in entry.get("reserved", []) if int(x) != generation]
    entry["current"] = generation
    entry.setdefault("history", []).append(
        {
            "generation": generation,
            "runId": state.get("runId"),
            "namespace": namespace_for(str(state.get("runId")), backend, generation),
            "cookie": cookie_for(str(state.get("runId")), backend, generation),
            "committedAt": common.now_iso(),
        }
    )
    _write_state(work_dir, state)


def current_generation(work_dir: Path, backend: str) -> int:
    return int(_load_state(work_dir).get(backend, {}).get("current", 0))


def run_id(work_dir: Path) -> str | None:
    value = _load_state(work_dir).get("runId")
    return str(value) if value else None


def start_new_run(work_dir: Path) -> str:
    """新演练：持久 runId + 计数归零 + 清理依赖状态。

    因 namespace/cookie 含 runId，归零不会与任何既有 Redis 会话碰撞；
    仅在显式 reseed（受控新建基线）时调用。
    """
    run_id_new = uuid.uuid4().hex[:12]
    _write_state(
        work_dir,
        {
            "runId": run_id_new,
            "java": {"current": 0, "reserved": [], "history": []},
            "rust": {"current": 0, "reserved": [], "history": []},
        },
    )
    for name in ("artifacts/flow_state.json", "artifacts/bench-marker-set.json", COOKIE_VAULT_FILE):
        path = work_dir / name
        if path.is_file():
            path.unlink()
    return run_id_new


# --------------------------------------------------------------------------
# Cookie vault（本地合成，不打印/不提交）
# --------------------------------------------------------------------------


def _vault_path(work_dir: Path) -> Path:
    return work_dir / COOKIE_VAULT_FILE


def save_cookie(work_dir: Path, backend: str, generation: int, cookie: str) -> None:
    path = _vault_path(work_dir)
    data = load_cookies(work_dir)  # 已有文件损坏即失败，不覆盖
    data[f"{backend}:g{generation}"] = cookie
    _atomic_write_json(path, data)


def load_cookies(work_dir: Path) -> dict[str, str]:
    path = _vault_path(work_dir)
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SwitchError("cookie vault 损坏，拒绝继续（防止丢失最初 Java Cookie）") from exc
    if not isinstance(raw, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in raw.items()):
        raise SwitchError("cookie vault 结构非法，拒绝继续")
    return raw


# --------------------------------------------------------------------------
# 真实旧 Cookie 测试
# --------------------------------------------------------------------------


def capture_session_cookie(
    entry: str, *, username: str, password: str, cookie_name: str, timeout: float = 15.0
) -> str | None:
    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    body = json.dumps({"username": username, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        entry.rstrip("/") + "/api/login",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Origin": REHEARSAL_WEB_ORIGIN,
            "Referer": REHEARSAL_WEB_ORIGIN + "/",
        },
    )
    try:
        with opener.open(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
    except (urllib.error.HTTPError, urllib.error.URLError, RemoteDisconnected, ConnectionError, TimeoutError, OSError):
        return None
    for cookie in jar:
        if cookie.name == cookie_name:
            return f"{cookie.name}={cookie.value}"
    return None


def replay_cookie(entry: str, cookie: str) -> int:
    status, _, _ = _http_bounded(entry.rstrip("/") + "/api/me", cookie=cookie)
    return status


# --------------------------------------------------------------------------
# 可注入的切换编排
# --------------------------------------------------------------------------


@dataclass
class SwitchDeps:
    freeze: Callable[[], None]
    stop: Callable[[], None]
    start: Callable[[], None]
    wait_ready: Callable[[], None]
    activate: Callable[[], None]
    probe: Callable[[], None]
    replay_cookie: Callable[[str], int]


def run_switch(deps: SwitchDeps, *, cookies_to_verify: tuple[str, ...] = ()) -> dict[str, object]:
    facts: dict[str, object] = {"steps": []}
    try:
        deps.freeze()
        facts["steps"].append("freeze")
    except Exception as exc:  # noqa: BLE001 - 初次冻结失败：未验证（不能说维护态）
        facts["refrozen"] = "unverified"
        facts["initialFreezeFailed"] = True
        raise SwitchError(f"切换失败于 freeze: {exc}；refrozen=unverified", facts=facts) from exc
    try:
        deps.stop()
        facts["steps"].append("stop-writer")
        deps.start()
        facts["steps"].append("start-target")
        deps.wait_ready()
        facts["steps"].append("target-ready")
        deps.activate()
        facts["steps"].append("activate-entry")
        deps.probe()
        facts["steps"].append("probe")
        statuses: list[int] = []
        for cookie in cookies_to_verify:
            status = deps.replay_cookie(cookie)
            statuses.append(status)
            if status != 401:
                raise SwitchError(f"旧会话 Cookie 重放状态 {status} != 401（隔离未证明）")
        if statuses:
            facts["cookieReplayStatuses"] = statuses
            facts["allOldCookiesRejected"] = all(s == 401 for s in statuses)
            facts["steps"].append("old-cookie-replay")
    except Exception as exc:  # noqa: BLE001
        last = facts["steps"][-1] if facts["steps"] else "freeze"
        # 失败必须重新冻结并实测 503；freeze 失败则如实标记未冻结。
        try:
            deps.freeze()
            facts["refrozen"] = True
        except Exception as refreeze_exc:  # noqa: BLE001
            facts["refrozen"] = "unknown"
            facts["refreezeError"] = str(refreeze_exc)[:200]
        message = f"切换失败于 {last}: {exc}；refrozen={facts.get('refrozen')}"
        if isinstance(exc, SwitchError) and exc.facts:
            facts.update(exc.facts)
        raise SwitchError(message, facts=facts) from exc
    return facts
