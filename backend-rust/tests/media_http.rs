//! 阶段 2 集成 HTTP 测试：头像 3 路由、受控 `/uploads`、私有点位 detail。
//!
//! 全部使用真实 PG / Redis / 临时上传目录；复用 `common` 的临时库与回环校验，
//! 不写真实 `uploads/`，退出即清理。

mod common;

use std::net::{IpAddr, SocketAddr};

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{HeaderName, HeaderValue, Method, Request, StatusCode, header};
use axum::response::Response;
use bytes::Bytes;
use common::{TempDatabase, connect_redis, test_redis_url, unreachable_redis};
use fred::clients::Client;
use futures_util::StreamExt;
use futures_util::stream;
use image::{ExtendedColorType, ImageEncoder};
use lycoris_backend::app::{AppState, build_router};
use lycoris_backend::config::Config;
use lycoris_backend::password::PasswordHasher;
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

const COOKIE_NAME: &str = "LYCORIS_SESSION";
const ALLOWED_ORIGIN: &str = "https://app.example.com";

// ---------------------------------------------------------------------------
// 测试环境
// ---------------------------------------------------------------------------

struct TestEnv {
    _temp: TempDatabase,
    pool: PgPool,
    upload: TempDir,
    config: Config,
    router: Router,
}

impl TestEnv {
    async fn new() -> Self {
        let (temp, pool) = TempDatabase::create_migrated().await;
        let redis = connect_redis().await;
        let unique = Uuid::new_v4().simple().to_string();
        let mut config = Config::new(temp.url(), test_redis_url());
        config.session_namespace = format!("lycoris:test:{unique}:session");
        config.rate_limit_namespace = format!("lycoris:test:{unique}:ratelimit");
        config.marker_cache_namespace = format!("lycoris:test:{unique}:marker");
        // 测试统一 cost 4。
        config.bcrypt_cost = 4;
        config.write_allowed_origins = vec![HeaderValue::from_static(ALLOWED_ORIGIN)];
        config.cors_allowed_origins = vec![HeaderValue::from_static(ALLOWED_ORIGIN)];
        let upload = TempDir::new().expect("创建临时上传目录失败");
        config.upload_dir = upload.path().to_path_buf();
        let router = build_router(
            AppState::new(pool.clone(), redis, config.clone()).expect("构造 AppState 失败"),
        );
        Self {
            _temp: temp,
            pool,
            upload,
            config,
            router,
        }
    }

    fn upload_root(&self) -> &std::path::Path {
        self.upload.path()
    }

    /// 用指定 Redis 客户端重建 Router（同一临时库与上传根），用于依赖故障/匿名读取用例。
    fn router_with_redis(&self, redis: Client) -> Router {
        build_router(
            AppState::new(self.pool.clone(), redis, self.config.clone())
                .expect("构造 AppState 失败"),
        )
    }
}

// ---------------------------------------------------------------------------
// 请求辅助
// ---------------------------------------------------------------------------

struct Call {
    method: Method,
    uri: String,
    content_type: Option<String>,
    body: Vec<u8>,
    /// 需要注入错误/流式 body 时使用；非 `None` 时覆盖 `body`。
    raw_body: Option<Body>,
    cookie: Option<String>,
    headers: Vec<(String, String)>,
}

impl Call {
    fn new(method: Method, uri: &str) -> Self {
        Self {
            method,
            uri: uri.to_string(),
            content_type: None,
            body: Vec::new(),
            raw_body: None,
            cookie: None,
            headers: Vec::new(),
        }
    }

    fn multipart(uri: &str, boundary: &str, body: Vec<u8>) -> Self {
        let mut call = Self::new(Method::POST, uri);
        call.content_type = Some(format!("multipart/form-data; boundary={boundary}"));
        call.body = body;
        call
    }

    fn json(uri: &str, body: serde_json::Value) -> Self {
        let mut call = Self::new(Method::POST, uri);
        call.content_type = Some("application/json".to_string());
        call.body = serde_json::to_vec(&body).expect("序列化 JSON 失败");
        call
    }

    fn raw(method: Method, uri: &str, content_type: &str, body: Body) -> Self {
        let mut call = Self::new(method, uri);
        call.content_type = Some(content_type.to_string());
        call.raw_body = Some(body);
        call
    }

    fn cookie(mut self, token: impl Into<String>) -> Self {
        self.cookie = Some(token.into());
        self
    }

    fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }
}

struct Resp {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: Vec<u8>,
}

impl Resp {
    async fn from(response: Response) -> Self {
        let status = response.status();
        let headers = response.headers().clone();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("读取响应体失败")
            .to_vec();
        Self {
            status,
            headers,
            body,
        }
    }

    fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap_or(serde_json::Value::Null)
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).to_string()
    }

    fn header(&self, name: header::HeaderName) -> Option<&str> {
        self.headers.get(name).and_then(|value| value.to_str().ok())
    }

    fn session_cookie(&self) -> Option<String> {
        for value in self.headers.get_all(header::SET_COOKIE) {
            let raw = value.to_str().ok()?;
            let first = raw.split(';').next().unwrap_or_default();
            if let Some(rest) = first.strip_prefix(&format!("{COOKIE_NAME}=")) {
                return Some(rest.to_string());
            }
        }
        None
    }
}

async fn send(router: &Router, call: Call) -> Resp {
    let mut builder = Request::builder().method(call.method).uri(call.uri);
    if let Some(content_type) = &call.content_type {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    let body = call.raw_body.unwrap_or_else(|| Body::from(call.body));
    let mut req = builder.body(body).expect("构造请求失败");
    if let Some(token) = call.cookie {
        req.headers_mut().insert(
            header::COOKIE,
            HeaderValue::from_str(&format!("{COOKIE_NAME}={token}")).expect("Cookie 非法"),
        );
    }
    for (name, value) in call.headers {
        req.headers_mut().insert(
            HeaderName::from_bytes(name.as_bytes()).expect("请求头名非法"),
            HeaderValue::from_str(&value).expect("请求头值非法"),
        );
    }
    req.extensions_mut().insert(ConnectInfo(SocketAddr::new(
        IpAddr::from([127, 0, 0, 1]),
        51234,
    )));
    Resp::from(router.clone().oneshot(req).await.expect("调用路由失败")).await
}

// ---------------------------------------------------------------------------
// 测试数据辅助
// ---------------------------------------------------------------------------

fn rgba_png(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbaImage::from_fn(width, height, |x, y| {
        image::Rgba([(x * 7) as u8, (y * 11) as u8, 200, 255])
    });
    let mut output = Vec::new();
    image::codecs::png::PngEncoder::new(&mut output)
        .write_image(image.as_raw(), width, height, ExtendedColorType::Rgba8)
        .expect("编码测试 PNG 失败");
    output
}

fn rgb_jpeg(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbImage::from_fn(width, height, |x, y| {
        image::Rgb([(x * 5) as u8, (y * 3) as u8, 120])
    });
    let mut output = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut output)
        .write_image(image.as_raw(), width, height, ExtendedColorType::Rgb8)
        .expect("编码测试 JPEG 失败");
    output
}

struct Part<'a> {
    name: &'a str,
    filename: Option<&'a str>,
    content_type: Option<&'a str>,
    data: &'a [u8],
}

fn file_part<'a>(
    name: &'a str,
    filename: &'a str,
    content_type: &'a str,
    data: &'a [u8],
) -> Part<'a> {
    Part {
        name,
        filename: Some(filename),
        content_type: Some(content_type),
        data,
    }
}

fn field_part<'a>(name: &'a str, data: &'a [u8]) -> Part<'a> {
    Part {
        name,
        filename: None,
        content_type: None,
        data,
    }
}

/// 按给定顺序拼接 multipart/form-data 请求体（保留字段顺序，便于测试重复/尾随字段）。
fn multipart_body(boundary: &str, parts: &[Part<'_>]) -> Vec<u8> {
    let mut body = Vec::new();
    for part in parts {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        match part.filename {
            Some(filename) => body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{}\"; filename=\"{filename}\"\r\n",
                    part.name
                )
                .as_bytes(),
            ),
            None => body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{}\"\r\n", part.name).as_bytes(),
            ),
        }
        if let Some(content_type) = part.content_type {
            body.extend_from_slice(format!("Content-Type: {content_type}\r\n").as_bytes());
        }
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(part.data);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

async fn register(env: &TestEnv, username: &str) -> (String, String) {
    let response = send(
        &env.router,
        Call::json(
            "/api/register",
            serde_json::json!({
                "username": username,
                "nickname": username,
                "email": format!("{username}@example.com"),
                "password": "test-password",
                "website": "",
            }),
        ),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK, "注册应成功");
    let cookie = response.session_cookie().expect("注册应返回会话 Cookie");
    let public_id = response.json()["data"]["publicId"]
        .as_str()
        .expect("缺少 publicId")
        .to_string();
    (cookie, public_id)
}

async fn login(env: &TestEnv, username: &str) -> String {
    let response = send(
        &env.router,
        Call::json(
            "/api/login",
            serde_json::json!({ "username": username, "password": "test-password" }),
        ),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK, "登录应成功");
    response.session_cookie().expect("登录应返回会话 Cookie")
}

async fn insert_admin(env: &TestEnv, username: &str) -> String {
    let hash = PasswordHasher::new(4, 1)
        .hash("test-password".to_string())
        .await
        .expect("生成测试哈希失败");
    let public_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (public_id, username, nickname, email, password, role, deleted, \
         session_version, row_version) VALUES ($1, $2, $2, $3, $4, 'ADMIN', false, 0, 0)",
    )
    .bind(public_id)
    .bind(username)
    .bind(format!("{username}@example.com"))
    .bind(hash)
    .execute(&env.pool)
    .await
    .expect("插入管理员失败");
    login(env, username).await
}

async fn insert_marker(
    env: &TestEnv,
    title: &str,
    is_public: bool,
    review_status: &str,
    owner_public_id: &str,
    mark_image: Option<&str>,
) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO map_markers (
            lat, lng, category, title, description, source_language, is_public, is_active,
            open_time_start, open_time_end, review_status, username, user_public_id,
            mark_image, last_edited_by_owner, version, created_at, updated_at)
         VALUES (31.2, 121.4, 'accessible_toilet', $1, NULL, 'zh', $2, true,
                 NULL, NULL, $3, 'seed-user', $4, $5, true, 0, now(), now())
         RETURNING id",
    )
    .bind(title)
    .bind(is_public)
    .bind(review_status)
    .bind(owner_public_id)
    .bind(mark_image)
    .fetch_one(&env.pool)
    .await
    .expect("插入点位失败")
}

fn write_marker_file(env: &TestEnv, filename: &str, bytes: &[u8]) {
    let dir = env.upload_root().join("markers");
    std::fs::create_dir_all(&dir).expect("创建 markers 目录失败");
    std::fs::write(dir.join(filename), bytes).expect("写入点位图片失败");
}

// ---------------------------------------------------------------------------
// 私有点位 detail
// ---------------------------------------------------------------------------

#[tokio::test]
async fn private_marker_detail_uses_real_viewer() {
    let env = TestEnv::new().await;
    let (owner_cookie, owner_public_id) = register(&env, "detail-owner").await;
    let (other_cookie, _) = register(&env, "detail-other").await;
    let admin_cookie = insert_admin(&env, "detail-admin").await;

    let private = insert_marker(&env, "私有待审", false, "PENDING", &owner_public_id, None).await;
    let public = insert_marker(&env, "公开已审", true, "APPROVED", &owner_public_id, None).await;

    // 匿名：私有 404、公开 200。
    let anon_private = send(
        &env.router,
        Call::new(Method::GET, &format!("/api/markers/{private}")),
    )
    .await;
    assert_eq!(anon_private.status, StatusCode::NOT_FOUND);
    assert!(anon_private.body.is_empty(), "私有 404 应为空体");

    let anon_public = send(
        &env.router,
        Call::new(Method::GET, &format!("/api/markers/{public}")),
    )
    .await;
    assert_eq!(anon_public.status, StatusCode::OK);
    assert_eq!(anon_public.json()["id"], public);

    // 属主与管理员可见私有；他人仍 404。
    for (label, cookie) in [("owner", &owner_cookie), ("admin", &admin_cookie)] {
        let response = send(
            &env.router,
            Call::new(Method::GET, &format!("/api/markers/{private}")).cookie(cookie.clone()),
        )
        .await;
        assert_eq!(response.status, StatusCode::OK, "{label} 应可见私有点位");
        assert_eq!(response.json()["id"], private);
        assert_eq!(response.json()["reviewStatus"], "PENDING");
    }
    let other = send(
        &env.router,
        Call::new(Method::GET, &format!("/api/markers/{private}")).cookie(other_cookie),
    )
    .await;
    assert_eq!(other.status, StatusCode::NOT_FOUND, "非属主仍应 404");
}

// ---------------------------------------------------------------------------
// 头像全链路
// ---------------------------------------------------------------------------

#[tokio::test]
async fn avatar_upload_and_read_full_chain() {
    let env = TestEnv::new().await;
    let (cookie, public_id) = register(&env, "avatar-user").await;

    // 未登录读取：401。
    let unauth = send(&env.router, Call::new(Method::GET, "/api/me/avatar")).await;
    assert_eq!(unauth.status, StatusCode::UNAUTHORIZED);

    // 无头像：404 空体。
    let none = send(
        &env.router,
        Call::new(Method::GET, "/api/me/avatar").cookie(cookie.clone()),
    )
    .await;
    assert_eq!(none.status, StatusCode::NOT_FOUND);
    assert!(none.body.is_empty());

    // 上传 PNG（带 alpha → 重编码 PNG）。浏览器场景显式带允许的 Origin。
    let boundary = "lycoris-avatar-boundary";
    let png = rgba_png(4, 3);
    let body = multipart_body(boundary, &[file_part("file", "me.png", "image/png", &png)]);
    let uploaded = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body)
            .cookie(cookie.clone())
            .header("origin", ALLOWED_ORIGIN),
    )
    .await;
    assert_eq!(uploaded.status, StatusCode::OK, "上传应成功");
    let json = uploaded.json();
    assert_eq!(json["code"], 0);
    assert_eq!(json["message"], "ok");
    for key in [
        "publicId",
        "username",
        "nickname",
        "email",
        "avatarUrl",
        "pronouns",
        "signature",
    ] {
        assert!(
            json["data"].get(key).is_some(),
            "UserResponse 缺少字段 {key}"
        );
    }
    assert_eq!(json["data"]["publicId"], public_id);
    let avatar_url = json["data"]["avatarUrl"]
        .as_str()
        .expect("缺少 avatarUrl")
        .to_string();
    assert!(
        avatar_url.starts_with(&format!("/uploads/avatars/avatar-{public_id}-")),
        "头像 URL 应由前缀 avatar-<publicId>- 构成，实际 {avatar_url}"
    );
    assert!(
        avatar_url.ends_with(".png"),
        "PNG 上传应存为 png：{avatar_url}"
    );

    let filename = avatar_url
        .strip_prefix("/uploads/avatars/")
        .expect("头像 URL 前缀错误");
    let stored = std::fs::read(env.upload_root().join("avatars").join(filename))
        .expect("重编码后的头像文件应存在");

    // me/avatar：MIME、缓存头、nosniff、Content-Length、流式字节。
    let me = send(
        &env.router,
        Call::new(Method::GET, "/api/me/avatar").cookie(cookie.clone()),
    )
    .await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(me.header(header::CONTENT_TYPE), Some("image/png"));
    assert_eq!(
        me.header(header::CACHE_CONTROL),
        Some("public, max-age=600")
    );
    assert_eq!(me.header(header::X_CONTENT_TYPE_OPTIONS), Some("nosniff"));
    let expected_len = stored.len().to_string();
    assert_eq!(
        me.header(header::CONTENT_LENGTH),
        Some(expected_len.as_str())
    );
    assert_eq!(me.body, stored);

    // 公共 ID 头像：匿名可读，同样字节。
    let public = send(
        &env.router,
        Call::new(Method::GET, &format!("/api/users/{public_id}/avatar")),
    )
    .await;
    assert_eq!(public.status, StatusCode::OK);
    assert_eq!(public.header(header::CONTENT_TYPE), Some("image/png"));
    assert_eq!(public.body, stored);

    // /uploads/avatars 匿名可读，no-store + nosniff。
    let uploads = send(
        &env.router,
        Call::new(Method::GET, &format!("/uploads/avatars/{filename}")),
    )
    .await;
    assert_eq!(uploads.status, StatusCode::OK);
    assert_eq!(uploads.header(header::CONTENT_TYPE), Some("image/png"));
    assert_eq!(uploads.header(header::CACHE_CONTROL), Some("no-store"));
    assert_eq!(
        uploads.header(header::X_CONTENT_TYPE_OPTIONS),
        Some("nosniff")
    );
    assert_eq!(uploads.body, stored);

    // 换成无 alpha 的 JPEG：MIME 应为 image/jpeg。
    let jpeg = rgb_jpeg(4, 3);
    let body = multipart_body(
        boundary,
        &[file_part("file", "me.jpg", "image/jpeg", &jpeg)],
    );
    let uploaded = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body).cookie(cookie.clone()),
    )
    .await;
    assert_eq!(uploaded.status, StatusCode::OK);
    let me = send(
        &env.router,
        Call::new(Method::GET, "/api/me/avatar").cookie(cookie.clone()),
    )
    .await;
    assert_eq!(me.header(header::CONTENT_TYPE), Some("image/jpeg"));
    assert!(!me.body.is_empty());
}

#[tokio::test]
async fn avatar_reads_404_for_missing_deleted_and_illegal_references() {
    let env = TestEnv::new().await;
    let (cookie, public_id) = register(&env, "avatar-missing").await;

    // 非法引用：非 /uploads/avatars/ 与路径穿越都按无头像处理。
    for illegal in [
        "http://evil.example/avatar.png",
        "/uploads/avatars/../secret.png",
        "/uploads/markers/whatever.png",
    ] {
        sqlx::query("UPDATE users SET avatar_url = $1 WHERE public_id = $2")
            .bind(illegal)
            .bind(Uuid::parse_str(&public_id).expect("publicId 非法"))
            .execute(&env.pool)
            .await
            .expect("更新 avatar_url 失败");
        let response = send(
            &env.router,
            Call::new(Method::GET, &format!("/api/users/{public_id}/avatar")),
        )
        .await;
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{illegal}");
        assert!(response.body.is_empty());
        let me = send(
            &env.router,
            Call::new(Method::GET, "/api/me/avatar").cookie(cookie.clone()),
        )
        .await;
        assert_eq!(me.status, StatusCode::NOT_FOUND, "{illegal}");
    }

    // 非法 publicId 与不存在的用户都 404。
    for path in [
        "/api/users/not-a-uuid/avatar",
        &format!("/api/users/{}/avatar", Uuid::new_v4()),
    ] {
        let response = send(&env.router, Call::new(Method::GET, path)).await;
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{path}");
    }

    // 已删除用户：匿名按 404；会话失效为 401。
    sqlx::query("UPDATE users SET deleted = true WHERE public_id = $1")
        .bind(Uuid::parse_str(&public_id).expect("publicId 非法"))
        .execute(&env.pool)
        .await
        .expect("软删除用户失败");
    let deleted = send(
        &env.router,
        Call::new(Method::GET, &format!("/api/users/{public_id}/avatar")),
    )
    .await;
    assert_eq!(deleted.status, StatusCode::NOT_FOUND);
    let session = send(
        &env.router,
        Call::new(Method::GET, "/api/me/avatar").cookie(cookie),
    )
    .await;
    assert_eq!(session.status, StatusCode::UNAUTHORIZED);
}

// ---------------------------------------------------------------------------
// 头像上传的 multipart 边界与 413
// ---------------------------------------------------------------------------

#[tokio::test]
async fn avatar_upload_multipart_validation_and_limits() {
    let env = TestEnv::new().await;
    let (cookie, _) = register(&env, "avatar-limits").await;
    let boundary = "lycoris-limit-boundary";
    let png = rgba_png(3, 3);

    // 未登录：401（先认证，后读取 multipart）。
    let body = multipart_body(boundary, &[file_part("file", "x.png", "image/png", &png)]);
    let unauth = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body),
    )
    .await;
    assert_eq!(unauth.status, StatusCode::UNAUTHORIZED);
    assert_eq!(unauth.json()["message"], "Spring Security Error");

    // 非法 Origin：写来源校验先拒绝（403 中文文本）。
    let body = multipart_body(boundary, &[file_part("file", "x.png", "image/png", &png)]);
    let cross = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body)
            .cookie(cookie.clone())
            .header("origin", "https://evil.example.com"),
    )
    .await;
    assert_eq!(cross.status, StatusCode::FORBIDDEN);
    assert!(
        cross
            .header(header::CONTENT_TYPE)
            .unwrap()
            .starts_with("text/plain")
    );

    // 缺 file：400。
    let body = multipart_body(boundary, &[field_part("metadata", b"{}")]);
    let missing = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body).cookie(cookie.clone()),
    )
    .await;
    assert_eq!(missing.status, StatusCode::BAD_REQUEST);
    assert_eq!(missing.json()["code"], 400);

    // 空文件：400「文件为空」。
    let body = multipart_body(
        boundary,
        &[file_part("file", "empty.png", "image/png", b"")],
    );
    let empty = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body).cookie(cookie.clone()),
    )
    .await;
    assert_eq!(empty.status, StatusCode::BAD_REQUEST);
    assert_eq!(empty.json()["code"], 400);
    assert_eq!(empty.json()["message"], "文件为空");

    // 重复 file：400。
    let body = multipart_body(
        boundary,
        &[
            file_part("file", "a.png", "image/png", &png),
            file_part("file", "b.png", "image/png", &png),
        ],
    );
    let duplicate = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body).cookie(cookie.clone()),
    )
    .await;
    assert_eq!(duplicate.status, StatusCode::BAD_REQUEST);
    assert_eq!(duplicate.json()["code"], 400);

    // 无效图片：400（消息来自媒体核心）。
    let body = multipart_body(
        boundary,
        &[file_part("file", "bad.png", "image/png", b"not an image")],
    );
    let invalid = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body).cookie(cookie.clone()),
    )
    .await;
    assert_eq!(invalid.status, StatusCode::BAD_REQUEST);
    assert_eq!(invalid.json()["code"], 400);

    // 超过 5 MiB：413，形状为 GlobalExceptionHandler。
    let big = vec![0u8; 5 * 1024 * 1024 + 1];
    let body = multipart_body(boundary, &[file_part("file", "big.png", "image/png", &big)]);
    let too_big = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body).cookie(cookie.clone()),
    )
    .await;
    assert_eq!(too_big.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(too_big.json()["code"], 413);
    assert_eq!(
        too_big.json()["message"],
        "上传文件过大，请选择 5MB 以内的图片"
    );
    assert!(too_big.json()["data"].is_null());

    // 整个请求超过 8 MiB（合法小文件 + 尾随未知字段）：仍是 413 JSON，不是空体。
    let padding = vec![b'x'; 8 * 1024 * 1024];
    let body = multipart_body(
        boundary,
        &[
            file_part("file", "ok.png", "image/png", &png),
            field_part("trailing", &padding),
        ],
    );
    let over_total = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body).cookie(cookie.clone()),
    )
    .await;
    assert_eq!(over_total.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(over_total.json()["code"], 413);
    assert_eq!(
        over_total.json()["message"],
        "上传文件过大，请选择 5MB 以内的图片"
    );

    // 已知 Content-Length 超过 8 MiB：外层请求上限提前拒绝，不读入请求体，仍是 413 JSON。
    let declared = (8 * 1024 * 1024 + 1).to_string();
    let body = multipart_body(boundary, &[file_part("file", "ok.png", "image/png", &png)]);
    let early = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body)
            .cookie(cookie.clone())
            .header("content-length", &declared),
    )
    .await;
    assert_eq!(early.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(early.json()["code"], 413);
    assert_eq!(
        early.json()["message"],
        "上传文件过大，请选择 5MB 以内的图片"
    );

    // 总请求 >2 MiB（Axum 默认）但 <5 MiB：证明默认 2 MiB 已被 8 MiB 覆盖。
    let metadata = vec![b'm'; 3 * 1024 * 1024];
    let body = multipart_body(
        boundary,
        &[
            file_part("file", "ok.png", "image/png", &png),
            field_part("metadata", &metadata),
        ],
    );
    let passed = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body).cookie(cookie),
    )
    .await;
    assert_eq!(
        passed.status,
        StatusCode::OK,
        ">2MiB 且 <5MiB 的 multipart 必须通过，证明默认 2MiB 已覆盖"
    );
    assert_eq!(passed.json()["code"], 0);
}

// ---------------------------------------------------------------------------
// 受控 /uploads/markers 授权
// ---------------------------------------------------------------------------

#[tokio::test]
async fn marker_upload_reads_authorize_by_viewer() {
    let env = TestEnv::new().await;
    let (owner_cookie, owner_public_id) = register(&env, "upload-owner").await;
    let (other_cookie, _) = register(&env, "upload-other").await;
    let admin_cookie = insert_admin(&env, "upload-admin").await;

    write_marker_file(&env, "public.png", b"public-image");
    write_marker_file(&env, "private.png", b"private-image");

    insert_marker(
        &env,
        "公开图",
        true,
        "APPROVED",
        &owner_public_id,
        Some("/uploads/markers/public.png"),
    )
    .await;
    insert_marker(
        &env,
        "私有图",
        false,
        "APPROVED",
        &owner_public_id,
        Some("/uploads/markers/private.png"),
    )
    .await;

    // 公开图片匿名可读。
    let anon_public = send(
        &env.router,
        Call::new(Method::GET, "/uploads/markers/public.png"),
    )
    .await;
    assert_eq!(anon_public.status, StatusCode::OK);
    assert_eq!(anon_public.header(header::CACHE_CONTROL), Some("no-store"));
    assert_eq!(anon_public.body, b"public-image");

    // 私有图片：匿名/他人 404，属主/管理员 200。
    for (label, cookie) in [("anon", None), ("other", Some(&other_cookie))] {
        let call = Call::new(Method::GET, "/uploads/markers/private.png");
        let response = match cookie {
            Some(cookie) => send(&env.router, call.cookie(cookie.clone())).await,
            None => send(&env.router, call).await,
        };
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{label} 不应可见");
        assert!(response.body.is_empty());
    }
    for (label, cookie) in [("owner", &owner_cookie), ("admin", &admin_cookie)] {
        let response = send(
            &env.router,
            Call::new(Method::GET, "/uploads/markers/private.png").cookie(cookie.clone()),
        )
        .await;
        assert_eq!(response.status, StatusCode::OK, "{label} 应可见");
        assert_eq!(response.body, b"private-image");
    }

    // 非法目录/文件/缺失 404。
    for path in [
        "/uploads/etc/a.png",
        "/uploads/markers/no-such-file.png",
        "/uploads/markers/bad%.png",
    ] {
        let response = send(&env.router, Call::new(Method::GET, path)).await;
        assert_eq!(response.status, StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn avatar_and_anonymous_marker_reads_do_not_need_redis() {
    let env = TestEnv::new().await;
    let (_, owner_public_id) = register(&env, "upload-noredis").await;
    write_marker_file(&env, "public.png", b"public-image");
    insert_marker(
        &env,
        "公开图",
        true,
        "APPROVED",
        &owner_public_id,
        Some("/uploads/markers/public.png"),
    )
    .await;
    let avatar_dir = env.upload_root().join("avatars");
    std::fs::create_dir_all(&avatar_dir).unwrap();
    std::fs::write(avatar_dir.join("anon.png"), b"avatar-image").unwrap();

    // Redis 不可用：avatars 与匿名 markers 读取都不应加载会话。
    let router = env.router_with_redis(unreachable_redis());

    let avatar = send(&router, Call::new(Method::GET, "/uploads/avatars/anon.png")).await;
    assert_eq!(avatar.status, StatusCode::OK, "匿名头像读取不应依赖 Redis");
    assert_eq!(avatar.body, b"avatar-image");

    let marker = send(
        &router,
        Call::new(Method::GET, "/uploads/markers/public.png"),
    )
    .await;
    assert_eq!(
        marker.status,
        StatusCode::OK,
        "匿名公开点位图片不应依赖 Redis"
    );
    assert_eq!(marker.body, b"public-image");
}

// ---------------------------------------------------------------------------
// 全局请求体上限与 CORS
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cors_headers_present_on_request_limit_413() {
    let env = TestEnv::new().await;
    let (cookie, _) = register(&env, "cors-user").await;
    let declared = (8 * 1024 * 1024 + 1).to_string();

    // 已知 Content-Length 超限（不读 body 的 GET /health/live）：413 且带 CORS 头与 Vary。
    let response = send(
        &env.router,
        Call::new(Method::GET, "/health/live")
            .header("origin", ALLOWED_ORIGIN)
            .header("content-length", &declared),
    )
    .await;
    assert_eq!(response.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(response.json()["code"], 413);
    assert_eq!(
        response.header(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(ALLOWED_ORIGIN),
        "已允许 Origin 的 413 必须带 Access-Control-Allow-Origin"
    );
    assert_eq!(
        response.header(header::ACCESS_CONTROL_ALLOW_CREDENTIALS),
        Some("true")
    );
    let vary = response
        .header(header::VARY)
        .unwrap_or_default()
        .to_lowercase();
    assert!(vary.contains("origin"), "413 必须保留 CORS 的 Vary: {vary}");

    // 非白名单 Origin：413 但不发 allow-origin。
    let denied = send(
        &env.router,
        Call::new(Method::GET, "/health/live")
            .header("origin", "https://evil.example.com")
            .header("content-length", &declared),
    )
    .await;
    assert_eq!(denied.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(
        denied.header(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none(),
        "非白名单 Origin 不得收到 allow-origin"
    );

    // 无 Content-Length 的流式 multipart 超限：同样 413 且带 CORS 头（写来源也允许）。
    let boundary = "lycoris-cors-boundary";
    let png = rgba_png(3, 3);
    let padding = vec![b'x'; 8 * 1024 * 1024];
    let body = multipart_body(
        boundary,
        &[
            file_part("file", "ok.png", "image/png", &png),
            field_part("trailing", &padding),
        ],
    );
    let streamed = send(
        &env.router,
        Call::multipart("/api/me/avatar", boundary, body)
            .cookie(cookie)
            .header("origin", ALLOWED_ORIGIN),
    )
    .await;
    assert_eq!(streamed.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(streamed.json()["code"], 413);
    assert_eq!(
        streamed.header(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(ALLOWED_ORIGIN),
        "流式 multipart 超限的 413 必须带 Access-Control-Allow-Origin"
    );
    assert_eq!(
        streamed.header(header::ACCESS_CONTROL_ALLOW_CREDENTIALS),
        Some("true")
    );
}

#[tokio::test]
async fn global_body_limit_covers_routes_that_do_not_read_body() {
    let env = TestEnv::new().await;

    // GET /health/live 不读 body，但 tower-http 全局限制仍按 Content-Length 提前 413。
    let declared = (8 * 1024 * 1024 + 1).to_string();
    let response = send(
        &env.router,
        Call::new(Method::GET, "/health/live").header("content-length", &declared),
    )
    .await;
    assert_eq!(
        response.status,
        StatusCode::PAYLOAD_TOO_LARGE,
        "不读 body 的接口也必须受全局 8 MiB 上限约束"
    );
    assert_eq!(response.json()["code"], 413);
    assert_eq!(
        response.json()["message"],
        "上传文件过大，请选择 5MB 以内的图片"
    );
}

#[tokio::test]
async fn json_body_length_limit_is_structured_and_read_failure_is_400() {
    let env = TestEnv::new().await;

    // 超过 JSON 提取器 64 KiB 上限：与本轮统一 413 契约同一文案（不再单独造字），
    // 且已允许 Origin 时 CORS 头仍在。
    let huge = serde_json::json!({ "username": "x".repeat(70 * 1024), "password": "y" });
    let oversized = send(
        &env.router,
        Call::json("/api/login", huge).header("origin", ALLOWED_ORIGIN),
    )
    .await;
    assert_eq!(oversized.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(oversized.json()["code"], 413);
    assert_eq!(
        oversized.json()["message"],
        "上传文件过大，请选择 5MB 以内的图片",
        "JSON 请求体超限必须复用统一 413 文案"
    );
    assert_eq!(
        oversized.header(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(ALLOWED_ORIGIN),
        "JSON 提取器 413 也必须保留 CORS 头"
    );

    // 请求体读取中途出错（截断/网络）：400 请求体读取失败，不是 413。
    let failing = stream::once(async { Ok::<Bytes, std::io::Error>(Bytes::from_static(b"{")) })
        .chain(stream::once(async {
            Err::<Bytes, std::io::Error>(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "truncated",
            ))
        }));
    let broken = send(
        &env.router,
        Call::raw(
            Method::POST,
            "/api/login",
            "application/json",
            Body::from_stream(failing),
        ),
    )
    .await;
    assert_eq!(broken.status, StatusCode::BAD_REQUEST);
    assert_eq!(broken.text(), "请求体读取失败");
}
