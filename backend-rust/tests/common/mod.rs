//! 真实 PG / Redis 集成测试共享工具。
//!
//! 每个用例从测试管理员连接创建 UUID 命名的临时库，应用基线迁移，构造 Router 并用
//! `tower::ServiceExt::oneshot` 直接调用；退出时删除自己的临时库。测试只允许连接
//! 回环地址上的合成测试服务；服务不可用时直接失败，不做静默跳过。

#![allow(dead_code)]

use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;

use axum::body::Body;
use axum::http::Request;
use axum::response::Response;
use fred::interfaces::ClientLike;
use fred::types::config::ServerConfig;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, PgPool};
use tower::ServiceExt;

pub const DEFAULT_TEST_DATABASE_URL: &str =
    "postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust";
pub const DEFAULT_TEST_REDIS_URL: &str = "redis://127.0.0.1:56379";
/// 指向未监听端口的坏依赖地址，用于故障用例（不依赖任何真实服务）。
pub const UNREACHABLE_PG_URL: &str =
    "postgres://lycoris:lycoris_local_test@127.0.0.1:1/lycoris_rust";
pub const UNREACHABLE_REDIS_URL: &str = "redis://127.0.0.1:1";

pub const BASELINE_TABLES: [&str; 6] = [
    "map_markers",
    "map_marker_translations",
    "marker_edit_proposals",
    "marker_favorites",
    "marker_image_proposals",
    "users",
];

pub fn test_database_url() -> String {
    std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| DEFAULT_TEST_DATABASE_URL.to_string())
}

pub fn test_redis_url() -> String {
    std::env::var("TEST_REDIS_URL").unwrap_or_else(|_| DEFAULT_TEST_REDIS_URL.to_string())
}

/// 精确判断主机是否为回环地址（不匹配用户名/查询里出现的 "localhost" 等子串）。
pub fn host_is_loopback(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

pub fn assert_pg_loopback(options: &PgConnectOptions) {
    assert!(
        host_is_loopback(options.get_host()),
        "测试 PostgreSQL 必须位于回环地址"
    );
}

pub fn assert_redis_loopback(config: &fred::types::config::Config) {
    let host = match &config.server {
        ServerConfig::Centralized { server } => server.host.to_string(),
        ServerConfig::Clustered { hosts, .. } | ServerConfig::Sentinel { hosts, .. } => hosts
            .first()
            .map(|server| server.host.to_string())
            .unwrap_or_default(),
    };
    assert!(host_is_loopback(&host), "测试 Redis 必须位于回环地址");
}

/// 通过独立线程 + 新运行时清理，避免在 tokio 运行时线程内 `block_on`。
pub struct TempDatabase {
    admin_options: PgConnectOptions,
    name: String,
    url: String,
}

impl TempDatabase {
    pub async fn create() -> Self {
        let admin_url = test_database_url();
        let admin_options =
            PgConnectOptions::from_str(&admin_url).expect("TEST_DATABASE_URL 格式非法");
        assert_pg_loopback(&admin_options);
        let name = format!("lycoris_test_{}", uuid::Uuid::new_v4().simple());

        let admin = PgPoolOptions::new()
            .max_connections(1)
            .connect_with(admin_options.clone())
            .await
            .expect("无法连接测试 PostgreSQL，请先启动隔离测试服务");
        // 库名来自 UUID（仅十六进制），已审计无注入风险，故显式声明为安全 SQL。
        sqlx::query(sqlx::AssertSqlSafe(format!("CREATE DATABASE \"{name}\"")))
            .execute(&admin)
            .await
            .expect("创建临时测试库失败");
        admin.close().await;

        let url = temp_url(&admin_options, &name);
        Self {
            admin_options,
            name,
            url,
        }
    }

    /// 创建临时库并应用基线迁移，返回可用连接池。
    pub async fn create_migrated() -> (Self, PgPool) {
        let temp = Self::create().await;
        let pool = temp.connect_pool().await;
        lycoris_backend::migrate::run(&pool)
            .await
            .expect("执行基线迁移失败");
        (temp, pool)
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn options(&self) -> PgConnectOptions {
        self.admin_options.clone().database(&self.name)
    }

    pub async fn connect_pool(&self) -> PgPool {
        PgPoolOptions::new()
            .max_connections(5)
            .connect_with(self.options())
            .await
            .expect("连接临时测试库失败")
    }
}

/// 用 PgConnectOptions 构造临时库连接串（不做手写字符串切分）。
pub fn temp_url(admin_options: &PgConnectOptions, database: &str) -> String {
    admin_options
        .clone()
        .database(database)
        .to_url_lossy()
        .to_string()
}

impl Drop for TempDatabase {
    fn drop(&mut self) {
        let admin_options = self.admin_options.clone();
        let name = self.name.clone();
        let _ = std::thread::spawn(move || {
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                eprintln!("[warn] 清理临时测试库 {name} 失败: 无法创建运行时");
                return;
            };
            runtime.block_on(async move {
                match PgPoolOptions::new()
                    .max_connections(1)
                    .connect_with(admin_options)
                    .await
                {
                    Ok(admin) => {
                        // 库名来自 UUID，已审计无注入风险。
                        let sql = format!("DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE)");
                        if let Err(error) =
                            sqlx::query(sqlx::AssertSqlSafe(sql)).execute(&admin).await
                        {
                            eprintln!("[warn] 清理临时测试库 {name} 失败: {error}");
                        }
                        admin.close().await;
                    }
                    Err(error) => {
                        eprintln!("[warn] 清理临时测试库 {name} 失败: {error}");
                    }
                }
            });
        })
        .join();
    }
}

pub async fn connect_redis() -> fred::clients::Client {
    let url = test_redis_url();
    let config = fred::types::config::Config::from_url(&url).expect("测试 Redis URL 格式非法");
    assert_redis_loopback(&config);
    let client = fred::types::Builder::from_config(config)
        .build()
        .expect("构建测试 Redis 客户端失败");
    client
        .init()
        .await
        .expect("无法连接测试 Redis，请先启动隔离测试服务");
    client
}

/// 指向未监听端口且未初始化的客户端；`PING` 会失败或超时，用于故障用例。
pub fn unreachable_redis() -> fred::clients::Client {
    let config =
        fred::types::config::Config::from_url(UNREACHABLE_REDIS_URL).expect("测试 URL 格式非法");
    fred::types::Builder::from_config(config)
        .build()
        .expect("构建测试 Redis 客户端失败")
}

/// 连接到测试 Redis 后立即退出的“已断开”专用客户端，用于故障回源用例；
/// 不停止共享服务，也不影响其他用例。
pub async fn disconnected_redis() -> fred::clients::Client {
    let client = connect_redis().await;
    let _ = client.quit().await;
    client
}

/// 发送请求并读取完整响应（状态、头、体），用于 HTTP 形状断言。
pub async fn call(
    app: &axum::Router,
    uri: &str,
) -> (axum::http::StatusCode, axum::http::HeaderMap, Vec<u8>) {
    call_with_headers(app, uri, &[]).await
}

/// 带请求头的请求。
pub async fn call_with_headers(
    app: &axum::Router,
    uri: &str,
    headers: &[(&str, &str)],
) -> (axum::http::StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut builder = Request::builder().uri(uri);
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    let response: Response = app
        .clone()
        .oneshot(builder.body(Body::empty()).unwrap())
        .await
        .expect("调用 Router 失败");
    let status = response.status();
    let headers = response.headers().clone();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("读取响应体失败")
        .to_vec();
    (status, headers, body)
}

/// 生成每个用例独立的缓存命名空间，避免临时库间 ID 互相污染。
pub fn unique_cache_namespace() -> String {
    format!("lycoris:test:{}", uuid::Uuid::new_v4().simple())
}

/// 距离计算，用于构造半径边界用例（与 Java 测试的球面目标点一致）。
pub fn destination(lat: f64, lng: f64, meters: f64, bearing: f64) -> (f64, f64) {
    let phi = lat.to_radians();
    let lambda = lng.to_radians();
    let angle = meters / 6_371_000.0;
    let theta = bearing.to_radians();
    let x = angle.cos() * phi.cos() - angle.sin() * phi.sin() * theta.cos();
    let y = angle.sin() * theta.sin();
    let z = angle.cos() * phi.sin() + angle.sin() * phi.cos() * theta.cos();
    let result_lat = z.atan2(x.hypot(y)).to_degrees();
    let result_lng = (lambda + y.atan2(x)).to_degrees();
    (result_lat, ((result_lng + 540.0) % 360.0) - 180.0)
}

/// 等距点对：同一距离不同方向，用于验证同距稳定排序。
pub fn destination_pair(lat: f64, lng: f64, meters: f64) -> ((f64, f64), (f64, f64)) {
    (
        destination(lat, lng, meters, 0.0),
        destination(lat, lng, meters, 90.0),
    )
}

/// 等待 Redis 命令生效的短超时（避免测试偶发竞态）。
pub const REDIS_SETTLE: Duration = Duration::from_millis(50);
