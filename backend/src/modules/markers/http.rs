//! 公开点位读取与点位图片上传 HTTP 层：薄 handler、查询参数解析、响应与 Vary 头。
//!
//! 成功响应为 JSON 数组或对象，字段与 Java `MapMarker` 一致；读取错误为中文纯文本
//! （`markers` 模块的错误形状），写入（图片上传）错误按契约选形状（400/404/503 文本、
//! 413 `ApiResponse`、保存类 500）。所有成功响应都带
//! `Vary: Accept-Language, X-App-Language`，便于按语言缓存。

use axum::Json;
use axum::Router;
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;

use crate::app::AppState;
use crate::auth::{CurrentUser, OptionalUser};
use crate::error::{ApiError, ErrorShape};
use crate::modules::markers::localization;
use crate::modules::markers::model::{MarkerDto, Viewer};
use crate::multipart::{file_field_response, marker_upload_media_error_response, read_file_field};

const DEFAULT_NEARBY_RADIUS: i32 = 1000;
const DEFAULT_NEARBY_CATEGORY: &str = "accessible_toilet";
const VARY_VALUE: &str = "Accept-Language, X-App-Language";

/// 构建点位路由。静态段优先于 `/{id}`，不会互相遮蔽。
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/markers/public", get(list_public))
        .route("/api/markers/search", get(search))
        .route("/api/markers/nearby", get(nearby))
        .route("/api/markers/viewport", get(viewport))
        .route("/api/markers/{id}", get(detail))
        .route("/api/markers/{id}/image", post(upload_image))
}

#[derive(Debug, Deserialize)]
struct LangOnly {
    lang: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: Option<String>,
    lang: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NearbyQuery {
    lat: Option<f64>,
    lng: Option<f64>,
    radius: Option<i32>,
    category: Option<String>,
    lang: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewportQuery {
    min_lat: Option<f64>,
    max_lat: Option<f64>,
    min_lng: Option<f64>,
    max_lng: Option<f64>,
    categories: Option<String>,
    lang: Option<String>,
}

async fn list_public(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<LangOnly>,
) -> Response {
    let lang = localization::for_read(params.lang.as_deref(), &headers);
    match state.markers.list_public(lang).await {
        Ok(markers) => json_markers(&markers),
        Err(error) => error_response(error),
    }
}

async fn search(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<SearchQuery>,
) -> Response {
    let lang = localization::for_read(params.lang.as_deref(), &headers);
    // 与 Java 一致：`q` 缺失是参数解析层错误（400）；只有显式空串/空白才返回 []。
    let Some(query) = params.q else {
        return error_response(ApiError::BadRequest("缺少 q 参数".to_string()));
    };
    match state.markers.search(Some(&query), lang).await {
        Ok(markers) => json_markers(&markers),
        Err(error) => error_response(error),
    }
}

async fn nearby(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<NearbyQuery>,
) -> Response {
    let lang = localization::for_read(params.lang.as_deref(), &headers);
    let (Some(lat), Some(lng)) = (params.lat, params.lng) else {
        return error_response(ApiError::BadRequest("缺少 lat/lng 参数".to_string()));
    };
    let radius = params.radius.unwrap_or(DEFAULT_NEARBY_RADIUS);
    let category = params
        .category
        .as_deref()
        .unwrap_or(DEFAULT_NEARBY_CATEGORY);
    match state.markers.nearby(lat, lng, radius, category, lang).await {
        Ok(markers) => json_markers(&markers),
        Err(error) => error_response(error),
    }
}

async fn viewport(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ViewportQuery>,
) -> Response {
    let lang = localization::for_read(params.lang.as_deref(), &headers);
    let (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) = (
        params.min_lat,
        params.max_lat,
        params.min_lng,
        params.max_lng,
    ) else {
        return error_response(ApiError::BadRequest("缺少视口边界参数".to_string()));
    };
    match state
        .markers
        .viewport(
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            params.categories.as_deref(),
            lang,
        )
        .await
    {
        Ok(markers) => json_markers(&markers),
        Err(error) => error_response(error),
    }
}

async fn detail(
    State(state): State<AppState>,
    user: OptionalUser,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(params): Query<LangOnly>,
) -> Response {
    // 资源级可见性：身份只从当前数据库账号构造 `Viewer`（管理员或属主可见私有/待审），
    // 匿名只可读 `isPublic && APPROVED`。绝不从请求参数伪造身份。
    let public_id = user
        .0
        .as_ref()
        .map(|identity| identity.user.public_id.to_string());
    let viewer = user.0.as_ref().map(|identity| Viewer {
        public_id: public_id.as_deref(),
        role: if identity.is_admin() { "ADMIN" } else { "USER" },
        deleted: identity.user.deleted,
    });
    let lang = localization::for_read(params.lang.as_deref(), &headers);
    match state.markers.detail(id, viewer.as_ref(), lang).await {
        Ok(Some(marker)) => json_marker(&marker),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => error_response(error),
    }
}

/// POST /api/markers/{id}/image（登录，multipart，字段 `file`）。
///
/// 认证（[`CurrentUser`]）与写来源校验已在提取器/中间件层完成，此处才读取业务体；从数据库
/// 身份构造真实 [`Viewer`]（公共 ID / 角色 / 删除标记），用户名与公共 ID 交给
/// [`MediaService::submit_marker_image`](crate::media::MediaService::submit_marker_image)。
/// 成功返回经 [`MarkerService::localize_row`](crate::modules::markers::service::MarkerService::localize_row)
/// 本地化的原点位（提交**不**直接换图）。错误形状按 Java 契约：400/404/503 为中文纯文本，
/// 413 保持 `ApiResponse`，保存类内部错误统一 `500 "上传失败"`。
async fn upload_image(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(params): Query<LangOnly>,
    user: CurrentUser,
    mut multipart: Multipart,
) -> Response {
    let bytes = match read_file_field(&mut multipart, "file", crate::media::MAX_UPLOAD_BYTES).await
    {
        Ok(bytes) => bytes,
        Err(error) => return file_field_response(error, ErrorShape::Text),
    };

    let lang = localization::for_read(params.lang.as_deref(), &headers);
    let identity = &user.0;
    let public_id = identity.user.public_id.to_string();
    let viewer = Viewer {
        public_id: Some(public_id.as_str()),
        role: identity.user.role.as_str(),
        deleted: identity.user.deleted,
    };

    match state
        .media
        .submit_marker_image(
            id,
            Some(&viewer),
            identity.user.username_or_empty(),
            &public_id,
            bytes,
        )
        .await
    {
        Ok(row) => match state.markers.localize_row(row, lang).await {
            Ok(marker) => json_marker(&marker),
            Err(error) => error_response(error),
        },
        Err(error) => marker_upload_media_error_response(error),
    }
}

pub(super) fn json_markers(markers: &[MarkerDto]) -> Response {
    let mut response = Json(markers).into_response();
    with_vary(&mut response);
    response
}

/// 本地化点位 JSON 响应（附 `Vary`）；供点位图片上传与管理员审批复用。
pub(crate) fn json_marker(marker: &MarkerDto) -> Response {
    let mut response = Json(marker).into_response();
    with_vary(&mut response);
    response
}

pub(super) fn with_vary(response: &mut Response) {
    response
        .headers_mut()
        .insert(header::VARY, HeaderValue::from_static(VARY_VALUE));
}

fn error_response(error: ApiError) -> Response {
    error.into_reply(ErrorShape::Text).into_response()
}
