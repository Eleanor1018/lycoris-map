//! 响应与错误形状。
//!
//! 现有 Java 接口同时存在四种响应体（见 `docs/rust-migration/api-contract.md` 1.3）：
//! 1. `ApiResponse`：`{"code":int,"message":str,"data":值或 null}`；
//! 2. 普通 JSON（无 `code/message/data` 包装）；
//! 3. 纯文本中文错误/提示；
//! 4. 空体。
//!
//! 因此这里显式保留四类输出，由接口层按契约选择形状，**不做全局统一包裹**，
//! 也不引入泛型 CRUD 或转发层。业务错误用 [`ApiError`]，引擎级错误用 [`AppError`]。

use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::Value;

/// AuthController 专用响应：`{"code":int,"message":str,"data":值或 null}`。
#[derive(Debug, Clone, Serialize)]
pub struct ApiResponse {
    pub code: i32,
    pub message: String,
    pub data: Value,
}

impl ApiResponse {
    /// 成功体：`{"code":0,"message":"ok","data":...}`。
    pub fn ok(data: Value) -> Self {
        Self {
            code: 0,
            message: "ok".to_string(),
            data,
        }
    }

    /// 失败体：`data` 固定为 `null`，`code` 可与 HTTP 状态码不一致。
    pub fn error(code: i32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: Value::Null,
        }
    }
}

/// 四种响应体形状之一。
#[derive(Debug, Clone)]
pub enum ApiBody {
    /// `{"code","message","data"}`。
    Api(ApiResponse),
    /// 普通 JSON。
    Json(Value),
    /// 纯文本（UTF-8）。
    Text(String),
    /// 空体。
    Empty,
}

/// 带状态码的显式响应。实现 [`IntoResponse`] 时按 [`ApiBody`] 设置 Content-Type。
#[derive(Debug, Clone)]
pub struct ApiReply {
    pub status: StatusCode,
    pub body: ApiBody,
}

impl ApiReply {
    pub fn api(status: StatusCode, payload: ApiResponse) -> Self {
        Self {
            status,
            body: ApiBody::Api(payload),
        }
    }

    pub fn json(status: StatusCode, value: Value) -> Self {
        Self {
            status,
            body: ApiBody::Json(value),
        }
    }

    pub fn text(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            body: ApiBody::Text(message.into()),
        }
    }

    pub fn empty(status: StatusCode) -> Self {
        Self {
            status,
            body: ApiBody::Empty,
        }
    }
}

impl IntoResponse for ApiReply {
    fn into_response(self) -> Response {
        match self.body {
            ApiBody::Api(payload) => (self.status, axum::Json(payload)).into_response(),
            ApiBody::Json(value) => (self.status, axum::Json(value)).into_response(),
            ApiBody::Text(text) => (
                self.status,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                text,
            )
                .into_response(),
            ApiBody::Empty => self.status.into_response(),
        }
    }
}

/// 错误响应形状；调用方按接口契约选择，不做统一包装。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorShape {
    /// AuthController 风格 `ApiResponse`。
    ApiResponse,
    /// Marker/Admin 风格纯文本。
    Text,
    /// 部分成功或 403 场景的空体。
    Empty,
}

/// 业务错误。只描述状态与消息，响应形状留给调用方决定。
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("未登录")]
    Unauthorized,
    #[error("无权限")]
    Forbidden,
    #[error("资源不存在")]
    NotFound,
    #[error("{0}")]
    Conflict(String),
    #[error("上传文件过大")]
    PayloadTooLarge,
    #[error("服务暂时不可用")]
    Unavailable,
    #[error("服务器内部错误")]
    Internal,
}

impl ApiError {
    pub fn status(&self) -> StatusCode {
        match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden => StatusCode::FORBIDDEN,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            ApiError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            ApiError::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// 按选定的形状生成响应。`ApiResponse` 的 `code` 取状态码数值，
    /// 后续若接口需要非等值业务码，再由该接口覆写。
    pub fn into_reply(self, shape: ErrorShape) -> ApiReply {
        let status = self.status();
        let message = self.to_string();
        match shape {
            ErrorShape::ApiResponse => ApiReply::api(
                status,
                ApiResponse::error(i32::from(status.as_u16()), message),
            ),
            ErrorShape::Text => ApiReply::text(status, message),
            ErrorShape::Empty => ApiReply::empty(status),
        }
    }
}

/// 引擎级错误：配置、迁移、数据库、Redis、I/O。
///
/// 不实现全局 [`IntoResponse`]，避免把所有接口错误统一包裹；业务接口应把
/// 这类错误转为 [`ApiError`] 或显式选择 [`ApiReply`] 形状。
///
/// 数据库/Redis/I-O 变体的 `Display` 刻意只给受控摘要，不内联底层错误，
/// 以免启动日志泄露连接参数；底层错误仍可通过 `source()` 取用。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("配置错误: {0}")]
    Config(#[from] crate::config::ConfigError),
    #[error("迁移校验失败: {0}")]
    Migration(#[from] crate::migrate::MigrationError),
    #[error("媒体存储初始化失败: {0}")]
    Media(#[from] crate::media::MediaError),
    #[error("数据库连接或查询失败")]
    Database(#[from] sqlx::Error),
    #[error("Redis 连接或命令失败")]
    Redis(#[from] fred::error::Error),
    #[error("I/O 错误")]
    Io(#[from] std::io::Error),
}
