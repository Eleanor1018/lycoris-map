//! 真实 PG / Redis 集成测试（阶段 1 基础工程）。
//!
//! 共享工具见 `tests/common/mod.rs`。每个用例创建并清理自己的 UUID 临时库；
//! 服务不可用时直接失败，不做静默跳过。

mod common;

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{
    BASELINE_TABLES, TempDatabase, UNREACHABLE_PG_URL, UNREACHABLE_REDIS_URL, connect_redis,
    test_redis_url, unreachable_redis,
};
use lycoris_backend::app::{AppState, build_router};
use lycoris_backend::config::Config;
use lycoris_backend::migrate::{self, MigrationError};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

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
    let mut config = Config::new(temp.url(), test_redis_url());
    let _upload = tempfile::TempDir::new().expect("创建临时上传目录失败");
    config.upload_dir = _upload.path().to_path_buf();
    let router =
        build_router(AppState::new(pool.clone(), redis, config).expect("构造 AppState 失败"));

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
    let mut config = Config::new(UNREACHABLE_PG_URL, test_redis_url());
    let _upload = tempfile::TempDir::new().expect("创建临时上传目录失败");
    config.upload_dir = _upload.path().to_path_buf();
    let router = build_router(AppState::new(bad_db, redis, config).expect("构造 AppState 失败"));

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
    let mut config = Config::new(temp.url(), UNREACHABLE_REDIS_URL);
    let _upload = tempfile::TempDir::new().expect("创建临时上传目录失败");
    config.upload_dir = _upload.path().to_path_buf();
    let router =
        build_router(AppState::new(pool.clone(), redis, config).expect("构造 AppState 失败"));

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
