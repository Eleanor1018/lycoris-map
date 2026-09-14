//! 写请求来源校验中间件（与 CORS 分别实施）。
//!
//! 对所有非安全方法（含 login/register/logout）统一生效：
//! - 浏览器写请求携带 `Origin`：必须命中显式配置的来源；`null`/非法/不匹配一律拒绝。
//! - 无 `Origin` 时：明确的跨站 `Sec-Fetch-Site: cross-site` 拒绝；存在 `Referer` 时校验其来源；
//!   完全无浏览器头（原生 App）继续兼容。
//!
//! CORS 只控制“跨域读取”白名单，不替代本中间件对“跨站写入”的拦截。

use std::str::FromStr;

use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::middleware::Next;
use axum::response::Response;

use crate::app::AppState;
use crate::web;

pub async fn enforce_write_origin(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    if matches!(method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return next.run(request).await;
    }

    let allowed = &state.config.write_allowed_origins;
    if !origin_allowed(request.headers(), allowed) {
        return web::text(StatusCode::FORBIDDEN, "跨站请求被拒绝");
    }
    next.run(request).await
}

fn origin_allowed(headers: &HeaderMap, allowed: &[HeaderValue]) -> bool {
    if let Some(origin) = headers.get(header::ORIGIN) {
        return origin_matches(origin, allowed);
    }

    // 无 Origin：先看 Fetch Metadata。cross-site 拒绝；合法同源值继续；非法值不可信。
    if let Some(site) = headers.get("sec-fetch-site") {
        let Ok(site) = site.to_str() else {
            return false;
        };
        match site.trim().to_ascii_lowercase().as_str() {
            "cross-site" => return false,
            "same-origin" | "same-site" | "none" => {}
            // 非法/未知 FetchMetadata 值不当可信 same-origin 处理。
            _ => return false,
        }
    }

    // 有 Referer 就必须通过白名单校验（即使已声明 same-origin/same-site）。
    if let Some(referer) = headers.get(header::REFERER) {
        return referer_matches(referer, allowed);
    }

    // 完全无浏览器头：兼容 React Native 客户端。
    true
}

fn origin_matches(origin: &HeaderValue, allowed: &[HeaderValue]) -> bool {
    let Ok(value) = origin.to_str() else {
        return false;
    };
    let value = value.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("null") {
        return false;
    }
    allowed
        .iter()
        .filter_map(|item| item.to_str().ok())
        .any(|item| item.eq_ignore_ascii_case(value))
}

/// 从 `Referer` 提取来源（`scheme://authority`）并比对白名单；非法或其它 scheme 拒绝。
fn referer_matches(referer: &HeaderValue, allowed: &[HeaderValue]) -> bool {
    let Ok(raw) = referer.to_str() else {
        return false;
    };
    let Ok(uri) = Uri::from_str(raw.trim()) else {
        return false;
    };
    let (Some(scheme), Some(authority)) = (uri.scheme_str(), uri.authority()) else {
        return false;
    };
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return false;
    }
    if authority.as_str().contains('@') {
        return false;
    }
    let origin = format!("{scheme}://{authority}");
    allowed
        .iter()
        .filter_map(|item| item.to_str().ok())
        .any(|item| item.eq_ignore_ascii_case(&origin))
}

#[cfg(test)]
mod tests {
    use super::{origin_allowed, referer_matches};
    use axum::http::{HeaderMap, HeaderValue};

    fn allowed() -> Vec<HeaderValue> {
        vec![
            HeaderValue::from_static("https://app.example.com"),
            HeaderValue::from_static("http://localhost:5173"),
        ]
    }

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.append(
                axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        map
    }

    #[test]
    fn origin_header_must_match_exactly() {
        let list = allowed();
        assert!(origin_allowed(
            &headers(&[("origin", "https://app.example.com")]),
            &list
        ));
        assert!(!origin_allowed(
            &headers(&[("origin", "https://evil.example.com")]),
            &list
        ));
        assert!(!origin_allowed(&headers(&[("origin", "null")]), &list));
    }

    #[test]
    fn cross_site_fetch_metadata_is_rejected() {
        let list = allowed();
        assert!(!origin_allowed(
            &headers(&[("sec-fetch-site", "cross-site")]),
            &list
        ));
        assert!(origin_allowed(
            &headers(&[("sec-fetch-site", "same-origin")]),
            &list
        ));
    }

    #[test]
    fn referer_is_checked_against_allowlist() {
        let list = allowed();
        assert!(origin_allowed(
            &headers(&[("referer", "https://app.example.com/api/login")]),
            &list
        ));
        assert!(!origin_allowed(
            &headers(&[("referer", "https://evil.example.com/api/login")]),
            &list
        ));
        assert!(!referer_matches(
            &HeaderValue::from_static("not a url"),
            &list
        ));
    }

    #[test]
    fn referer_is_still_checked_despite_same_site_fetch_metadata() {
        let list = allowed();
        assert!(!origin_allowed(
            &headers(&[
                ("sec-fetch-site", "same-site"),
                ("referer", "https://evil.example.com/x"),
            ]),
            &list
        ));
        assert!(origin_allowed(
            &headers(&[
                ("sec-fetch-site", "same-origin"),
                ("referer", "https://app.example.com/x"),
            ]),
            &list
        ));
    }

    #[test]
    fn invalid_fetch_metadata_is_not_trusted() {
        let list = allowed();
        assert!(!origin_allowed(
            &headers(&[("sec-fetch-site", "banana")]),
            &list
        ));
        assert!(!origin_allowed(
            &headers(&[("sec-fetch-site", "cross_site")]),
            &list
        ));
    }

    #[test]
    fn no_browser_headers_is_allowed_for_native_apps() {
        assert!(origin_allowed(&HeaderMap::new(), &allowed()));
    }
}
