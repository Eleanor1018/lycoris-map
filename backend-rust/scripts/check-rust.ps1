#!/usr/bin/env pwsh
# Lycoris Rust backend local checks (phase 1: public marker reads).
#
# Sets synthetic test service URLs for this script process only, then:
#   1. migrates the synthetic development database used for compile-time SQLx metadata;
#   2. `cargo sqlx prepare --check` verifies `.sqlx` offline metadata matches that database;
#   3. builds with `SQLX_OFFLINE=true` for all targets to prove offline compilation works;
#   4. runs fmt / clippy / test (integration tests use their own UUID temp databases).
# No user or system environment is modified. Targets are loopback-only lycoris-rust
# containers; `lycoris-restore-review` is never touched.
#
# Prerequisite: SQLx CLI must be 0.9.0 (`cargo sqlx --version`).
# Usage: pwsh backend-rust/scripts/check-rust.ps1
#        Use -SkipTest to run migration, offline metadata and static checks only.

[CmdletBinding()]
param(
    [switch]$SkipTest
)

$ErrorActionPreference = "Stop"

# Synthetic test services. Override with the same environment variables before running.
if (-not $env:TEST_DATABASE_URL) {
    $env:TEST_DATABASE_URL = "postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust"
}
if (-not $env:TEST_REDIS_URL) {
    $env:TEST_REDIS_URL = "redis://127.0.0.1:56379"
}

# Compile-time SQLx metadata uses the synthetic development database. Runtime integration
# tests create their own UUID databases from the same loopback server.
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:REDIS_URL = $env:TEST_REDIS_URL

function Assert-SqlxCli {
    $version = (cargo sqlx --version) 2>&1
    if ($LASTEXITCODE -ne 0 -or $version -notmatch "0\.9\.0") {
        throw "SQLx CLI must be 0.9.0, found: $version. Ask Wen Xiao to install it; do not bypass with another version."
    }
}

$crateRoot = Split-Path -Parent $PSScriptRoot
Push-Location $crateRoot
try {
    Assert-SqlxCli

    Write-Host "[check-rust] prepare and migrate synthetic development database"
    # `database create` may exit non-zero when the database already exists; ignore that.
    cargo sqlx database create 2>&1 | Out-Null
    cargo sqlx migrate run
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "[check-rust] cargo sqlx prepare --check -- --all-targets"
    cargo sqlx prepare --check -- --all-targets
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "[check-rust] SQLX_OFFLINE=true cargo check --all-targets"
    $env:SQLX_OFFLINE = "true"
    cargo check --all-targets
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

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

Write-Host "[check-rust] all checks passed"
