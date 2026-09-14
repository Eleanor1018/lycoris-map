#!/usr/bin/env python3
"""在独占 target 缓存与回环合成服务下运行 cargo。

用法：
    python backend-rust/scripts/spatial_run.py <cargo 参数...> [--offline]

环境（全部指向本机回环合成服务，绝不使用 55433/私有备份/生产）：
    CARGO_TARGET_DIR  = 尊重外部已设置的值；未设置时用 <本工作树>/backend-rust/target-spatial
    DATABASE_URL      = lycoris_spatial_dev（阶段 5 独立合成开发库，供 sqlx prepare/migrate）
    TEST_DATABASE_URL = lycoris_rust（共享 admin，仅用于用例自建 UUID 临时子库，不迁移自身）
    TEST_REDIS_URL    = redis://127.0.0.1:56379（专用 Redis）
    RUST_TEST_THREADS = 2；CARGO_BUILD_JOBS = 2

`--offline` 时设置 SQLX_OFFLINE=true；否则清除，供 `cargo sqlx prepare` 在线读取 schema。
target 目录可由外部 `CARGO_TARGET_DIR` 覆盖，本脚本不硬编码机器绝对路径。
"""
import os
import subprocess
import sys
from pathlib import Path

CRATE = Path(__file__).resolve().parent.parent
DEFAULT_TARGET = CRATE / "target-spatial"
DEV_DB = "postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_spatial_dev"
ADMIN_DB = "postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust"
REDIS_URL = "redis://127.0.0.1:56379"


def main() -> int:
    args = list(sys.argv[1:])
    env = dict(os.environ)
    if not env.get("CARGO_TARGET_DIR", "").strip():
        env["CARGO_TARGET_DIR"] = str(DEFAULT_TARGET)
    env["DATABASE_URL"] = DEV_DB
    env["TEST_DATABASE_URL"] = ADMIN_DB
    env["TEST_REDIS_URL"] = REDIS_URL
    env["RUST_TEST_THREADS"] = "2"
    env["CARGO_BUILD_JOBS"] = "2"
    if "--offline" in args:
        args.remove("--offline")
        env["SQLX_OFFLINE"] = "true"
    else:
        env.pop("SQLX_OFFLINE", None)

    command = ["cargo", *args]
    print(f"[spatial_run] CARGO_TARGET_DIR={env['CARGO_TARGET_DIR']}")
    print(f"[spatial_run] DATABASE_URL=postgres://<redacted>@127.0.0.1:55432/lycoris_spatial_dev")
    print(f"[spatial_run] $ {' '.join(command)}")
    return subprocess.call(command, cwd=CRATE, env=env)


if __name__ == "__main__":
    raise SystemExit(main())
