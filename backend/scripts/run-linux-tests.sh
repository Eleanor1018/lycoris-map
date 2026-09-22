#!/usr/bin/env bash
# Linux container runner for formatting, compilation, linting, and tests.
# Runs filesystem tests with real Linux path and symlink semantics.
# Only synthetic host.docker.internal:55432/:56379 services are forwarded to loopback;
# overrides fail before network access or DDL, and forwarders stop when this runner exits.
# Test/build concurrency is limited to 1 or 2 for the small shared test database.
# Exit zero means every check passed; failures are never skipped.

set -euo pipefail

# —— 测试安全边界（不可通过环境覆写绕过）——
# 只允许已授权的合成 fixture：host.docker.internal:55432 / :56379 转发到容器回环同端口，
# 且测试 URL 只能是回环上的该 fixture。任意其它 host/port/query/fragment、监听地址或
# 测试 URL 一律在**任何网络访问与 DDL 之前**失败。
PG_LISTEN="127.0.0.1:55432"
REDIS_LISTEN="127.0.0.1:56379"
PG_UPSTREAM="host.docker.internal:55432"
REDIS_UPSTREAM="host.docker.internal:56379"
FIXED_DATABASE_URL="postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust"
FIXED_REDIS_URL="redis://127.0.0.1:56379"

reject_if_overridden() {
    # $1 名称, $2 允许值, $3 实际值（未设置时为空）
    if [ -n "$3" ] && [ "$3" != "$2" ]; then
        echo "[runner] 拒绝 $1：只允许固定值 $2" >&2
        exit 3
    fi
}
reject_if_overridden TEST_PG_UPSTREAM "$PG_UPSTREAM" "${TEST_PG_UPSTREAM:-}"
reject_if_overridden TEST_REDIS_UPSTREAM "$REDIS_UPSTREAM" "${TEST_REDIS_UPSTREAM:-}"
reject_if_overridden TEST_PG_LISTEN "$PG_LISTEN" "${TEST_PG_LISTEN:-}"
reject_if_overridden TEST_REDIS_LISTEN "$REDIS_LISTEN" "${TEST_REDIS_LISTEN:-}"
reject_if_overridden TEST_DATABASE_URL "$FIXED_DATABASE_URL" "${TEST_DATABASE_URL:-}"
reject_if_overridden TEST_REDIS_URL "$FIXED_REDIS_URL" "${TEST_REDIS_URL:-}"

# 并发参数必须是 1 或 2：0、非法或超出都不允许（未设置默认 2）。不支持调高。
resolve_parallel() {
    if [ -z "$1" ]; then
        printf '2'
    elif [ "$1" = "1" ] || [ "$1" = "2" ]; then
        printf '%s' "$1"
    else
        printf 'invalid'
    fi
}
RUST_TEST_THREADS="$(resolve_parallel "${RUST_TEST_THREADS:-}")"
if [ "$RUST_TEST_THREADS" = "invalid" ]; then
    echo "[runner] RUST_TEST_THREADS 必须为 1 或 2（未设置默认 2）" >&2
    exit 3
fi
CARGO_BUILD_JOBS="$(resolve_parallel "${CARGO_BUILD_JOBS:-}")"
if [ "$CARGO_BUILD_JOBS" = "invalid" ]; then
    echo "[runner] CARGO_BUILD_JOBS 必须为 1 或 2（未设置默认 2）" >&2
    exit 3
fi

export TEST_DATABASE_URL="$FIXED_DATABASE_URL"
export TEST_REDIS_URL="$FIXED_REDIS_URL"
export DATABASE_URL="$FIXED_DATABASE_URL"
export REDIS_URL="$FIXED_REDIS_URL"
export SQLX_OFFLINE=true
export RUST_TEST_THREADS
export CARGO_BUILD_JOBS

# `--check-config`：只做上述边界校验并退出，不启动转发、不访问网络、不执行 DDL/构建。
# 供 scripts/test-runner-guards.sh 证明非法配置在任何网络/DDL 前失败。
if [ "${1:-}" = "--check-config" ]; then
    echo "[runner] 配置校验通过（固定合成 fixture；未进行网络访问/DDL）"
    exit 0
fi

pids=()
cleanup() {
    local pid
    for pid in "${pids[@]:-}"; do
        [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    done
}
trap cleanup EXIT

start_forward() {
    TCP_FORWARD_LISTEN="$1" TCP_FORWARD_UPSTREAM="$2" tcp-forward &
    pids+=("$!")
}

wait_port() {
    local endpoint="$1"
    local host="${endpoint%:*}"
    local port="${endpoint##*:}"
    local attempt
    for attempt in $(seq 1 100); do
        if (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; then
            exec 3>&- 3<&-
            return 0
        fi
        sleep 0.2
    done
    echo "[runner] 端口 ${endpoint} 在 20s 内未就绪" >&2
    return 1
}

echo "[runner] 转发合成 PostgreSQL: ${PG_LISTEN} -> ${PG_UPSTREAM}"
echo "[runner] 转发合成 Redis.....: ${REDIS_LISTEN} -> ${REDIS_UPSTREAM}"
start_forward "$PG_LISTEN" "$PG_UPSTREAM"
start_forward "$REDIS_LISTEN" "$REDIS_UPSTREAM"
wait_port "$PG_LISTEN"
wait_port "$REDIS_LISTEN"

echo "[runner] cargo fmt --all -- --check"
cargo fmt --all -- --check

echo "[runner] SQLX_OFFLINE=true cargo check --all-targets --locked"
cargo check --all-targets --locked

echo "[runner] cargo clippy --all-targets --locked -- -D warnings"
cargo clippy --all-targets --locked -- -D warnings

echo "[runner] cargo test --locked (RUST_TEST_THREADS=${RUST_TEST_THREADS})"
cargo test --locked

echo "[runner] 全部 Linux 检查通过"
