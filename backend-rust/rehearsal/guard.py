#!/usr/bin/env python3
"""Lycoris 阶段 4 演练环境安全 guard（纯标准库）。

用途
    在任何 DDL、进程启动或 cleanup 之前，验证演练只连接本任务的回环端口与合成库。
    由 check-rehearsal.py / benchmark-http.py 复用，也可直接运行 `python guard.py` 做自检。

限制
    - 只接受 loopback 主机：精确 `127.0.0.1` / `::1` / `localhost`，或经 ipaddress
      解析后 `.is_loopback` 为真；**绝不**用字符串前缀 `127.` 授权。
    - 拒绝任何 query / fragment：SQLx 允许 `?host=`/`?hostaddr=`/`?dbname=` 覆盖 URL，
      因此任何查询参数一律拒绝，不做白名单放行。
    - PostgreSQL 只允许端口 55434（PG18）/ 55435（PG17）；Redis 只允许 56380。
      现有 18080/5197/55432/55433/56379 一律拒绝。
    - 数据库名只允许 `lycoris_rehearsal_src` / `lycoris_rehearsal_up` /
      `lycoris_rehearsal_back`；拒绝 lycoris_rust、lycoris、postgres、
      restore_review、contract_review 等父级/持有库。
    - 本模块不打开任何网络连接，只做字符串/地址校验。
"""

from __future__ import annotations

import ipaddress
import os
import re
import sys
from dataclasses import dataclass
from typing import Mapping

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

__all__ = [
    "GuardError",
    "Target",
    "CONTAINER_PREFIX",
    "ALLOWED_PG_PORTS",
    "ALLOWED_REDIS_PORTS",
    "ALLOWED_HTTP_PORTS",
    "ALLOWED_DATABASES",
    "FORBIDDEN_DATABASES",
    "parse_target",
    "assert_pg_target",
    "assert_redis_target",
    "assert_http_endpoint",
    "assert_container_name",
    "assert_synthetic_credential",
    "verify_environment",
]

# 本任务容器/卷/网络统一前缀。
CONTAINER_PREFIX = "lycoris-rust-rehearsal-"

# 只允许回环绑定的演练端口；现有服务端口不得出现在这里。
PG17_PORT = 55435
PG18_PORT = 55434
REDIS_PORT = 56380
ENTRY_PORT = 18180
RUST_PORT = 18181
JAVA_PORT = 18182

ALLOWED_PG_PORTS = frozenset({PG17_PORT, PG18_PORT})
ALLOWED_REDIS_PORTS = frozenset({REDIS_PORT})
ALLOWED_HTTP_PORTS = frozenset({ENTRY_PORT, RUST_PORT, JAVA_PORT})

ALLOWED_DATABASES = frozenset(
    {"lycoris_rehearsal_src", "lycoris_rehearsal_up", "lycoris_rehearsal_back"}
)
FORBIDDEN_DATABASES = frozenset(
    {
        "lycoris_rust",
        "lycoris",
        "postgres",
        "template0",
        "template1",
        "restore_review",
        "contract_review",
        "lycoris_restore_review",
    }
)

_PG_SCHEMES = frozenset({"postgres", "postgresql"})
_REDIS_SCHEMES = frozenset({"redis", "rediss"})
_HTTP_SCHEMES = frozenset({"http", "https"})
_DB_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class GuardError(RuntimeError):
    """安全校验失败。消息绝不回显连接串（密码）本身。"""


@dataclass(frozen=True)
class Target:
    """解析后的目标；密码永不保存。"""

    scheme: str
    host: str
    port: int
    database: str | None

    def label(self) -> str:
        db = f"/{self.database}" if self.database else ""
        return f"{self.scheme}://{self.host}:{self.port}{db}"


def _parse(raw: str, *, name: str) -> Target:
    if not raw or not raw.strip():
        raise GuardError(f"{name} 为空")
    value = raw.strip()
    if "?" in value or "#" in value:
        # SQLx 的 host/hostaddr/dbname 覆盖参数就在这里被拒绝。
        raise GuardError(
            f"{name} 含 query/fragment，拒绝 host/hostaddr/dbname 覆盖（不显示原值）"
        )
    if not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", value):
        raise GuardError(f"{name} 不是合法 URL（不显示原值）")
    scheme, rest = value.split("://", 1)
    scheme = scheme.lower()
    authority, slash, path = rest.partition("/")
    if "@" in authority:
        # user[:password]@host:port —— 仅保留 host 部分，密码被丢弃且永不记录。
        authority = authority.rsplit("@", 1)[1]
    host, port_text = _split_host_port(authority, name)
    database = path.strip()
    if database:
        if "%" in database or "\\" in database or "/" in database:
            raise GuardError(f"{name} 数据库路径含编码或非法字节（不显示原值）")
        if not _DB_NAME_RE.match(database):
            raise GuardError(f"{name} 数据库名非法（不显示原值）")
    if not port_text:
        raise GuardError(f"{name} 必须显式包含端口（不显示原值）")
    try:
        port = int(port_text)
    except ValueError as exc:
        raise GuardError(f"{name} 端口非法（不显示原值）") from exc
    if not (1 <= port <= 65535):
        raise GuardError(f"{name} 端口超出范围（不显示原值）")
    return Target(scheme=scheme, host=host, port=port, database=database or None)


def _split_host_port(authority: str, name: str) -> tuple[str, str]:
    if not authority:
        raise GuardError(f"{name} 缺少主机（不显示原值）")
    if authority.startswith("["):
        close = authority.find("]")
        if close < 0:
            raise GuardError(f"{name} IPv6 authority 非法（不显示原值）")
        host = authority[1:close]
        remainder = authority[close + 1 :]
        if remainder.startswith(":"):
            return host, remainder[1:]
        return host, ""
    if ":" in authority:
        host, _, port = authority.rpartition(":")
        return host, port
    return authority, ""


def _is_loopback(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def parse_target(raw: str, *, name: str) -> Target:
    """解析 URL；不做放行判断。"""
    return _parse(raw, name=name)


def assert_pg_target(raw: str, *, name: str = "DATABASE_URL") -> Target:
    target = _parse(raw, name=name)
    if target.scheme not in _PG_SCHEMES:
        raise GuardError(f"{name} 必须使用 postgres:// 或 postgresql://（不显示原值）")
    _assert_loopback(target, name=name)
    if target.port not in ALLOWED_PG_PORTS:
        raise GuardError(
            f"{name} 端口必须是 {sorted(ALLOWED_PG_PORTS)} 之一（不显示原值）"
        )
    if target.database is None:
        raise GuardError(f"{name} 必须显式指定数据库（不显示原值）")
    if target.database in FORBIDDEN_DATABASES or target.database not in ALLOWED_DATABASES:
        raise GuardError(
            f"{name} 数据库名不在合成演练白名单 {sorted(ALLOWED_DATABASES)}（不显示原值）"
        )
    return target


def assert_redis_target(raw: str, *, name: str = "REDIS_URL") -> Target:
    target = _parse(raw, name=name)
    if target.scheme not in _REDIS_SCHEMES:
        raise GuardError(f"{name} 必须使用 redis:// 或 rediss://（不显示原值）")
    _assert_loopback(target, name=name)
    if target.port not in ALLOWED_REDIS_PORTS:
        raise GuardError(
            f"{name} 端口必须是 {sorted(ALLOWED_REDIS_PORTS)} 之一（不显示原值）"
        )
    if target.database is not None:
        # Redis URL 路径是逻辑 DB 编号；本任务固定用 0，不接受非空路径。
        raise GuardError(f"{name} 不接受数据库路径（不显示原值）")
    return target


def assert_http_endpoint(raw: str, *, name: str = "ENTRY_URL") -> Target:
    target = _parse(raw, name=name)
    if target.scheme not in _HTTP_SCHEMES:
        raise GuardError(f"{name} 必须使用 http:// 或 https://（不显示原值）")
    _assert_loopback(target, name=name)
    if target.port not in ALLOWED_HTTP_PORTS:
        raise GuardError(
            f"{name} 端口必须是 {sorted(ALLOWED_HTTP_PORTS)} 之一（不显示原值）"
        )
    return target


def _assert_loopback(target: Target, *, name: str) -> None:
    if not _is_loopback(target.host):
        raise GuardError(
            f"{name} 主机必须是回环地址 127.0.0.1 / ::1 / localhost（不显示原值）"
        )


def assert_container_name(container: str) -> str:
    """外部 docker exec/cleanup 只允许本任务前缀的容器。"""
    if not container.startswith(CONTAINER_PREFIX):
        raise GuardError(
            f"拒绝操作非本任务容器（必须以 {CONTAINER_PREFIX} 开头，不显示原值）"
        )
    return container


_CRED_SAFE_RE = re.compile(r"^[A-Za-z0-9_.!@#%^*+\-]{1,128}$")


def assert_synthetic_credential(secret: str, *, name: str) -> str:
    """合成凭据必须是非空 ASCII 字符串；拒绝空值或明显占位符。"""
    if not secret or not _CRED_SAFE_RE.match(secret):
        raise GuardError(f"{name} 不是合法合成凭据（不显示原值）")
    if secret.lower() in {"change-me", "changeme", "password", "secret"}:
        raise GuardError(f"{name} 使用了占位符，拒绝（不显示原值）")
    return secret


def verify_environment(env: Mapping[str, str]) -> dict[str, Target]:
    """在 DDL/启动/cleanup 前统一校验；返回解析结果。"""
    result: dict[str, Target] = {}
    result["pg17"] = assert_pg_target(env.get("PG17_URL", ""), name="PG17_URL")
    result["pg18"] = assert_pg_target(env.get("PG18_URL", ""), name="PG18_URL")
    result["redis"] = assert_redis_target(env.get("REDIS_URL", ""), name="REDIS_URL")
    if result["pg17"].port != PG17_PORT:
        raise GuardError(f"PG17_URL 端口必须是 {PG17_PORT}（不显示原值）")
    if result["pg18"].port != PG18_PORT:
        raise GuardError(f"PG18_URL 端口必须是 {PG18_PORT}（不显示原值）")
    if env.get("ENTRY_URL"):
        result["entry"] = assert_http_endpoint(env["ENTRY_URL"], name="ENTRY_URL")
    return result


def _selftest() -> int:
    """无网络自检：只验证 guard 判定本身。"""
    good_pg17 = "postgres://lycoris_rehearsal:synth@127.0.0.1:55435/lycoris_rehearsal_src"
    good_pg18 = "postgres://lycoris_rehearsal:synth@localhost:55434/lycoris_rehearsal_up"
    good_redis = "redis://127.0.0.1:56380"
    checks: list[tuple[str, bool]] = []

    def expect_ok(label: str, fn) -> None:
        try:
            fn()
            checks.append((label, True))
        except GuardError:
            checks.append((label, False))

    def expect_fail(label: str, fn) -> None:
        try:
            fn()
            checks.append((label, False))
        except GuardError:
            checks.append((label, True))

    expect_ok("pg17 loopback", lambda: assert_pg_target(good_pg17))
    expect_ok("pg18 localhost", lambda: assert_pg_target(good_pg18))
    expect_ok("redis", lambda: assert_redis_target(good_redis))
    expect_fail(
        "reject 127. prefix",
        lambda: assert_pg_target("postgres://u:p@127.example.invalid:55435/lycoris_rehearsal_src"),
    )
    expect_fail(
        "reject existing pg port",
        lambda: assert_pg_target("postgres://u:p@127.0.0.1:55432/lycoris_rehearsal_src"),
    )
    expect_fail(
        "reject existing redis port",
        lambda: assert_redis_target("redis://127.0.0.1:56379"),
    )
    expect_fail(
        "reject host override query",
        lambda: assert_pg_target(
            "postgres://u:p@127.0.0.1:55435/lycoris_rehearsal_src?host=10.0.0.5"
        ),
    )
    expect_fail(
        "reject dbname override query",
        lambda: assert_pg_target(
            "postgres://u:p@127.0.0.1:55435/lycoris_rehearsal_src?dbname=lycoris"
        ),
    )
    expect_fail(
        "reject production database",
        lambda: assert_pg_target("postgres://u:p@127.0.0.1:55435/lycoris_rust"),
    )
    expect_fail(
        "reject restore review",
        lambda: assert_pg_target("postgres://u:p@127.0.0.1:55435/restore_review"),
    )
    expect_fail(
        "reject non-loopback",
        lambda: assert_pg_target("postgres://u:p@10.0.0.5:55435/lycoris_rehearsal_src"),
    )
    expect_fail(
        "reject foreign container",
        lambda: assert_container_name("lycoris-restore-review"),
    )
    expect_ok(
        "allow rehearsal container",
        lambda: assert_container_name("lycoris-rust-rehearsal-pg17"),
    )
    expect_fail(
        "reject placeholder secret",
        lambda: assert_synthetic_credential("change-me", name="PG_PASSWORD"),
    )
    expect_ok(
        "allow synthetic secret",
        lambda: assert_synthetic_credential("rehearsal-synth-01", name="PG_PASSWORD"),
    )

    failed = [label for label, ok in checks if not ok]
    for label, ok in checks:
        print(f"[{'ok' if ok else 'FAIL'}] {label}")
    print(f"[guard] {len(checks) - len(failed)}/{len(checks)} self-checks passed")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(_selftest())
