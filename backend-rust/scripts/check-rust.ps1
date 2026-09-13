#!/usr/bin/env pwsh
# Lycoris Rust backend local checks (public marker reads + phase 2 auth/users/avatars).
#
# Validates targets BEFORE any DDL: TEST_DATABASE_URL / TEST_REDIS_URL must be loopback and
# the migration database must be `lycoris_rust` or a `lycoris_test_` synthetic database.
# Error messages never echo the connection string or password. Then:
#   1. migrates the synthetic development database used for compile-time SQLx metadata;
#   2. `cargo sqlx prepare --check` verifies `.sqlx` offline metadata matches that database;
#   3. builds with `SQLX_OFFLINE=true` for all targets to prove offline compilation works;
#   4. runs fmt / clippy / test (integration tests use their own UUID temp databases).
# No user or system environment is modified. Targets are loopback-only lycoris-rust
# containers; `lycoris-restore-review` and other held databases are never touched.
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

# Parses scheme/host/database out of a connection URL. Avoids [System.Uri], which treats
# unknown schemes such as `postgres` as opaque, and never echoes credentials.
#
# SQLx (`sqlx-postgres` options parser) lets query parameters `host`/`hostaddr`/`dbname`
# override the URL host and path database. To keep validation authoritative we reject any
# query or fragment, plus encoded/illegal database path bytes.
function Get-UrlParts {
    param([Parameter(Mandatory = $true)][string]$Url, [Parameter(Mandatory = $true)][string]$Name)
    if ($Url -notmatch '^(?<scheme>[A-Za-z][A-Za-z0-9+.-]*)://(?<rest>.+)$') {
        throw "$Name is not a valid URL (value not shown)"
    }
    $scheme = $Matches['scheme'].ToLowerInvariant()
    $rest = $Matches['rest']
    if ($rest.Contains('?') -or $rest.Contains('#')) {
        throw "$Name must not contain query or fragment parameters (value not shown)"
    }
    $slash = $rest.IndexOf('/')
    if ($slash -ge 0) {
        $authority = $rest.Substring(0, $slash)
        $path = $rest.Substring($slash + 1)
    } else {
        $authority = $rest
        $path = ""
    }
    $at = $authority.LastIndexOf('@')
    if ($at -ge 0) {
        $authority = $authority.Substring($at + 1)
    }
    if ($authority.StartsWith("[")) {
        $close = $authority.IndexOf(']')
        if ($close -lt 0) { throw "$Name has an invalid IPv6 authority (value not shown)" }
        $hostName = $authority.Substring(1, $close - 1)
    } else {
        $colon = $authority.IndexOf(':')
        if ($colon -ge 0) {
            $hostName = $authority.Substring(0, $colon)
        } else {
            $hostName = $authority
        }
    }
    if ($path.Contains('%') -or $path.Contains('\')) {
        throw "$Name has an encoded or illegal database path (value not shown)"
    }
    [PSCustomObject]@{ Scheme = $scheme; Host = $hostName; Database = $path }
}

function Assert-PgScheme {
    param([Parameter(Mandatory = $true)][string]$Url, [Parameter(Mandatory = $true)][string]$Name)
    $scheme = (Get-UrlParts -Url $Url -Name $Name).Scheme
    if ($scheme -ne "postgres" -and $scheme -ne "postgresql") {
        throw "$Name must use the postgres:// or postgresql:// scheme (value not shown)"
    }
}

function Assert-RedisScheme {
    param([Parameter(Mandatory = $true)][string]$Url, [Parameter(Mandatory = $true)][string]$Name)
    $scheme = (Get-UrlParts -Url $Url -Name $Name).Scheme
    if ($scheme -ne "redis" -and $scheme -ne "rediss") {
        throw "$Name must use the redis:// or rediss:// scheme (value not shown)"
    }
}

# DDL must never touch a non-loopback address. Validate BEFORE `database create` / `migrate`.
# Only exact 127.0.0.1 / ::1 / localhost (or a parsed address whose static IsLoopback is
# true) is accepted; never authorize hosts by string prefix such as `127.`.
function Assert-LoopbackTarget {
    param([Parameter(Mandatory = $true)][string]$Url, [Parameter(Mandatory = $true)][string]$Name)
    $hostName = (Get-UrlParts -Url $Url -Name $Name).Host
    $isLoopback = $false
    if ($hostName -ieq "localhost") {
        $isLoopback = $true
    } else {
        [System.Net.IPAddress]$parsed = $null
        if ([System.Net.IPAddress]::TryParse($hostName, [ref]$parsed)) {
            $isLoopback = [System.Net.IPAddress]::IsLoopback($parsed)
        }
    }
    if (-not $isLoopback) {
        throw "$Name must target a loopback address (127.0.0.1 / ::1 / localhost); refusing to run migrations off-loopback"
    }
}

# Migration target must be exactly `lycoris_rust` or a `lycoris_test_[A-Za-z0-9_]+` synthetic
# database. This rejects parent/held databases such as restore_review / contract_review
# (and any `%`/`/`/`\` encoded path) before any DDL.
function Assert-SyntheticDatabase {
    param([Parameter(Mandatory = $true)][string]$Url)
    $database = (Get-UrlParts -Url $Url -Name "TEST_DATABASE_URL").Database
    if ($database -eq "lycoris_rust") {
        return $database
    }
    if ($database -match '^lycoris_test_[A-Za-z0-9_]+$') {
        return $database
    }
    throw "Migration target database name is not allowed: only lycoris_rust or lycoris_test_<suffix> synthetic databases are permitted"
}

Assert-PgScheme -Url $env:TEST_DATABASE_URL -Name "TEST_DATABASE_URL"
Assert-RedisScheme -Url $env:TEST_REDIS_URL -Name "TEST_REDIS_URL"
Assert-LoopbackTarget -Url $env:TEST_DATABASE_URL -Name "TEST_DATABASE_URL"
Assert-LoopbackTarget -Url $env:TEST_REDIS_URL -Name "TEST_REDIS_URL"
$targetDatabase = Assert-SyntheticDatabase -Url $env:TEST_DATABASE_URL

# Compile-time SQLx metadata uses the synthetic development database. Runtime integration
# tests create their own UUID databases from the same loopback server.
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:REDIS_URL = $env:TEST_REDIS_URL

# Default the test concurrency to 4 so the 1 GB test PG does not OOM while creating
# databases in parallel; an explicitly set positive value is respected.
$testThreads = 0
$hasTestThreads = [int]::TryParse($env:RUST_TEST_THREADS, [ref]$testThreads)
if (-not $hasTestThreads -or $testThreads -le 0) {
    $env:RUST_TEST_THREADS = "4"
}
Write-Host "[check-rust] migration target database: $targetDatabase (loopback only)"
Write-Host "[check-rust] RUST_TEST_THREADS=$($env:RUST_TEST_THREADS); do not run the full gate from multiple worktrees at once (shared 1 GB test PG)"

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
