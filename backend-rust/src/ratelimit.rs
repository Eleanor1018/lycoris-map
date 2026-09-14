//! 注册限流：Redis 原子计数。
//!
//! 与 Java 一致，默认按客户端 IP 计数，默认 5 次 / 600 秒。计数用 Lua
//! `INCR` + 首次 `PEXPIRE` 原子完成；Redis 故障时返回 [`RateLimitOutcome::Unavailable`]，
//! 绝不回退到内存无上限放行。

use std::net::IpAddr;
use std::time::Duration;

use fred::clients::Client;
use fred::prelude::*;

/// ARGV: [window_ms]；返回自增后的计数。
const INCR_SCRIPT: &str = r#"
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateLimitOutcome {
    Allowed,
    Limited,
    Unavailable,
}

#[derive(Clone)]
pub struct RegisterRateLimiter {
    redis: Client,
    namespace: String,
    max_attempts: i64,
    window_ms: i64,
    command_timeout: Duration,
}

impl RegisterRateLimiter {
    pub fn new(
        redis: Client,
        namespace: impl Into<String>,
        max_attempts: u32,
        window: Duration,
        command_timeout: Duration,
    ) -> Self {
        Self {
            redis,
            namespace: namespace.into(),
            max_attempts: i64::from(max_attempts.max(1)),
            window_ms: i64::try_from(window.as_millis().max(1)).unwrap_or(i64::MAX),
            command_timeout,
        }
    }

    pub async fn try_acquire(&self, ip: IpAddr) -> RateLimitOutcome {
        let key = format!("{}:{}", self.namespace, ip);
        // 依赖卡住时按不可用处理，绝不无上限放行。
        let count = tokio::time::timeout(
            self.command_timeout,
            self.redis.eval::<i64, _, _, _>(
                INCR_SCRIPT,
                vec![key],
                vec![self.window_ms.to_string()],
            ),
        )
        .await;
        match count {
            Ok(Ok(count)) if count <= self.max_attempts => RateLimitOutcome::Allowed,
            Ok(Ok(_)) => RateLimitOutcome::Limited,
            Ok(Err(_)) | Err(_) => RateLimitOutcome::Unavailable,
        }
    }
}

/// 解析用于限流的客户端 IP。
///
/// 默认使用实际连接 IP；仅当连接来自显式配置的可信代理时才读取
/// `X-Forwarded-For` 第一段，避免调用方自选限流身份。坏 IP 回退连接 IP。
pub fn resolve_client_ip(
    connect_ip: Option<IpAddr>,
    headers: &axum::http::HeaderMap,
    trusted_proxies: &[IpAddr],
) -> IpAddr {
    let fallback = connect_ip.unwrap_or(IpAddr::from([0, 0, 0, 0]));
    let trusted = connect_ip.is_some_and(|ip| trusted_proxies.contains(&ip));
    if !trusted {
        return fallback;
    }
    let Some(forwarded) = headers.get("x-forwarded-for") else {
        return fallback;
    };
    let Ok(raw) = forwarded.to_str() else {
        return fallback;
    };
    raw.split(',')
        .next()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .and_then(|part| part.parse::<IpAddr>().ok())
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::resolve_client_ip;
    use axum::http::{HeaderMap, HeaderValue};
    use std::net::IpAddr;

    fn headers(xff: Option<&str>) -> HeaderMap {
        let mut map = HeaderMap::new();
        if let Some(value) = xff {
            map.insert("x-forwarded-for", HeaderValue::from_str(value).unwrap());
        }
        map
    }

    #[test]
    fn untrusted_connection_ignores_forwarded_header() {
        let connect = IpAddr::from([10, 0, 0, 5]);
        let trusted: [IpAddr; 0] = [];
        assert_eq!(
            resolve_client_ip(Some(connect), &headers(Some("1.2.3.4")), &trusted),
            connect
        );
    }

    #[test]
    fn trusted_proxy_uses_first_forwarded_ip() {
        let connect = IpAddr::from([10, 0, 0, 5]);
        let trusted = [connect];
        assert_eq!(
            resolve_client_ip(Some(connect), &headers(Some("1.2.3.4, 10.0.0.1")), &trusted),
            IpAddr::from([1, 2, 3, 4])
        );
    }

    #[test]
    fn malformed_forwarded_falls_back_to_connection() {
        let connect = IpAddr::from([10, 0, 0, 5]);
        let trusted = [connect];
        assert_eq!(
            resolve_client_ip(Some(connect), &headers(Some("not-an-ip")), &trusted),
            connect
        );
    }
}
