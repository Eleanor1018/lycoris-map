//! 真实 PG / Redis 集成测试（阶段 1）。
//!
//! 每个用例从测试管理员连接创建 UUID 命名的临时库，应用基线迁移，构造 Router，
//! 用 `tower::ServiceExt::oneshot` 直接调用（不启动外部 HTTP 服务器），退出时删除
//! 自己的临时库；即使断言失败，`TempDatabase` 的 `Drop` 也会清理并输出受控提示。
//!
//! 测试只允许连接回环地址上的合成测试服务；服务不可用时直接失败，不做静默跳过。
//! 故障用例通过指向未监听端口或未初始化的客户端来模拟，不停止共享服务。

use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use fred::interfaces::ClientLike;
use fred::types::config::ServerConfig;
use lycoris_backend::app::{AppState, build_router};
use lycoris_backend::config::Config;
use lycoris_backend::migrate::{self, MigrationError};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, PgPool};
use tower::ServiceExt;

const DEFAULT_TEST_DATABASE_URL: &str =
    "postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust";
const DEFAULT_TEST_REDIS_URL: &str = "redis://127.0.0.1:56379";
/// 指向未监听端口的坏依赖地址，用于就绪故障用例（不依赖任何真实服务）。
const UNREACHABLE_PG_URL: &str = "postgres://lycoris:lycoris_local_test@127.0.0.1:1/lycoris_rust";
const UNREACHABLE_REDIS_URL: &str = "redis://127.0.0.1:1";

const BASELINE_TABLES: [&str; 6] = [
    "map_markers",
    "map_marker_translations",
    "marker_edit_proposals",
    "marker_favorites",
    "marker_image_proposals",
    "users",
];

fn test_database_url() -> String {
    std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| DEFAULT_TEST_DATABASE_URL.to_string())
}

fn test_redis_url() -> String {
    std::env::var("TEST_REDIS_URL").unwrap_or_else(|_| DEFAULT_TEST_REDIS_URL.to_string())
}

/// 精确判断主机是否为回环地址（不匹配用户名/查询里出现的 "localhost" 等子串）。
fn host_is_loopback(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

fn assert_pg_loopback(options: &PgConnectOptions) {
    assert!(
        host_is_loopback(options.get_host()),
        "测试 PostgreSQL 必须位于回环地址"
    );
}

fn assert_redis_loopback(config: &fred::types::config::Config) {
    let host = match &config.server {
        ServerConfig::Centralized { server } => server.host.to_string(),
        ServerConfig::Clustered { hosts, .. } | ServerConfig::Sentinel { hosts, .. } => hosts
            .first()
            .map(|server| server.host.to_string())
            .unwrap_or_default(),
    };
    assert!(host_is_loopback(&host), "测试 Redis 必须位于回环地址");
}

/// 通过独立线程 + 新运行时清理，避免在 tokio 运行时线程内 `block_on`。
struct TempDatabase {
    admin_options: PgConnectOptions,
    name: String,
    url: String,
}

impl TempDatabase {
    async fn create() -> Self {
        let admin_url = test_database_url();
        let admin_options =
            PgConnectOptions::from_str(&admin_url).expect("TEST_DATABASE_URL 格式非法");
        assert_pg_loopback(&admin_options);
        let name = format!("lycoris_test_{}", uuid::Uuid::new_v4().simple());

        let admin = PgPoolOptions::new()
            .max_connections(1)
            .connect_with(admin_options.clone())
            .await
            .expect("无法连接测试 PostgreSQL，请先启动隔离测试服务");
        // 库名来自 UUID（仅十六进制），已审计无注入风险，故显式声明为安全 SQL。
        sqlx::query(sqlx::AssertSqlSafe(format!("CREATE DATABASE \"{name}\"")))
            .execute(&admin)
            .await
            .expect("创建临时测试库失败");
        admin.close().await;

        let url = self::temp_url(&admin_options, &name);
        Self {
            admin_options,
            name,
            url,
        }
    }

    fn url(&self) -> &str {
        &self.url
    }

    fn options(&self) -> PgConnectOptions {
        self.admin_options.clone().database(&self.name)
    }

    async fn connect_pool(&self) -> PgPool {
        PgPoolOptions::new()
            .max_connections(5)
            .connect_with(self.options())
            .await
            .expect("连接临时测试库失败")
    }
}

/// 用 PgConnectOptions 构造临时库连接串（不做手写字符串切分）。
fn temp_url(admin_options: &PgConnectOptions, database: &str) -> String {
    admin_options
        .clone()
        .database(database)
        .to_url_lossy()
        .to_string()
}

impl Drop for TempDatabase {
    fn drop(&mut self) {
        let admin_options = self.admin_options.clone();
        let name = self.name.clone();
        let _ = std::thread::spawn(move || {
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                eprintln!("[warn] 清理临时测试库 {name} 失败: 无法创建运行时");
                return;
            };
            runtime.block_on(async move {
                match PgPoolOptions::new()
                    .max_connections(1)
                    .connect_with(admin_options)
                    .await
                {
                    Ok(admin) => {
                        // 库名来自 UUID，已审计无注入风险。
                        let sql = format!("DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE)");
                        if let Err(error) =
                            sqlx::query(sqlx::AssertSqlSafe(sql)).execute(&admin).await
                        {
                            eprintln!("[warn] 清理临时测试库 {name} 失败: {error}");
                        }
                        admin.close().await;
                    }
                    Err(error) => {
                        eprintln!("[warn] 清理临时测试库 {name} 失败: {error}");
                    }
                }
            });
        })
        .join();
    }
}

async fn connect_redis() -> fred::clients::Client {
    let url = test_redis_url();
    let config = fred::types::config::Config::from_url(&url).expect("测试 Redis URL 格式非法");
    assert_redis_loopback(&config);
    let client = fred::types::Builder::from_config(config)
        .build()
        .expect("构建测试 Redis 客户端失败");
    client
        .init()
        .await
        .expect("无法连接测试 Redis，请先启动隔离测试服务");
    client
}

/// 指向未监听端口且未初始化的客户端；`PING` 会失败或超时，用于就绪故障用例。
fn unreachable_redis() -> fred::clients::Client {
    let config =
        fred::types::config::Config::from_url(UNREACHABLE_REDIS_URL).expect("测试 URL 格式非法");
    fred::types::Builder::from_config(config)
        .build()
        .expect("构建测试 Redis 客户端失败")
}

#[tokio::test]
async fn migrates_baseline_and_passes_health_checks() {
    let temp = TempDatabase::create().await;
    let pool = temp.connect_pool().await;

    migrate::run(&pool).await.expect("执行基线迁移失败");
    migrate::verify_applied(&pool)
        .await
        .expect("已迁移库的校验应通过");

    for table in BASELINE_TABLES {
        let exists: Option<String> = sqlx::query_scalar("SELECT to_regclass($1)::text")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("查询表是否存在失败");
        assert!(exists.is_some(), "迁移后缺少表 {table}，基线未正确应用");
    }

    let applied: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .expect("查询迁移记录失败");
    assert_eq!(applied, 1, "基线应只包含一条迁移");

    let redis = connect_redis().await;
    let config = Config::new(temp.url(), test_redis_url());
    let router = build_router(AppState::new(pool.clone(), redis, config));

    let live = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health/live")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("调用 /health/live 失败");
    assert_eq!(live.status(), StatusCode::OK);

    let ready = router
        .oneshot(
            Request::builder()
                .uri("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("调用 /health/ready 失败");
    assert_eq!(
        ready.status(),
        StatusCode::OK,
        "/health/ready 应在 PG 与 Redis 可用时返回 200"
    );

    pool.close().await;
}

#[tokio::test]
async fn ready_reports_503_when_database_unavailable() {
    // 懒加载连接池指向未监听端口，acquire 很快超时；不停止任何共享服务。
    let bad_db = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_millis(200))
        .connect_lazy(UNREACHABLE_PG_URL)
        .expect("构造坏 PG 连接池失败");

    let redis = connect_redis().await;
    let config = Config::new(UNREACHABLE_PG_URL, test_redis_url());
    let router = build_router(AppState::new(bad_db, redis, config));

    let response = router
        .oneshot(
            Request::builder()
                .uri("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("调用 /health/ready 失败");
    assert_eq!(
        response.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "PG 不可用时 /health/ready 必须返回 503"
    );
}

#[tokio::test]
async fn ready_reports_503_when_redis_unavailable() {
    let temp = TempDatabase::create().await;
    let pool = temp.connect_pool().await;
    migrate::run(&pool).await.expect("执行基线迁移失败");

    let redis = unreachable_redis();
    let config = Config::new(temp.url(), UNREACHABLE_REDIS_URL);
    let router = build_router(AppState::new(pool.clone(), redis, config));

    let response = router
        .oneshot(
            Request::builder()
                .uri("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("调用 /health/ready 失败");
    assert_eq!(
        response.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "Redis 不可用时 /health/ready 必须返回 503"
    );

    pool.close().await;
}

#[tokio::test]
async fn verify_rejects_unmigrated_database_without_ddl() {
    let temp = TempDatabase::create().await;
    let pool = temp.connect_pool().await;

    let error = migrate::verify_applied(&pool)
        .await
        .expect_err("未迁移的空库必须被拒绝");
    assert!(
        matches!(error, MigrationError::NotMigrated),
        "期望 NotMigrated，实际为 {error}"
    );

    // 只读校验不得创建任何表（尤其是 _sqlx_migrations）。
    let present: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations')::text")
            .fetch_one(&pool)
            .await
            .expect("查询迁移表失败");
    assert!(present.is_none(), "只读校验不得创建 _sqlx_migrations 表");

    pool.close().await;
}

#[tokio::test]
async fn verify_rejects_dropped_migration_record() {
    let temp = TempDatabase::create().await;
    let pool = temp.connect_pool().await;

    migrate::run(&pool).await.expect("执行基线迁移失败");
    sqlx::query("DELETE FROM _sqlx_migrations")
        .execute(&pool)
        .await
        .expect("删除迁移记录失败");

    let error = migrate::verify_applied(&pool)
        .await
        .expect_err("迁移记录缺失必须被拒绝");
    assert!(
        matches!(error, MigrationError::Missing(1)),
        "期望 Missing(1)，实际为 {error}"
    );

    pool.close().await;
}

#[tokio::test]
async fn verify_rejects_checksum_mismatch() {
    let temp = TempDatabase::create().await;
    let pool = temp.connect_pool().await;

    migrate::run(&pool).await.expect("执行基线迁移失败");
    sqlx::query(
        "UPDATE _sqlx_migrations SET checksum = decode('deadbeef', 'hex') WHERE version = 1",
    )
    .execute(&pool)
    .await
    .expect("篡改校验和失败");

    let error = migrate::verify_applied(&pool)
        .await
        .expect_err("校验和不一致必须被拒绝");
    assert!(
        matches!(error, MigrationError::ChecksumMismatch(1)),
        "期望 ChecksumMismatch(1)，实际为 {error}"
    );

    pool.close().await;
}

#[tokio::test]
async fn verify_rejects_failed_migration_record() {
    let temp = TempDatabase::create().await;
    let pool = temp.connect_pool().await;

    migrate::run(&pool).await.expect("执行基线迁移失败");
    sqlx::query("UPDATE _sqlx_migrations SET success = false WHERE version = 1")
        .execute(&pool)
        .await
        .expect("标记迁移失败状态失败");

    let error = migrate::verify_applied(&pool)
        .await
        .expect_err("未完成的迁移记录必须被拒绝");
    assert!(
        matches!(error, MigrationError::Failed(1)),
        "期望 Failed(1)，实际为 {error}"
    );

    pool.close().await;
}

#[tokio::test]
async fn verify_rejects_unknown_applied_migration() {
    let temp = TempDatabase::create().await;
    let pool = temp.connect_pool().await;

    migrate::run(&pool).await.expect("执行基线迁移失败");
    sqlx::query(
        "INSERT INTO _sqlx_migrations \
         (version, description, installed_on, success, checksum, execution_time) \
         VALUES (999, 'unknown', now(), true, decode('00', 'hex'), 0)",
    )
    .execute(&pool)
    .await
    .expect("写入未知迁移记录失败");

    let error = migrate::verify_applied(&pool)
        .await
        .expect_err("未知的已应用迁移必须被拒绝");
    assert!(
        matches!(error, MigrationError::UnknownApplied(999)),
        "期望 UnknownApplied(999)，实际为 {error}"
    );

    pool.close().await;
}

#[tokio::test]
async fn migrate_cli_applies_baseline_to_empty_database() {
    let temp = TempDatabase::create().await;

    // 直接执行编译出的 bin，覆盖 main() 的 --migrate 参数装配。
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_lycoris-backend"))
        .arg("--migrate")
        .env("DATABASE_URL", temp.url())
        .env("REDIS_URL", test_redis_url())
        .output()
        .expect("启动 lycoris-backend --migrate 失败");
    assert!(
        output.status.success(),
        "迁移 CLI 退出码非零: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let pool = temp.connect_pool().await;
    migrate::verify_applied(&pool)
        .await
        .expect("迁移 CLI 执行后校验应通过");
    pool.close().await;
}
