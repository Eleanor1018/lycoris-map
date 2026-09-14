//! PostgreSQL 连接池构建：区分服务运行与维护命令的超时策略。
//!
//! HTTP 超时不会自动停止已经在 PG 上运行的语句，也不会限制锁等待。服务连接池
//! （[`connect_serve_pool`]）在每条新物理连接的 `after_connect` 内用**绑定参数** `set_config`
//! 设置 `statement_timeout` 与 `lock_timeout`，既避免已超时请求继续拖住 PG，也避免锁等待无限
//! 堆积。所有参数都是绑定值，没有字符串拼接，不存在 SQL 注入面。
//!
//! 维护命令（`--migrate`/`--check-baseline`/`--adopt-baseline`）使用
//! [`connect_maintenance_pool`]：**不**继承服务的 20 秒语句限制（长迁移/接管需要更长语句），
//! 但仍为迁移/接管锁设置独立的明确等待上限，避免永久阻塞。只有 `Serve` 使用服务超时。
//!
//! 只有真正的“暂时不可用”类数据库错误（语句被取消或锁等待超时）才由
//! [`is_timeout_sqlstate`] 识别并受控映射为 503；未知数据库错误仍按各接口原有 500。

use std::str::FromStr;
use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{PgConnection, PgPool};

use crate::config::Config;

/// 维护连接上 `lock_timeout` 的独立等待上限；与基线接管显式等待上限一致，绝不永久等待迁移锁。
const MAINTENANCE_LOCK_TIMEOUT_MS: u64 = 5_000;

/// SQLSTATE：语句被取消（如 `statement_timeout` 触发）。
pub const SQLSTATE_QUERY_CANCELED: &str = "57014";
/// SQLSTATE：锁不可用（如 `lock_timeout` 触发）。
pub const SQLSTATE_LOCK_NOT_AVAILABLE: &str = "55P03";

/// 是否为“暂时不可用”类数据库错误（语句取消 / 锁等待超时），应受控映射为 503。
///
/// 只做分类，不重试、不回滚、不改变任何既有提交/缓存语义；未知错误返回 `false`。
pub fn is_timeout_sqlstate(error: &sqlx::Error) -> bool {
    matches!(
        error,
        sqlx::Error::Database(database)
            if matches!(
                database.code().as_deref(),
                Some(SQLSTATE_QUERY_CANCELED) | Some(SQLSTATE_LOCK_NOT_AVAILABLE)
            )
    )
}

/// 服务连接池：保留池上限/获取/生命周期/空闲参数，并对每条新连接设置服务语句与锁超时。
pub async fn connect_serve_pool(config: &Config) -> Result<PgPool, sqlx::Error> {
    let options = PgConnectOptions::from_str(&config.database_url)?;
    let statement_timeout = milliseconds(config.db_statement_timeout);
    let lock_timeout = milliseconds(config.db_lock_timeout);
    base_pool_options(config)
        .after_connect(move |connection, _metadata| {
            let statement_timeout = statement_timeout.clone();
            let lock_timeout = lock_timeout.clone();
            Box::pin(async move {
                apply_connection_timeouts(connection, &statement_timeout, &lock_timeout).await
            })
        })
        .connect_with(options)
        .await
}

/// 维护连接池：不设置服务语句超时；仍为迁移/接管锁设置独立等待上限。
pub async fn connect_maintenance_pool(config: &Config) -> Result<PgPool, sqlx::Error> {
    let options = PgConnectOptions::from_str(&config.database_url)?;
    base_pool_options(config)
        .after_connect(|connection, _metadata| {
            Box::pin(async move {
                sqlx::query("SELECT set_config('lock_timeout', $1, false)")
                    .bind(format!("{MAINTENANCE_LOCK_TIMEOUT_MS}ms"))
                    .execute(&mut *connection)
                    .await?;
                Ok(())
            })
        })
        .connect_with(options)
        .await
}

fn base_pool_options(config: &Config) -> PgPoolOptions {
    PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .acquire_timeout(config.db_acquire_timeout)
        .max_lifetime(config.db_max_lifetime)
        .idle_timeout(config.db_idle_timeout)
}

/// 用绑定参数设置语句与锁超时（毫秒），不做任何字符串拼接。
async fn apply_connection_timeouts(
    connection: &mut PgConnection,
    statement_timeout: &str,
    lock_timeout: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "SELECT set_config('statement_timeout', $1, false), set_config('lock_timeout', $2, false)",
    )
    .bind(statement_timeout)
    .bind(lock_timeout)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

fn milliseconds(duration: Duration) -> String {
    format!("{}ms", duration.as_millis())
}

#[cfg(test)]
mod tests {
    use super::is_timeout_sqlstate;

    /// 只有 57014/55P03 这两类“暂时不可用”错误受控映射 503，其它错误保持各接口原有 500。
    #[test]
    fn only_timeout_sqlstates_are_classified() {
        assert!(!is_timeout_sqlstate(&sqlx::Error::RowNotFound));
        assert!(!is_timeout_sqlstate(&sqlx::Error::PoolTimedOut));
    }
}
