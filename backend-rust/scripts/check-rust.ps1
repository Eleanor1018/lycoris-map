#!/usr/bin/env pwsh
# Lycoris Rust 后端本地检查（阶段 1）。
#
# 用途：在脚本进程内临时设置合成测试服务地址，然后执行 fmt / clippy / test。
# 环境变量只对本次脚本及其子进程有效，不写入用户或系统环境，也不修改任何持久配置。
# 连接目标固定为回环地址上的 lycoris-rust 专用容器，绝不触碰 lycoris-restore-review。
#
# 用法：pwsh backend-rust/scripts/check-rust.ps1
#       也可用 -SkipTest 只做格式与静态检查。

[CmdletBinding()]
param(
    [switch]$SkipTest
)

$ErrorActionPreference = "Stop"

# 合成测试服务；如本机端口不同，可在调用前用同名环境变量覆盖后再运行本脚本。
if (-not $env:TEST_DATABASE_URL) {
    $env:TEST_DATABASE_URL = "postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust"
}
if (-not $env:TEST_REDIS_URL) {
    $env:TEST_REDIS_URL = "redis://127.0.0.1:56379"
}

# Config::from_env 需要这两个变量；--migrate 子进程测试也会读取。
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:REDIS_URL = $env:TEST_REDIS_URL

$crateRoot = Split-Path -Parent $PSScriptRoot
Push-Location $crateRoot
try {
    Write-Host "[check-rust] cargo fmt --all -- --check"
    cargo fmt --all -- --check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "[check-rust] cargo clippy --all-targets -- -D warnings"
    cargo clippy --all-targets -- -D warnings
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    if (-not $SkipTest) {
        Write-Host "[check-rust] cargo test"
        cargo test
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
}
finally {
    Pop-Location
}

Write-Host "[check-rust] 全部通过"
