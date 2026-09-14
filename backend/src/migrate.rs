//! 迁移基线与启动校验。
//!
//! `migrations/0001_baseline.sql` 从 `docs/rust-migration/schema-baseline.sql` 精确派生，
//! 只含 6 张表结构、约束与 PostGIS 扩展，无数据。
//!
//! 普通启动只调用 [`verify_applied`] 做只读校验，**不会自动执行 DDL**；对空库或需要
//! 升级的库，必须显式运行 `lycoris-backend --migrate`。已有 Java 库的接管走
//! [`crate::baseline::adopt_baseline`]（`--adopt-baseline`），不会把初始建表重复用于已有库。

use std::collections::HashMap;

use sqlx::Connection as _;
use sqlx::PgPool;
use sqlx::Row as _;
use sqlx::migrate::Migrator;
use sqlx::postgres::PgRow;

use crate::baseline::BaselineMismatch;
use crate::baseline::expected;

/// 编译期内嵌的迁移集合（源目录 `migrations/`）。
pub static MIGRATOR: Migrator = sqlx::migrate!();

#[derive(Debug, thiserror::Error)]
pub enum MigrationError {
    #[error("目标库尚未应用迁移（缺少 _sqlx_migrations 表），请先运行 `lycoris-backend --migrate`")]
    NotMigrated,
    #[error("目标库缺少迁移 {0}，请运行 `lycoris-backend --migrate`")]
    Missing(i64),
    #[error("目标库存在未知的已应用迁移 {0}，当前代码没有该版本")]
    UnknownApplied(i64),
    #[error("迁移 {0} 的校验和与当前代码不一致，禁止对已有库直接套用")]
    ChecksumMismatch(i64),
    #[error("迁移 {0} 未成功完成，目标库处于未完成状态")]
    Failed(i64),
    #[error(
        "检测到已有业务表但缺少基线迁移记录，请先运行 `lycoris-backend --adopt-baseline` 核对接管，禁止重复建表"
    )]
    ExistingSchemaNeedsAdoption,
    #[error("当前代码没有基线迁移 {0}")]
    BaselineNotEmbedded(i64),
    #[error("{0}")]
    BaselineMismatch(BaselineMismatch),
    #[error("接管等待 SQLx 迁移锁超时；可能有其他迁移或接管正在执行，请稍后重试")]
    LockUnavailable,
    #[error("_sqlx_migrations 历史表格式与 SQLx 期望不一致，拒绝接管")]
    HistoryTableMismatch,
    #[error("迁移执行失败")]
    Execute(#[from] sqlx::migrate::MigrateError),
    #[error("数据库错误")]
    Database(#[from] sqlx::Error),
}

/// 对空库执行迁移（`--migrate`）。SQLx 会自行维护 `_sqlx_migrations` 与事务。
///
/// 若目标库已存在基线业务表却还没有对应迁移记录，则拒绝直接建表并提示使用
/// `--adopt-baseline`；只有空库或已由 SQLx 管理的库才会执行迁移。
///
/// 迁移在**独占物理连接**上执行（与已验收的接管一致）：成功后主动关闭，SQLx 出错或任务被
/// 取消时连接随 future drop 关闭。SQLx 的迁移锁是会话级 advisory lock，若把连接还回池会
/// 在池里残留锁并阻塞后续迁移；独占后无论成功/失败/取消都不会泄漏。
pub async fn run(pool: &PgPool) -> Result<(), MigrationError> {
    if needs_adoption(pool).await? {
        return Err(MigrationError::ExistingSchemaNeedsAdoption);
    }
    let mut connection = pool.acquire().await?.detach();
    let result = MIGRATOR
        .run(&mut connection)
        .await
        .map_err(MigrationError::from);
    if connection.close().await.is_err() {
        tracing::warn!("关闭迁移连接失败");
    }
    result
}

/// 判断目标库是否“已有业务表但尚无已登记的基线迁移”。
async fn needs_adoption(pool: &PgPool) -> Result<bool, sqlx::Error> {
    let history: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations')::text")
            .fetch_one(pool)
            .await?;
    let baseline_applied = match history {
        Some(_) => {
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM _sqlx_migrations WHERE version = $1)")
                .bind(expected::BASELINE_VERSION)
                .fetch_one(pool)
                .await?
        }
        None => false,
    };
    if baseline_applied {
        return Ok(false);
    }
    let tables: Vec<String> = expected::BASELINE_TABLES
        .iter()
        .map(|name| name.to_string())
        .collect();
    let present: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM unnest($1::text[]) AS t(name) \
         WHERE to_regclass('public.' || t.name) IS NOT NULL",
    )
    .bind(&tables)
    .fetch_one(pool)
    .await?;
    Ok(present > 0)
}

/// 只读校验：确认所有内嵌迁移都已在目标库成功应用且校验和一致。
/// 不修改数据库结构；普通启动调用它。
///
/// 同时拒绝三类脏状态：应用过但代码中已不存在的未知版本、`success=false`
/// 的未完成记录、以及校验和不一致的被篡改记录。
pub async fn verify_applied(pool: &PgPool) -> Result<(), MigrationError> {
    let present: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations')::text")
            .fetch_one(pool)
            .await?;
    if present.is_none() {
        return Err(MigrationError::NotMigrated);
    }

    let rows: Vec<PgRow> = sqlx::query("SELECT version, checksum, success FROM _sqlx_migrations")
        .fetch_all(pool)
        .await?;

    let mut applied: HashMap<i64, (Vec<u8>, bool)> = HashMap::with_capacity(rows.len());
    for row in rows {
        let version: i64 = row.try_get("version")?;
        let checksum: Vec<u8> = row.try_get("checksum")?;
        let success: bool = row.try_get("success")?;
        applied.insert(version, (checksum, success));
    }

    // 先检查记录本身：任何未完成记录都必须报错（即使版本未知）。
    for (&version, (_, success)) in &applied {
        if !*success {
            return Err(MigrationError::Failed(version));
        }
    }
    // 再检查未知版本：数据库里存在但代码中没有。
    for &version in applied.keys() {
        if !MIGRATOR.version_exists(version) {
            return Err(MigrationError::UnknownApplied(version));
        }
    }
    // 最后检查内嵌迁移是否都已应用且校验和一致。
    for migration in MIGRATOR.iter() {
        match applied.get(&migration.version) {
            None => return Err(MigrationError::Missing(migration.version)),
            Some((checksum, _)) => {
                if checksum.as_slice() != migration.checksum.as_ref() {
                    return Err(MigrationError::ChecksumMismatch(migration.version));
                }
            }
        }
    }
    Ok(())
}
