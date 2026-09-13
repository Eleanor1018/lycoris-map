//! HTTP 路由。`auth` 为 AuthController 对应接口，`admin` 为管理员接口。

pub mod admin;
pub mod auth;

use std::net::{IpAddr, SocketAddr};

use axum::extract::ConnectInfo;
use axum::http::HeaderMap;

use crate::app::AppState;
use crate::ratelimit::resolve_client_ip;

/// 按可信代理策略解析客户端 IP（默认使用实际连接 IP）。
pub(crate) fn client_ip(
    state: &AppState,
    connect: Option<ConnectInfo<SocketAddr>>,
    headers: &HeaderMap,
) -> IpAddr {
    resolve_client_ip(
        connect.map(|info| info.0.ip()),
        headers,
        &state.config.trusted_proxies,
    )
}
