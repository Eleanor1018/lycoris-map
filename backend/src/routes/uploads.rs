//! `GET /uploads/{directory}/{filename}` 受控读取。
//!
//! 目录白名单拆成两条显式路由：`avatars` 匿名可读、**不加载会话**；`markers` 接
//! [`OptionalUser`] 构造真实 [`Viewer`]，可见性由已验收的 `MediaService::open_uploads` 判断。
//! 非法/缺失/不可见一律 404 空体；合法图片以流式响应发送，
//! `Cache-Control: no-store` 且带 `X-Content-Type-Options: nosniff`。

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::app::AppState;
use crate::auth::OptionalUser;
use crate::media::MediaServiceError;
use crate::modules::markers::model::Viewer;
use crate::web;

/// GET /uploads/avatars/{filename}（匿名，不加载 Redis 会话）
pub async fn serve_avatar(State(state): State<AppState>, Path(filename): Path<String>) -> Response {
    open(&state, "avatars", &filename, None).await
}

/// GET /uploads/markers/{filename}（资源级授权）
pub async fn serve_marker(
    State(state): State<AppState>,
    Path(filename): Path<String>,
    user: OptionalUser,
) -> Response {
    let identity = user.0;
    let public_id = identity
        .as_ref()
        .map(|identity| identity.user.public_id.to_string());
    let viewer = identity.as_ref().map(|identity| Viewer {
        public_id: public_id.as_deref(),
        role: identity.user.role.as_str(),
        deleted: identity.user.deleted,
    });
    open(&state, "markers", &filename, viewer.as_ref()).await
}

async fn open(
    state: &AppState,
    directory: &str,
    filename: &str,
    viewer: Option<&Viewer<'_>>,
) -> Response {
    match state.media.open_uploads(directory, filename, viewer).await {
        Ok(opened) => web::stream_image(opened, "no-store"),
        Err(MediaServiceError::NotFound(_)) => StatusCode::NOT_FOUND.into_response(),
        Err(MediaServiceError::Unavailable) => web::unavailable(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
