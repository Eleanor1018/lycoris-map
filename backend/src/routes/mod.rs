//! HTTP 路由。`auth` 为 AuthController 对应接口，`admin` 为管理员账号接口，
//! `admin_markers` 为管理员图片提案/清理接口，`avatar` 为头像接口，`uploads` 为受控图片读取。

pub mod admin;
pub mod admin_markers;
pub mod auth;
pub mod avatar;
pub mod email;
pub mod uploads;

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
