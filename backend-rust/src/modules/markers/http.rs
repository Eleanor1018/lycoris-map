//! 公开点位读取 HTTP 层：薄 handler、查询参数解析、响应与 Vary 头。
//!
//! 成功响应为 JSON 数组或对象，字段与 Java `MapMarker` 一致；错误为中文纯文本
//! （`markers` 模块的错误形状）。所有成功响应都带
//! `Vary: Accept-Language, X-App-Language`，便于按语言缓存。

use axum::Json;
use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Deserialize;

use crate::app::AppState;
use crate::error::{ApiError, ErrorShape};
use crate::modules::markers::localization;
use crate::modules::markers::model::MarkerDto;

const DEFAULT_NEARBY_RADIUS: i32 = 1000;
const DEFAULT_NEARBY_CATEGORY: &str = "accessible_toilet";
const VARY_VALUE: &str = "Accept-Language, X-App-Language";

/// 构建公开点位路由。静态段优先于 `/{id}`，不会互相遮蔽。
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/markers/public", get(list_public))
        .route("/api/markers/search", get(search))
        .route("/api/markers/nearby", get(nearby))
        .route("/api/markers/viewport", get(viewport))
        .route("/api/markers/{id}", get(detail))
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
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(params): Query<LangOnly>,
) -> Response {
    let lang = localization::for_read(params.lang.as_deref(), &headers);
    match state.markers.detail(id, None, lang).await {
        Ok(Some(marker)) => json_marker(&marker),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => error_response(error),
    }
}

fn json_markers(markers: &[MarkerDto]) -> Response {
    let mut response = Json(markers).into_response();
    with_vary(&mut response);
    response
}

fn json_marker(marker: &MarkerDto) -> Response {
    let mut response = Json(marker).into_response();
    with_vary(&mut response);
    response
}

fn with_vary(response: &mut Response) {
    response
        .headers_mut()
        .insert(header::VARY, HeaderValue::from_static(VARY_VALUE));
}

fn error_response(error: ApiError) -> Response {
    error.into_reply(ErrorShape::Text).into_response()
}
