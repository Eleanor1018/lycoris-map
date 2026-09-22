//! HTTP extractors, cookies, and response helpers.
//!
//! Select the response shape at each route boundary; see [`crate::error`].
//! Authentication failures retain their established JSON contract, including the
//! legacy error text, so clients can recognize them without a schema change.

use axum::body::Body;
use axum::extract::{FromRequest, Request};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use cookie::Cookie;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio_util::io::ReaderStream;

use crate::config::Config;
use crate::error::{ApiReply, ApiResponse};
use crate::media::OpenedImage;

/// 认证/用户等小 JSON 请求的读取上限；点位写请求用 [`MarkerJsonBody`]（全局 8 MiB）。
const JSON_BODY_LIMIT: usize = 64 * 1024;

/// 安全入口未认证响应：HTTP 401 + 固定 JSON。
pub fn security_entry() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        axum::Json(serde_json::json!({ "message": "Spring Security Error" })),
    )
        .into_response()
}

/// 依赖（PG/Redis）故障时的受保护 503；形状为普通 JSON。
pub fn unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        axum::Json(serde_json::json!({ "message": "服务暂时不可用" })),
    )
        .into_response()
}

/// “已认证但角色不足”的 403：与真实 Java 一致，走 Spring Boot 默认错误分派，
/// 返回 `{timestamp,status,error,path}`（timestamp 为当前 UTC，毫秒精度 +00:00）。
/// 注意：二级密码 403 仍用中文纯文本，不走这里。
pub fn forbidden(path: &str) -> Response {
    let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false);
    (
        StatusCode::FORBIDDEN,
        axum::Json(serde_json::json!({
            "timestamp": timestamp,
            "status": 403,
            "error": "Forbidden",
            "path": path,
        })),
    )
        .into_response()
}

pub fn api_ok(data: Value) -> Response {
    ApiReply::api(StatusCode::OK, ApiResponse::ok(data)).into_response()
}

pub fn api_error(status: StatusCode, code: i32, message: impl Into<String>) -> Response {
    ApiReply::api(status, ApiResponse::error(code, message)).into_response()
}

pub fn text(status: StatusCode, message: impl Into<String>) -> Response {
    ApiReply::text(status, message).into_response()
}

pub fn json(status: StatusCode, value: Value) -> Response {
    ApiReply::json(status, value).into_response()
}

pub fn empty(status: StatusCode) -> Response {
    ApiReply::empty(status).into_response()
}

/// 有界 JSON 读取的失败分支；携带足够信息在选择响应形状时展开，避免把大 `Response`
/// 放进 `Result` 的 `Err`（同时便于两种提取器共用）。
enum JsonReadError {
    /// 非 JSON 媒体类型 → 415 纯文本。
    UnsupportedMediaType,
    /// 超过读取上限 → 413 统一 `ApiResponse`。
    TooLarge,
    /// 其它底层读取失败 → 400 纯文本。
    Unreadable,
    /// JSON 反序列化失败 → 400 纯文本。
    Invalid,
}

impl JsonReadError {
    fn into_response(self) -> Response {
        match self {
            JsonReadError::UnsupportedMediaType => text(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "请求内容类型必须是 application/json",
            ),
            JsonReadError::TooLarge => crate::multipart::payload_too_large_response(),
            JsonReadError::Unreadable => text(StatusCode::BAD_REQUEST, "请求体读取失败"),
            JsonReadError::Invalid => text(StatusCode::BAD_REQUEST, "请求参数不合法"),
        }
    }
}

/// 有界 JSON 请求体读取：认证与点位写共用的唯一解析路径。
///
/// - 媒体类型按 `;` 前主类型精确判断，`application/json` 或 `+json` 后缀才接受，
///   `application/jsonp` 之类一律 415 纯文本；
/// - 超过 `limit` → 413 统一 `ApiResponse`（沿用 `GlobalExceptionHandler` 的上传上限文案）；
/// - 其它底层读取失败 → 400 纯文本，**不**假称超限；
/// - JSON 反序列化失败 → 400 纯文本。
///
/// 以贴近 Java `@RequestBody` 行为，而不是 Axum 默认的 415/422。
async fn read_json_body<T>(request: Request, limit: usize) -> Result<T, JsonReadError>
where
    T: DeserializeOwned,
{
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !is_json_media_type(content_type) {
        return Err(JsonReadError::UnsupportedMediaType);
    }

    let bytes = match axum::body::to_bytes(request.into_body(), limit).await {
        Ok(bytes) => bytes,
        Err(error) => {
            // 连接中断、解码等其它读取失败不是“超限”，不能统一假称 413。
            if is_length_limit_error(&error) {
                return Err(JsonReadError::TooLarge);
            }
            return Err(JsonReadError::Unreadable);
        }
    };
    serde_json::from_slice::<T>(&bytes).map_err(|_| JsonReadError::Invalid)
}

/// 认证/用户等小请求的 JSON 提取器（64 KiB 上限）。
pub struct JsonBody<T>(pub T);

impl<S, T> FromRequest<S> for JsonBody<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request(req: Request, _state: &S) -> Result<Self, Self::Rejection> {
        read_json_body(req, JSON_BODY_LIMIT)
            .await
            .map(JsonBody)
            .map_err(JsonReadError::into_response)
    }
}

/// 点位写请求的 JSON 提取器：使用全局 8 MiB 请求上限。
///
/// 点位 `description` 在 PG 为 `text`，Java 没有 64 KiB 限制；创建、普通 PATCH 与管理员 PATCH
/// 不得沿用认证的小请求上限。
pub struct MarkerJsonBody<T>(pub T);

impl<S, T> FromRequest<S> for MarkerJsonBody<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request(req: Request, _state: &S) -> Result<Self, Self::Rejection> {
        read_json_body(req, crate::config::REQUEST_BODY_LIMIT_BYTES)
            .await
            .map(MarkerJsonBody)
            .map_err(JsonReadError::into_response)
    }
}

/// 沿整条 `source()` 链判断是否为 body 长度超限。
///
/// tower-http / axum 的 `Limited` 内部产生 `http_body_util::LengthLimitError`，可能被
/// `Box<dyn Error>`、`axum::Error`、`multer::Error` 等多层包裹；仅检查单层 type 会漏判，
/// 因此这里递归遍历 source 链，不依赖错误字符串。JSON 提取器与 multipart 共用。
pub fn is_length_limit_error(error: &(dyn std::error::Error + 'static)) -> bool {
    if error.is::<http_body_util::LengthLimitError>() {
        return true;
    }
    error.source().is_some_and(is_length_limit_error)
}

/// 媒体类型按 `;` 前的主类型判断；接受 `application/json` 与 `*/*+json`，
/// 明确拒绝 `application/jsonp`。
fn is_json_media_type(value: &str) -> bool {
    let media = value
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    media == "application/json" || media.ends_with("+json")
}

/// 从请求头解析指定名称的 Cookie 值。
pub fn session_token(headers: &HeaderMap, cookie_name: &str) -> Option<String> {
    for value in headers.get_all(header::COOKIE) {
        let Ok(raw) = value.to_str() else {
            continue;
        };
        for parsed in Cookie::split_parse(raw) {
            let Ok(cookie) = parsed else {
                continue;
            };
            if cookie.name() == cookie_name {
                return Some(cookie.value().to_string());
            }
        }
    }
    None
}

fn session_cookie(config: &Config, value: String, max_age_seconds: i64) -> String {
    let mut builder = Cookie::build((config.session_cookie_name.clone(), value))
        .path("/")
        .http_only(true)
        .secure(config.session_cookie_secure)
        .same_site(config.session_cookie_same_site.to_cookie())
        .max_age(cookie::time::Duration::seconds(max_age_seconds));
    if let Some(domain) = &config.session_cookie_domain {
        builder = builder.domain(domain.clone());
    }
    builder.build().to_string()
}

/// 生成登录/注册成功的 `Set-Cookie` 值。
pub fn session_cookie_value(config: &Config, token: &str) -> String {
    session_cookie(
        config,
        token.to_string(),
        config.session_cookie_max_age.as_secs() as i64,
    )
}

/// 生成清除会话的 `Set-Cookie` 值（`Max-Age=0`，需与设置时的 path/domain 一致）。
pub fn cleared_session_cookie_value(config: &Config) -> String {
    session_cookie(config, String::new(), 0)
}

/// 向响应追加 `Set-Cookie`；若会话名产生非法头值则忽略（不会 panic）。
pub fn set_cookie(mut response: Response, config: &Config, token: &str) -> Response {
    if let Ok(value) = HeaderValue::from_str(&session_cookie_value(config, token)) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

/// 清除会话 Cookie。
pub fn clear_cookie(mut response: Response, config: &Config) -> Response {
    if let Ok(value) = HeaderValue::from_str(&cleared_session_cookie_value(config)) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

/// 允许测试或日后扩展直接序列化为 JSON。
pub fn to_json<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

/// 便于在 handler 中构造空体 `Body`。
pub fn empty_body() -> Body {
    Body::empty()
}

/// 以流式响应发送已打开的图片文件。
///
/// 使用 `ReaderStream` 包装文件句柄作为 `Body`，**不整张读入内存**；`Content-Length`
/// 取文件句柄 metadata，并设置 `Content-Type`、`X-Content-Type-Options: nosniff` 与调用方
/// 指定的 `Cache-Control`。打开之后的流错误由连接层传播，不在此预先假定完整成功。
pub fn stream_image(opened: OpenedImage, cache_control: &'static str) -> Response {
    let OpenedImage {
        file,
        content_type,
        len,
    } = opened;
    let body = Body::from_stream(ReaderStream::new(file));
    let builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, len.to_string())
        .header(header::CACHE_CONTROL, cache_control)
        .header("x-content-type-options", "nosniff");
    builder
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}
