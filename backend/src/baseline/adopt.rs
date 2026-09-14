//! 显式基线接管与只读预检。
//!
//! 接管使用 SQLx 自己的迁移锁（`pg_advisory_lock`，与 `--migrate` 同一把锁）串行化，并在
//! **单个事务**内按固定顺序对六张业务表加 `SHARE` 锁（阻断外部 DDL 与写入），再核对结构、
//! 校验历史并用 SQLx 的 `skip` 登记**真实**基线校验和。结构核对、历史建表与登记同事务提交或
//! 一起回滚；`skip` 源码只是单条 `INSERT`（不自行开事务/savepoint），因此直接参与本事务。
//!
//! 接管连接从池中 `detach` 为独占 `PgConnection`：任务被取消时连接随 future drop 关闭，
//! 会话级 advisory lock 立即释放，不会把锁或 session state 带回池；正常路径主动 `close`。
//!
//! 只读预检在单个 `REPEATABLE READ READ ONLY` 快照内核对结构、历史与计数，不创建历史表。

use std::time::Duration;

use sqlx::Connection as _;
use sqlx::PgPool;
use sqlx::migrate::{Migrate as _, MigrateError, Migrator};
use sqlx::postgres::{PgConnection, Postgres};
use sqlx::{AssertSqlSafe, Transaction};

use crate::baseline::expected::{BASELINE_VERSION, TABLE_LOCK_ORDER};
use crate::baseline::inspect::{self, BaselineMismatch, BaselineReport, HistoryReport};
use crate::migrate::{MIGRATOR, MigrationError};

/// 接管时等待迁移锁/业务表锁的默认上限；超时明确失败，绝不永久阻塞。
pub const DEFAULT_LOCK_TIMEOUT: Duration = Duration::from_secs(5);

/// 只读预检：单个 `REPEATABLE READ READ ONLY` 快照，结构/历史/计数一致，不创建历史表。
pub async fn check_baseline(pool: &PgPool) -> Result<BaselineReport, MigrationError> {
    let mut conn = pool.acquire().await?;
    let mut tx = conn.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;

    let result: Result<BaselineReport, sqlx::Error> = async {
        let diffs = inspect::inspect_schema(&mut tx).await?;
        let (counts, counts_available) = inspect::inspect_data(&mut tx).await?;
        let history = inspect::read_history(&mut tx, &MIGRATOR).await?;
        Ok(BaselineReport {
            schema_ok: diffs.is_empty(),
            diffs,
            history,
            counts,
            counts_available,
        })
    }
    .await;

    let _ = tx.rollback().await;
    result.map_err(MigrationError::from)
}

pub async fn adopt_baseline(pool: &PgPool) -> Result<BaselineReport, MigrationError> {
    adopt_baseline_with(pool, &MIGRATOR, BASELINE_VERSION, DEFAULT_LOCK_TIMEOUT).await
}

/// 参数化入口：测试可注入自定义 `Migrator` 与较短的锁等待上限。
pub async fn adopt_baseline_with(
    pool: &PgPool,
    migrator: &Migrator,
    baseline_version: i64,
    lock_timeout: Duration,
) -> Result<BaselineReport, MigrationError> {
    // 独占连接：取消/超时 drop 时物理连接关闭，会话级 advisory lock 随之释放。
    let mut conn: PgConnection = pool.acquire().await?.detach();
    let previous_lock_timeout = current_lock_timeout(&mut conn).await?;
    set_lock_timeout(&mut conn, &format!("{}ms", lock_timeout.as_millis())).await?;

    let result = run_adoption(&mut conn, migrator, baseline_version).await;

    // 恢复既有 session 值（不回写 0），随后主动关闭；不把 connection 交回池。
    let _ = set_lock_timeout(&mut conn, &previous_lock_timeout).await;
    if conn.close().await.is_err() {
        tracing::warn!("关闭接管连接失败");
    }
    result
}

async fn run_adoption(
    conn: &mut PgConnection,
    migrator: &Migrator,
    baseline_version: i64,
) -> Result<BaselineReport, MigrationError> {
    conn.lock().await.map_err(map_lock_error)?;
    let result = adopt_in_tx(conn, migrator, baseline_version).await;
    let unlock = conn.unlock().await;
    match result {
        Ok(report) => {
            unlock?;
            Ok(report)
        }
        Err(error) => {
            if unlock.is_err() {
                tracing::warn!("接管结束后释放迁移锁失败");
            }
            Err(error)
        }
    }
}

async fn adopt_in_tx(
    conn: &mut PgConnection,
    migrator: &Migrator,
    baseline_version: i64,
) -> Result<BaselineReport, MigrationError> {
    let mut tx = conn.begin().await?;
    match adopt_locked(&mut tx, migrator, baseline_version).await {
        Ok((report, registered)) => {
            tx.commit().await?;
            // 只有提交成功后才报告“已登记”，避免提交失败却先称完成。
            if registered {
                tracing::info!(
                    "已登记基线迁移 {baseline_version}（真实校验和，未执行任何基线 DDL）"
                );
            } else {
                tracing::info!("基线迁移 {baseline_version} 已登记且校验和一致，接管幂等确认");
            }
            Ok(report)
        }
        Err(error) => {
            let _ = tx.rollback().await;
            Err(error)
        }
    }
}

async fn adopt_locked(
    tx: &mut Transaction<'_, Postgres>,
    migrator: &Migrator,
    baseline_version: i64,
) -> Result<(BaselineReport, bool), MigrationError> {
    // 先确认六个对象都存在且是普通表；缺表/视图等直接给出可读结构错误，不建任何业务表。
    let relation_diffs = inspect::relation_shape_diffs(tx).await?;
    if !relation_diffs.is_empty() {
        return Err(MigrationError::BaselineMismatch(BaselineMismatch {
            diffs: relation_diffs,
        }));
    }

    lock_business_tables(tx).await?;

    let diffs = inspect::inspect_schema(tx).await?;
    if !diffs.is_empty() {
        return Err(MigrationError::BaselineMismatch(BaselineMismatch { diffs }));
    }
    let (counts, counts_available) = inspect::inspect_data(tx).await?;

    let table: &str = &migrator.table_name;
    tx.ensure_migrations_table(table).await?;
    if let Some(version) = tx.dirty_version(table).await? {
        return Err(MigrationError::Failed(version));
    }
    let applied = tx.list_applied_migrations(table).await?;
    let applied_pairs: Vec<(i64, Vec<u8>)> = applied
        .iter()
        .map(|m| (m.version, m.checksum.to_vec()))
        .collect();
    if let Err(issue) = inspect::validate_applied(&applied_pairs, migrator) {
        return Err(issue.to_migration_error());
    }

    let already_applied = applied.iter().any(|m| m.version == baseline_version);
    if !already_applied {
        let migration = migrator
            .iter()
            .find(|m| m.version == baseline_version)
            .ok_or(MigrationError::BaselineNotEmbedded(baseline_version))?;
        tx.skip(table, migration).await?;
    }

    let versions: Vec<i64> = tx
        .list_applied_migrations(table)
        .await?
        .iter()
        .map(|m| m.version)
        .collect();
    let report = BaselineReport {
        schema_ok: true,
        diffs: Vec::new(),
        history: HistoryReport::Consistent { applied: versions },
        counts,
        counts_available,
    };
    Ok((report, !already_applied))
}

async fn lock_business_tables(conn: &mut PgConnection) -> Result<(), MigrationError> {
    let list = TABLE_LOCK_ORDER
        .iter()
        .map(|table| format!("public.{table}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("LOCK TABLE {list} IN SHARE MODE");
    sqlx::query(AssertSqlSafe(sql))
        .execute(&mut *conn)
        .await
        .map_err(map_db_lock_error)?;
    Ok(())
}

async fn current_lock_timeout(conn: &mut PgConnection) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("SELECT current_setting('lock_timeout')")
        .fetch_one(&mut *conn)
        .await
}

async fn set_lock_timeout(conn: &mut PgConnection, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT set_config('lock_timeout', $1, false)")
        .bind(value)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

fn is_lock_not_available(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(db) if db.code().as_deref() == Some("55P03"))
}

fn map_db_lock_error(error: sqlx::Error) -> MigrationError {
    if is_lock_not_available(&error) {
        MigrationError::LockUnavailable
    } else {
        MigrationError::Database(error)
    }
}

fn map_lock_error(error: MigrateError) -> MigrationError {
    if let MigrateError::Execute(database_error) = &error
        && is_lock_not_available(database_error)
    {
        return MigrationError::LockUnavailable;
    }
    MigrationError::Execute(error)
}
