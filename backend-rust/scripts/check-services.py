#!/usr/bin/env python3
"""校验 lycoris-rust 测试依赖服务（阶段 0.5）。

用途
    通过 docker compose / docker exec 启动并检查隔离测试依赖：
    PostgreSQL 18.6 + PostGIS 3.6.4、Redis 8.10.1，并验证连接可用。
    只使用 Python 标准库，全部命令以 argv 列表传给 subprocess，不经过 shell。

限制
    只操作容器 lycoris-rust-postgres 与 lycoris-rust-redis，绝不触碰
    lycoris-restore-review（温晓的私有恢复验收环境）。
    不执行 FLUSHALL，不删除容器。除创建后立即删除的临时数据库外不写入数据。

退出码
    0 表示全部检查通过；非零表示未通过或启动/等待超时（最多 60 秒）。
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

COMPOSE_FILE = Path(__file__).resolve().parent.parent / "compose.test.yml"
PROJECT_NAME = "lycoris-rust-test"
PG_CONTAINER = "lycoris-rust-postgres"
REDIS_CONTAINER = "lycoris-rust-redis"
PG_USER = "lycoris"
PG_DB = "lycoris_rust"
EXPECTED_PG = "18.6"
EXPECTED_PG_NUM = "180006"
EXPECTED_POSTGIS = "3.6.4"
EXPECTED_REDIS = "8.10.1"
WAIT_SECONDS = 60

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


class CheckError(Exception):
    """检查失败。"""


def run(argv: list[str], env: dict[str, str], timeout: int = 60) -> subprocess.CompletedProcess:
    """以 argv 列表执行命令，不经过 shell；失败时抛出 CheckError。"""
    try:
        result = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise CheckError(f"找不到可执行文件: {argv[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise CheckError(f"命令超时({timeout}s): {' '.join(argv)}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise CheckError(f"命令失败({result.returncode}): {' '.join(argv)}\n{detail}")
    return result


def inspect_state(container: str, env: dict[str, str]) -> tuple[str, str] | None:
    """返回 (State.Status, Health.Status)，容器不存在时返回 None。"""
    result = subprocess.run(
        [
            "docker",
            "inspect",
            "--format",
            "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
            container,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        print(f"[debug] 无法 inspect {container}: {detail}", file=sys.stderr)
        return None
    status, _, health = result.stdout.strip().partition("|")
    return status, health


def wait_healthy(container: str, env: dict[str, str], deadline: float) -> None:
    """等待容器 running 且 healthy（无 healthcheck 时视为可用）。"""
    last = "未找到容器"
    while time.monotonic() < deadline:
        state = inspect_state(container, env)
        if state is not None:
            status, health = state
            last = f"status={status}, health={health}"
            if status == "running" and health in ("healthy", "none"):
                print(f"[ok] {container} 已就绪 ({last})")
                return
        time.sleep(2)
    raise CheckError(f"{container} 在 {WAIT_SECONDS}s 内未就绪（{last}）")


def psql_scalar(sql: str, env: dict[str, str]) -> str:
    result = run(
        [
            "docker",
            "exec",
            PG_CONTAINER,
            "psql",
            "-U",
            PG_USER,
            "-d",
            PG_DB,
            "-v",
            "ON_ERROR_STOP=1",
            "-tA",
            "-c",
            sql,
        ],
        env,
    )
    return result.stdout.strip()


def exec_pg_sql(sql: str, env: dict[str, str]) -> None:
    run(
        [
            "docker",
            "exec",
            PG_CONTAINER,
            "psql",
            "-U",
            PG_USER,
            "-d",
            PG_DB,
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
            "-c",
            sql,
        ],
        env,
    )


def check_postgres(env: dict[str, str]) -> None:
    version = psql_scalar("SHOW server_version;", env)
    version_num = psql_scalar("SHOW server_version_num;", env)
    if version_num != EXPECTED_PG_NUM:
        raise CheckError(f"PostgreSQL 版本不符：期望 {EXPECTED_PG}（{EXPECTED_PG_NUM}），实际 {version!r}（{version_num}）")
    print(f"[ok] PostgreSQL {version}")

    if psql_scalar("SELECT 1;", env) != "1":
        raise CheckError("PostgreSQL 连接检查失败")
    print("[ok] PostgreSQL 连接可用")

    postgis = psql_scalar("SELECT extversion FROM pg_extension WHERE extname = 'postgis';", env)
    if postgis != EXPECTED_POSTGIS:
        raise CheckError(f"PostGIS 版本不符：期望 {EXPECTED_POSTGIS}，实际 {postgis!r}")
    print(f"[ok] PostGIS {postgis}")

    tmp_db = f"lycoris_rust_check_{os.getpid()}"
    try:
        exec_pg_sql(f'CREATE DATABASE "{tmp_db}";', env)
        print(f"[ok] 可创建临时数据库（{tmp_db}）")
    finally:
        try:
            exec_pg_sql(f'DROP DATABASE IF EXISTS "{tmp_db}";', env)
        except CheckError as exc:
            print(f"[warn] 临时数据库 {tmp_db} 清理失败：{exc}", file=sys.stderr)


def check_redis(env: dict[str, str]) -> None:
    pong = run(["docker", "exec", REDIS_CONTAINER, "redis-cli", "PING"], env).stdout.strip()
    if pong != "PONG":
        raise CheckError(f"Redis PING 失败：{pong!r}")
    print("[ok] Redis 连接可用 (PONG)")

    info = run(["docker", "exec", REDIS_CONTAINER, "redis-cli", "INFO", "server"], env).stdout
    version = ""
    for line in info.splitlines():
        if line.startswith("redis_version:"):
            version = line.split(":", 1)[1].strip()
            break
    if version != EXPECTED_REDIS:
        raise CheckError(f"Redis 版本不符：期望 {EXPECTED_REDIS}，实际 {version!r}")
    print(f"[ok] Redis {version}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="校验 lycoris-rust 测试依赖服务")
    parser.add_argument("--pg-image", help="覆盖 PG_TEST_IMAGE（经 digest 校验的镜像地址）")
    parser.add_argument("--redis-image", help="覆盖 REDIS_TEST_IMAGE（经 digest 校验的镜像地址）")
    parser.add_argument("--start", action="store_true", help="先启动专用 compose 再检查")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if not COMPOSE_FILE.is_file():
        print(f"[error] 找不到 compose 文件：{COMPOSE_FILE}", file=sys.stderr)
        return 1

    env = os.environ.copy()
    if args.pg_image:
        env["PG_TEST_IMAGE"] = args.pg_image
    if args.redis_image:
        env["REDIS_TEST_IMAGE"] = args.redis_image

    try:
        compose = [
            "docker",
            "compose",
            "-f",
            str(COMPOSE_FILE),
            "--project-name",
            PROJECT_NAME,
        ]
        if args.start:
            print("[info] 启动专用测试依赖 compose（不包含应用容器）…")
            run(compose + ["up", "-d"], env, timeout=600)

        deadline = time.monotonic() + WAIT_SECONDS
        wait_healthy(PG_CONTAINER, env, deadline)
        wait_healthy(REDIS_CONTAINER, env, deadline)

        check_postgres(env)
        check_redis(env)
    except CheckError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1

    print("[done] 所有检查通过")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
