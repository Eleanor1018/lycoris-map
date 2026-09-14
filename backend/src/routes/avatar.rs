//! AuthController 的头像路由：`GET/POST /api/me/avatar` 与匿名 `GET /api/users/{publicId}/avatar`。
//!
//! 读取只接受合法的 `/uploads/avatars/<文件名>` 引用；用户缺失/已删除/无图/非法引用一律
//! 404 空体，图片以流式发送（头像 `Cache-Control: public, max-age=600`）。
//! 上传先认证与写来源校验，再读取 multipart，最后交给 [`MediaService::upload_avatar`]；
//! 条件更新不覆盖其它资料列。

use axum::extract::{Multipart, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::dto::user_response;
use crate::media::{AvatarUpdateOutcome, MediaDirectory, MediaError};
use crate::multipart::{avatar_file_field_response, avatar_media_error_response, read_file_field};
use crate::users::{self, UserRow};
use crate::web;

/// 头像成功响应缓存 10 分钟（与 Java `CacheControl.maxAge(10, MINUTES).cachePublic()` 一致）。
const AVATAR_CACHE_CONTROL: &str = "public, max-age=600";

/// GET /api/me/avatar
pub async fn me_avatar(State(state): State<AppState>, user: CurrentUser) -> Response {
    let url = match state.media.avatar_url_by_user_id(user.0.user.id).await {
        Ok(Some(url)) => url,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return web::unavailable(),
    };
    open_avatar(&state, &url).await
}

/// GET /api/users/{publicId}/avatar（匿名）
pub async fn user_avatar(State(state): State<AppState>, Path(public_id): Path<String>) -> Response {
    let url = match state.media.avatar_url_by_public_id(&public_id).await {
        Ok(Some(url)) => url,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return web::unavailable(),
    };
    open_avatar(&state, &url).await
}

/// POST /api/me/avatar
pub async fn upload_avatar(
    State(state): State<AppState>,
    user: CurrentUser,
    mut multipart: Multipart,
) -> Response {
    // 认证（CurrentUser）与写来源校验已在提取器/中间件层完成，此处才读取业务体。
    let bytes = match read_file_field(&mut multipart, "file", crate::media::MAX_UPLOAD_BYTES).await
    {
        Ok(bytes) => bytes,
        Err(error) => return avatar_file_field_response(error),
    };

    let public_id = user.0.user.public_id.to_string();
    match state
        .media
        .upload_avatar(user.0.user.id, user.0.user.row_version, &public_id, bytes)
        .await
    {
        Ok(AvatarUpdateOutcome::Updated { avatar_url, .. }) => {
            updated_user_response(&state, &user.0.user, avatar_url).await
        }
        Ok(AvatarUpdateOutcome::NotFound) => {
            web::api_error(StatusCode::NOT_FOUND, 404, "用户不存在")
        }
        Ok(AvatarUpdateOutcome::VersionConflict) => {
            web::api_error(StatusCode::CONFLICT, 409, "数据已更新，请刷新后重试")
        }
        Err(error) => avatar_media_error_response(error),
    }
}

/// 上传成功后回读最新用户。
///
/// PG 已提交时，回读失败**不得**谎称上传回滚：记录受控日志并以本次已写入的 `avatar_url`
/// 构造响应。回读成功则返回数据库当前完整资料（含 7 字段）。
async fn updated_user_response(
    state: &AppState,
    fallback: &UserRow,
    avatar_url: String,
) -> Response {
    match users::find_active_by_id(&state.db, fallback.id).await {
        Ok(Some(latest)) => web::api_ok(user_response(&latest)),
        _ => {
            tracing::warn!(
                target: "lycoris_backend::media",
                "头像已提交但回读用户失败，按已写入结果返回"
            );
            let mut updated = fallback.clone();
            updated.avatar_url = Some(avatar_url);
            web::api_ok(user_response(&updated))
        }
    }
}

/// 打开并流式发送头像文件；非法引用/缺失/非普通文件一律 404。
async fn open_avatar(state: &AppState, url: &str) -> Response {
    let Some((MediaDirectory::Avatars, filename)) = crate::media::parse_media_url(url) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match state
        .images
        .open(MediaDirectory::Avatars.as_str(), filename)
        .await
    {
        Ok(opened) => web::stream_image(opened, AVATAR_CACHE_CONTROL),
        Err(MediaError::InvalidDirectory | MediaError::InvalidName | MediaError::NotFound) => {
            StatusCode::NOT_FOUND.into_response()
        }
        Err(_) => web::unavailable(),
    }
}
