//! multipart 读取辅助与上传错误映射。
//!
//! 本模块只负责**从 multipart 请求中安全读取单个文件字段并分类读取错误**；响应形状由调用
//! 接口**显式选择**，避免未来复用后静默改变不同接口的错误体：
//!
//! - [`read_file_field`] 只读取名为 `file` 的单个字段，逐块累计字节数（**不依赖
//!   `Content-Length`**），超过业务上限即返回 [`FileFieldError::PayloadTooLarge`]；
//! - 未知字段被**流式丢弃到 multipart 结束**，避免无 `Content-Length` 的尾随字段绕过外层
//!   请求总上限；
//! - [`file_field_response`] / [`media_error_response`] 接受显式 [`ErrorShape`]：头像等
//!   AuthController 风格接口用 `ApiResponse`；阶段 3 点位图片业务错误用中文纯文本；但
//!   全局 413（与 Java `GlobalExceptionHandler` 一致）在两种接口都必须是 `ApiResponse`。
//!
//! 读取超限的分类同时检查 multer 的 413 状态与整条 `source()` 链中的
//! `http_body_util::LengthLimitError`（tower-http 全局限制会嵌套包裹），不靠错误字符串。

use axum::extract::Multipart;
use axum::http::StatusCode;
use axum::response::Response;

use crate::error::ErrorShape;
use crate::media::MediaServiceError;
use crate::web;

/// 上传超限的统一对外消息（与 Java `GlobalExceptionHandler` 一致）。
pub const UPLOAD_TOO_LARGE_MESSAGE: &str = "上传文件过大，请选择 5MB 以内的图片";

/// 统一的 413 响应形状（`ApiResponse`，与 Java `GlobalExceptionHandler` 一致）。
pub fn payload_too_large_response() -> Response {
    web::api_error(StatusCode::PAYLOAD_TOO_LARGE, 413, UPLOAD_TOO_LARGE_MESSAGE)
}

/// 读取单个文件字段时的可预期错误分类。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileFieldError {
    /// 文件累计字节超过业务上限（或外层请求体超限），对应 413。
    PayloadTooLarge,
    /// multipart 中没有目标文件字段。
    Missing,
    /// 文件字段存在但长度为 0。
    Empty,
    /// 重复出现目标文件字段。
    Duplicate,
    /// multipart 结构非法（坏边界、截断等）。
    Malformed,
}

impl FileFieldError {
    /// 对外 HTTP 状态。
    pub fn status(self) -> StatusCode {
        match self {
            FileFieldError::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            _ => StatusCode::BAD_REQUEST,
        }
    }

    /// 对外中文消息。
    pub fn message(self) -> &'static str {
        match self {
            FileFieldError::PayloadTooLarge => UPLOAD_TOO_LARGE_MESSAGE,
            FileFieldError::Missing => "缺少文件",
            FileFieldError::Empty => "文件为空",
            FileFieldError::Duplicate => "文件重复",
            FileFieldError::Malformed => "请求格式不合法",
        }
    }
}

/// 按调用接口显式选择的形状渲染读取错误。
///
/// 413 始终为 `ApiResponse`（Java 全局处理）；其余读取错误按 `shape` 输出，头像用
/// `ApiResponse`、阶段 3 点位图片用 `Text`。
pub fn file_field_response(error: FileFieldError, shape: ErrorShape) -> Response {
    if matches!(error, FileFieldError::PayloadTooLarge) {
        return payload_too_large_response();
    }
    let status = error.status();
    match shape {
        ErrorShape::ApiResponse => {
            web::api_error(status, i32::from(status.as_u16()), error.message())
        }
        ErrorShape::Text => web::text(status, error.message()),
        ErrorShape::Empty => web::empty(status),
    }
}

/// 头像上传读取错误的响应（AuthController `ApiResponse`）。
pub fn avatar_file_field_response(error: FileFieldError) -> Response {
    file_field_response(error, ErrorShape::ApiResponse)
}

/// 读取名为 `expected` 的单个文件字段。
///
/// 逐块读取并累计，字节数超过 `max_bytes` 立即返回 `PayloadTooLarge`；其它字段流式丢弃直到
/// multipart 结束。外层请求体总上限（8 MiB）由 tower-http 全局限制与 `DefaultBodyLimit`
/// 强制，超限同样映射为 [`FileFieldError::PayloadTooLarge`]。
pub async fn read_file_field(
    multipart: &mut Multipart,
    expected: &str,
    max_bytes: usize,
) -> Result<Vec<u8>, FileFieldError> {
    let mut data: Option<Vec<u8>> = None;

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(error) => return Err(field_read_error(&error)),
        };

        let is_target = field.name().is_some_and(|name| name == expected);
        let mut field = field;

        if is_target {
            if data.is_some() {
                return Err(FileFieldError::Duplicate);
            }
            let mut buffer: Vec<u8> = Vec::new();
            loop {
                match field.chunk().await {
                    Ok(Some(chunk)) => {
                        if buffer.len().saturating_add(chunk.len()) > max_bytes {
                            return Err(FileFieldError::PayloadTooLarge);
                        }
                        buffer.extend_from_slice(&chunk);
                    }
                    Ok(None) => break,
                    Err(error) => return Err(field_read_error(&error)),
                }
            }
            data = Some(buffer);
        } else {
            // 丢弃未知字段，但必须读到结束，使整体请求体上限对尾随数据同样生效。
            loop {
                match field.chunk().await {
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(error) => return Err(field_read_error(&error)),
                }
            }
        }
    }

    match data {
        Some(bytes) if bytes.is_empty() => Err(FileFieldError::Empty),
        Some(bytes) => Ok(bytes),
        None => Err(FileFieldError::Missing),
    }
}

/// 把 multer 读取错误区分为超限与结构非法；超限必须保持 413，不能降级为 400。
///
/// multer 自身对 `FieldSizeExceeded`/`StreamSizeExceeded` 直接给 413；对 `StreamReadFailed`
/// 可能只识别出 400/500，此时沿 source 链查 `LengthLimitError`。
fn field_read_error(error: &axum::extract::multipart::MultipartError) -> FileFieldError {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE || web::is_length_limit_error(error) {
        FileFieldError::PayloadTooLarge
    } else {
        FileFieldError::Malformed
    }
}

/// 上传类媒体错误的显式形状映射，供头像与后续点位图片上传共用。
///
/// 413 始终为 `ApiResponse`（Java 全局处理）；其余按 `shape`：头像用 `ApiResponse`，
/// 阶段 3 点位图片业务错误用中文纯文本（乐观锁 409 由调用方按契约单独选用 `ApiResponse`）。
pub fn media_error_response(error: MediaServiceError, shape: ErrorShape) -> Response {
    if error.is_payload_too_large() {
        return payload_too_large_response();
    }
    let status = error.status();
    let message = error.message();
    match shape {
        ErrorShape::ApiResponse => web::api_error(status, i32::from(status.as_u16()), message),
        ErrorShape::Text => web::text(status, message),
        ErrorShape::Empty => web::empty(status),
    }
}

/// 头像上传媒体错误的响应（AuthController `ApiResponse`）。
///
/// `Internal` 保持 Java `AuthController.uploadAvatar` 的 `500 "上传失败"` 文案；
/// 通用 [`media_error_response`] 对内部错误仍用一般消息，供未来管理员媒体业务使用。
pub fn avatar_media_error_response(error: MediaServiceError) -> Response {
    if matches!(error, MediaServiceError::Internal) {
        return web::api_error(StatusCode::INTERNAL_SERVER_ERROR, 500, "上传失败");
    }
    media_error_response(error, ErrorShape::ApiResponse)
}

#[cfg(test)]
mod tests {
    use super::{avatar_media_error_response, media_error_response};
    use crate::error::ErrorShape;
    use crate::media::MediaServiceError;

    async fn json_body(response: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("读取响应体失败");
        serde_json::from_slice(&bytes).expect("响应不是 JSON")
    }

    #[tokio::test]
    async fn avatar_internal_keeps_upload_failed_message() {
        // 头像上传：Internal 保持 Java AuthController 的 500「上传失败」。
        let response = avatar_media_error_response(MediaServiceError::Internal);
        assert_eq!(
            response.status(),
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        );
        let body = json_body(response).await;
        assert_eq!(body["code"], 500);
        assert_eq!(body["message"], "上传失败");

        // 通用映射供未来管理员媒体业务：内部错误保持一般文案。
        let generic = media_error_response(MediaServiceError::Internal, ErrorShape::ApiResponse);
        assert_eq!(
            generic.status(),
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        );
        let body = json_body(generic).await;
        assert_eq!(body["code"], 500);
        assert_eq!(body["message"], "服务器内部错误");
    }
}
