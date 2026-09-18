//! `GET /uploads/{directory}/{filename}` 受控读取。
//!
//! 目录白名单拆成两条显式路由：`avatars` 匿名可读、**不加载会话**；`markers` 接
//! [`OptionalUser`] 构造真实 [`Viewer`]，可见性由已验收的 `MediaService::open_uploads` 判断。
//! 非法/缺失/不可见一律 404 空体；合法图片以流式响应发送，
//! `Cache-Control: no-store` 且带 `X-Content-Type-Options: nosniff`。

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::app::AppState;
use crate::auth::OptionalUser;
use crate::media::{ImageVariant, MediaError, MediaServiceError};
use crate::modules::markers::model::Viewer;
use crate::web;

/// GET /uploads/avatars/{filename}（匿名，不加载 Redis 会话）
#[derive(Default, Deserialize)]
pub struct ImageQuery {
    #[serde(default)]
    variant: ImageVariant,
}

pub async fn serve_avatar(
    State(state): State<AppState>,
    Path(filename): Path<String>,
    Query(query): Query<ImageQuery>,
    headers: HeaderMap,
) -> Response {
    open(&state, "avatars", &filename, None, query.variant, &headers).await
}

/// GET /uploads/markers/{filename}（资源级授权）
pub async fn serve_marker(
    State(state): State<AppState>,
    Path(filename): Path<String>,
    user: OptionalUser,
    Query(query): Query<ImageQuery>,
    headers: HeaderMap,
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
    open(
        &state,
        "markers",
        &filename,
        viewer.as_ref(),
        query.variant,
        &headers,
    )
    .await
}

async fn open(
    state: &AppState,
    directory: &str,
    filename: &str,
    viewer: Option<&Viewer<'_>>,
    variant: ImageVariant,
    headers: &HeaderMap,
) -> Response {
    // This authorization runs before hashing, resizing, ETag evaluation, or every
    // Worker cache/R2 read (the Worker performs an uncached HEAD first).
    match state.media.open_uploads(directory, filename, viewer).await {
        Ok(opened) => {
            let prepared = match state
                .media
                .store()
                .prepare(opened, directory, filename, variant)
                .await
            {
                Ok(prepared) => prepared,
                Err(MediaError::Busy) => return web::unavailable(),
                Err(MediaError::NotFound) => return StatusCode::NOT_FOUND.into_response(),
                Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            };
            let etag = format!("\"{}\"", prepared.digest);
            if let Some(expected) = headers.get(header::IF_MATCH).and_then(|v| v.to_str().ok())
                && expected != "*"
                && !expected.split(',').any(|v| v.trim() == etag)
            {
                return StatusCode::PRECONDITION_FAILED.into_response();
            }
            let unchanged = headers
                .get(header::IF_NONE_MATCH)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|value| {
                    value
                        .split(',')
                        .any(|v| v.trim() == "*" || v.trim().trim_start_matches("W/") == etag)
                });
            let mut response = if unchanged {
                StatusCode::NOT_MODIFIED.into_response()
            } else {
                web::stream_image(prepared.opened, "no-store")
            };
            let response_headers = response.headers_mut();
            response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response_headers.insert(
                header::ETAG,
                HeaderValue::from_str(&etag).expect("hex ETag"),
            );
            response_headers.insert(
                "x-lycoris-media-key",
                HeaderValue::from_str(&prepared.object_key).expect("fixed content key"),
            );
            response
        }
        Err(MediaServiceError::NotFound(_)) => StatusCode::NOT_FOUND.into_response(),
        Err(MediaServiceError::Unavailable) => web::unavailable(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
