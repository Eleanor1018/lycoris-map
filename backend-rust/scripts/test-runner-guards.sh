#!/usr/bin/env bash
# Lycoris Rust 后端测试运行器的安全边界小测试（阶段 4）。
#
# 目标：证明 run-linux-tests.sh 的固定 fixture / 回环监听 / 并发参数边界在任何网络访问与
#       DDL 之前生效，且 tcp-forward 自身也强制回环与固定上游。
# 只调用 `--check-config` 与转发器的非法配置分支，不启动转发、不访问 PG/Redis、不建库。

set -u

RUNNER="/app/scripts/run-linux-tests.sh"
failures=0

pass() { echo "[guard] ok: $1"; }
fail() { echo "[guard] FAIL: $1" >&2; failures=$((failures + 1)); }

# 期望成功（退出码 0）。
expect_ok() {
    local label="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        pass "$label"
    else
        fail "$label（期望通过）"
    fi
}

# 期望失败（非 0），且必须在调用任何网络/DDL 之前失败。
expect_fail() {
    local label="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        fail "$label（期望被拒绝）"
    else
        pass "$label"
    fi
}

# 合法固定配置通过。
expect_ok "合法配置通过 --check-config" bash "$RUNNER" --check-config
expect_ok "显式 1 线程通过" env RUST_TEST_THREADS=1 CARGO_BUILD_JOBS=1 bash "$RUNNER" --check-config

# 上游/监听被覆写（其它 host/port/query）必须在任何网络/DDL 前失败。
expect_fail "拒绝上游 127.0.0.1:55433" env TEST_PG_UPSTREAM=127.0.0.1:55433 bash "$RUNNER" --check-config
expect_fail "拒绝上游带 query" env TEST_PG_UPSTREAM='host.docker.internal:55432?x=1' bash "$RUNNER" --check-config
expect_fail "拒绝 Redis 上游其它端口" env TEST_REDIS_UPSTREAM=host.docker.internal:56380 bash "$RUNNER" --check-config
expect_fail "拒绝非回环监听" env TEST_PG_LISTEN=0.0.0.0:55432 bash "$RUNNER" --check-config
expect_fail "拒绝测试库 URL 覆写" env TEST_DATABASE_URL='postgres://lycoris:lycoris_local_test@127.0.0.1:55432/other' bash "$RUNNER" --check-config

# 并发参数必须为 1 或 2；0/非法/超出不允许。
expect_fail "拒绝 RUST_TEST_THREADS=0" env RUST_TEST_THREADS=0 bash "$RUNNER" --check-config
expect_fail "拒绝 RUST_TEST_THREADS=3" env RUST_TEST_THREADS=3 bash "$RUNNER" --check-config
expect_fail "拒绝 RUST_TEST_THREADS=abc" env RUST_TEST_THREADS=abc bash "$RUNNER" --check-config
expect_fail "拒绝 CARGO_BUILD_JOBS=0" env CARGO_BUILD_JOBS=0 bash "$RUNNER" --check-config
expect_fail "拒绝 CARGO_BUILD_JOBS=9" env CARGO_BUILD_JOBS=9 bash "$RUNNER" --check-config

# 转发器自身的回环/上游边界（非法配置立即退出，不 bind）。
expect_fail "转发器拒绝非回环监听" \
    env TCP_FORWARD_LISTEN=0.0.0.0:55432 TCP_FORWARD_UPSTREAM=host.docker.internal:55432 tcp-forward
expect_fail "转发器拒绝非授权上游主机" \
    env TCP_FORWARD_LISTEN=127.0.0.1:55432 TCP_FORWARD_UPSTREAM=127.0.0.1:55432 tcp-forward
expect_fail "转发器拒绝非授权端口" \
    env TCP_FORWARD_LISTEN=127.0.0.1:55433 TCP_FORWARD_UPSTREAM=host.docker.internal:55433 tcp-forward

if [ "$failures" -ne 0 ]; then
    echo "[guard] $failures 项失败" >&2
    exit 1
fi
echo "[guard] 全部边界测试通过"
