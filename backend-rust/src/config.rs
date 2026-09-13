//! 运行配置。
//!
//! 只从环境变量读取；缺失或非法时返回可读错误，**绝不回显完整连接串或密码**。
//! `DATABASE_URL` / `REDIS_URL` 无默认值，避免误连非测试环境；其余参数有安全默认。
//!
//! [`Config`] 不派生 `Debug`，防止连接串经调试输出泄漏。

use std::env;
use std::net::IpAddr;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

use axum::http::{HeaderValue, Uri};
use chrono_tz::Tz;

/// 默认 HTTP 监听端口，与 Java 的 18080 区分。
pub const DEFAULT_SERVER_PORT: u16 = 18081;

/// 默认点位可用性时区（与 Java `app.availability-zone` 一致）。
pub const DEFAULT_AVAILABILITY_ZONE: Tz = chrono_tz::Asia::Shanghai;

/// 默认查询缓存命名空间（Rust 独立，不复用 Java 的 `cache:marker:*`）。
pub const DEFAULT_MARKER_CACHE_NAMESPACE: &str = "lycoris:rust:marker";

/// 默认请求体总上限（8 MiB）；后续 multipart 上传将显式覆盖 Axum 默认的 2 MiB，
/// 图片自身的 5 MiB 校验在后续上传业务中实现。
pub const REQUEST_BODY_LIMIT_BYTES: usize = 8 * 1024 * 1024;

/// 运行配置。刻意不实现 `Debug`，避免连接串或密码出现在日志中。
#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub server_host: IpAddr,
    pub server_port: u16,
    pub upload_dir: PathBuf,
    pub cors_allowed_origins: Vec<HeaderValue>,
    pub db_max_connections: u32,
    pub db_acquire_timeout: Duration,
    pub db_max_lifetime: Duration,
    pub db_idle_timeout: Duration,
    pub request_timeout: Duration,
    pub availability_zone: Tz,
    pub marker_cache_enabled: bool,
    pub marker_cache_namespace: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("缺少必需的环境变量 {0}")]
    Missing(&'static str),
    #[error("环境变量 {0} 的值非法")]
    Invalid(&'static str),
}

impl Config {
    /// 测试或嵌入式使用的显式构造，不读取环境变量。
    pub fn new(database_url: impl Into<String>, redis_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
            redis_url: redis_url.into(),
            server_host: IpAddr::from([127, 0, 0, 1]),
            server_port: DEFAULT_SERVER_PORT,
            upload_dir: PathBuf::from("uploads"),
            cors_allowed_origins: Vec::new(),
            db_max_connections: 10,
            db_acquire_timeout: Duration::from_secs(30),
            db_max_lifetime: Duration::from_secs(1800),
            db_idle_timeout: Duration::from_secs(600),
            request_timeout: Duration::from_secs(30),
            availability_zone: DEFAULT_AVAILABILITY_ZONE,
            marker_cache_enabled: true,
            marker_cache_namespace: DEFAULT_MARKER_CACHE_NAMESPACE.to_string(),
        }
    }

    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url = required("DATABASE_URL")?;
        // 只校验格式；错误信息不携带连接串本身，避免泄露密码。
        sqlx::postgres::PgConnectOptions::from_str(&database_url)
            .map_err(|_| ConfigError::Invalid("DATABASE_URL"))?;

        let redis_url = required("REDIS_URL")?;
        fred::types::config::Config::from_url(&redis_url)
            .map_err(|_| ConfigError::Invalid("REDIS_URL"))?;

        let server_host = match optional("SERVER_HOST") {
            Some(value) => {
                IpAddr::from_str(value.trim()).map_err(|_| ConfigError::Invalid("SERVER_HOST"))?
            }
            None => IpAddr::from([127, 0, 0, 1]),
        };
        let server_port = parse_or("SERVER_PORT", DEFAULT_SERVER_PORT)?;
        let upload_dir = optional("UPLOAD_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("uploads"));
        let cors_allowed_origins =
            parse_origins(&optional("CORS_ALLOWED_ORIGINS").unwrap_or_default())?;
        let availability_zone = match optional("APP_AVAILABILITY_ZONE") {
            Some(value) => Tz::from_str(value.trim())
                .map_err(|_| ConfigError::Invalid("APP_AVAILABILITY_ZONE"))?,
            None => DEFAULT_AVAILABILITY_ZONE,
        };

        Ok(Self {
            database_url,
            redis_url,
            server_host,
            server_port,
            upload_dir,
            cors_allowed_origins,
            // SQLx 连接池 0 连接会导致 panic，必须为正值。
            db_max_connections: non_zero(
                "DB_MAX_CONNECTIONS",
                parse_or("DB_MAX_CONNECTIONS", 10)?,
            )?,
            db_acquire_timeout: seconds("DB_ACQUIRE_TIMEOUT_SECONDS", 30)?,
            db_max_lifetime: seconds("DB_MAX_LIFETIME_SECONDS", 1800)?,
            db_idle_timeout: seconds("DB_IDLE_TIMEOUT_SECONDS", 600)?,
            request_timeout: seconds("REQUEST_TIMEOUT_SECONDS", 30)?,
            availability_zone,
            marker_cache_enabled: parse_or("MARKER_CACHE_REDIS_ENABLED", true)?,
            marker_cache_namespace: optional("MARKER_CACHE_NAMESPACE")
                .unwrap_or_else(|| DEFAULT_MARKER_CACHE_NAMESPACE.to_string()),
        })
    }
}

fn required(key: &'static str) -> Result<String, ConfigError> {
    match env::var(key) {
        Ok(value) if !value.trim().is_empty() => Ok(value),
        _ => Err(ConfigError::Missing(key)),
    }
}

fn optional(key: &str) -> Option<String> {
    match env::var(key) {
        Ok(value) if !value.trim().is_empty() => Some(value),
        _ => None,
    }
}

fn parse_or<T>(key: &'static str, default: T) -> Result<T, ConfigError>
where
    T: FromStr,
{
    match optional(key) {
        Some(value) => value
            .trim()
            .parse::<T>()
            .map_err(|_| ConfigError::Invalid(key)),
        None => Ok(default),
    }
}

/// 数值必须为正值（拒绝 0）。
fn non_zero(key: &'static str, value: u32) -> Result<u32, ConfigError> {
    if value == 0 {
        Err(ConfigError::Invalid(key))
    } else {
        Ok(value)
    }
}

fn seconds(key: &'static str, default_secs: u64) -> Result<Duration, ConfigError> {
    let secs: u64 = parse_or(key, default_secs)?;
    if secs == 0 {
        return Err(ConfigError::Invalid(key));
    }
    Ok(Duration::from_secs(secs))
}

/// 解析逗号分隔的 CORS 凭据白名单。
///
/// 每项必须是 `http`/`https` 源，且不含路径、查询、片段或用户名密码；
/// 拒绝 `*` 与 `null`。空白名单表示不放行任何跨域来源（明确行为，不是默认放开）。
/// 校验通过后规范化为 `scheme://authority`，与浏览器发送的 `Origin` 对齐。
fn parse_origins(raw: &str) -> Result<Vec<HeaderValue>, ConfigError> {
    let key = "CORS_ALLOWED_ORIGINS";
    let mut origins = Vec::new();
    for part in raw.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if part == "*" || part.eq_ignore_ascii_case("null") {
            return Err(ConfigError::Invalid(key));
        }
        // `http::Uri` 不承载片段，`#` 会被并入 authority，需显式拒绝。
        if part.contains('#') {
            return Err(ConfigError::Invalid(key));
        }

        let uri: Uri = part.parse().map_err(|_| ConfigError::Invalid(key))?;
        let scheme = uri.scheme_str().ok_or(ConfigError::Invalid(key))?;
        if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
            return Err(ConfigError::Invalid(key));
        }
        let authority = uri.authority().ok_or(ConfigError::Invalid(key))?;
        // 拒绝 userinfo（用户名/密码）。
        if authority.as_str().contains('@') {
            return Err(ConfigError::Invalid(key));
        }
        // 仅允许根路径（可省略），不得包含路径、查询或片段。
        if let Some(path_and_query) = uri.path_and_query()
            && (path_and_query.path() != "/" || path_and_query.query().is_some())
        {
            return Err(ConfigError::Invalid(key));
        }

        let normalized = format!("{scheme}://{authority}");
        origins.push(HeaderValue::from_str(&normalized).map_err(|_| ConfigError::Invalid(key))?);
    }
    Ok(origins)
}

#[cfg(test)]
mod tests {
    use super::{ConfigError, non_zero, parse_origins};

    #[test]
    fn origins_accept_http_and_normalize() {
        let origins = parse_origins("https://app.example.com, http://localhost:3000/").unwrap();
        assert_eq!(origins.len(), 2);
        assert_eq!(origins[0].to_str().unwrap(), "https://app.example.com");
        assert_eq!(origins[1].to_str().unwrap(), "http://localhost:3000");
    }

    #[test]
    fn origins_reject_invalid_forms() {
        for bad in [
            "*",
            "null",
            "NULL",
            "ftp://app.example.com",
            "app.example.com",
            "https://app.example.com/path",
            "https://app.example.com/?q=1",
            "https://user:pass@app.example.com",
            "https://app.example.com#fragment",
        ] {
            assert!(parse_origins(bad).is_err(), "{bad} 应被拒绝");
        }
        assert!(parse_origins("").unwrap().is_empty());
        assert!(parse_origins("  ,  ").unwrap().is_empty());
    }

    #[test]
    fn zero_db_max_connections_rejected() {
        assert_eq!(non_zero("DB_MAX_CONNECTIONS", 1).unwrap(), 1);
        assert!(matches!(
            non_zero("DB_MAX_CONNECTIONS", 0),
            Err(ConfigError::Invalid("DB_MAX_CONNECTIONS"))
        ));
    }
}
