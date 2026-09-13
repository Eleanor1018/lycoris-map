//! Axum 装配：AppState、Router 与健康检查。
//!
//! 这里挂载健康检查与公开点位读取路由；后续业务路由继续在此挂载。中间件固定
//! 8 MiB 总请求上限、请求超时、按路由模板的访问日志与显式凭据白名单 CORS。

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{MatchedPath, Request, State};
use axum::http::{HeaderName, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use fred::clients::Client;
use fred::prelude::*;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;

use crate::config::{Config, REQUEST_BODY_LIMIT_BYTES};
use crate::modules::markers::cache::MarkerCache;
use crate::modules::markers::repository::MarkerRepository;
use crate::modules::markers::service::MarkerService;

/// `/health/ready` 单项依赖检查的超时；保证依赖卡住时可靠返回 503，
/// 而不会被全局请求超时先截断为 408。
const READY_CHECK_TIMEOUT: Duration = Duration::from_secs(2);

/// 应用共享状态。`Client` 与 `PgPool` 均为克隆廉价的句柄。
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: Client,
    pub config: Arc<Config>,
    pub markers: MarkerService,
}

impl AppState {
    pub fn new(db: PgPool, redis: Client, config: Config) -> Self {
        let markers = MarkerService::new(
            MarkerRepository::new(db.clone()),
            MarkerCache::new(
                redis.clone(),
                config.marker_cache_enabled,
                config.marker_cache_namespace.clone(),
            ),
            config.availability_zone,
        );
        Self {
            db,
            redis,
            config: Arc::new(config),
            markers,
        }
    }
}

/// 组装 Router 与中间件。
pub fn build_router(state: AppState) -> Router {
    let cors = build_cors(&state.config.cors_allowed_origins);
    let request_timeout = state.config.request_timeout;
    Router::new()
        .route("/health/live", get(health_live))
        .route("/health/ready", get(health_ready))
        .merge(crate::modules::markers::http::router())
        // `route_layer` 在路由匹配后执行，因此能读到 `MatchedPath` 路由模板。
        .route_layer(middleware::from_fn(log_requests))
        .layer(cors)
        .layer(RequestBodyLimitLayer::new(REQUEST_BODY_LIMIT_BYTES))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            request_timeout,
        ))
        .with_state(state)
}

fn build_cors(origins: &[axum::http::HeaderValue]) -> CorsLayer {
    CorsLayer::new()
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::AUTHORIZATION,
            HeaderName::from_static("x-app-language"),
        ])
        .allow_origin(AllowOrigin::list(origins.to_vec()))
}

/// 访问日志：只记录路由模板、方法、状态与耗时，不记录带查询串的完整 URI。
async fn log_requests(matched: Option<MatchedPath>, request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let route = matched
        .map(|path| path.as_str().to_string())
        .unwrap_or_else(|| "<unmatched>".to_string());

    let started = Instant::now();
    let response = next.run(request).await;
    let status = response.status();

    tracing::info!(
        target: "lycoris_backend::http",
        %method,
        %route,
        status = status.as_u16(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "request"
    );
    response
}

/// 进程存活探针：不依赖下游，恒返回 200。
async fn health_live() -> impl IntoResponse {
    (StatusCode::OK, Json(json!({ "status": "ok" })))
}

/// 就绪探针：并发检查 PG（`SELECT 1`）与 Redis（`PING`），各自带短超时；
/// 任一失败或超时返回 503。
async fn health_ready(State(state): State<AppState>) -> impl IntoResponse {
    let (db_ok, redis_ok) = tokio::join!(check_database(&state.db), check_redis(&state.redis));
    let ready = db_ok && redis_ok;

    let body: Value = json!({
        "status": if ready { "ok" } else { "unavailable" },
        "checks": {
            "postgres": if db_ok { "ok" } else { "down" },
            "redis": if redis_ok { "ok" } else { "down" },
        }
    });
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(body))
}

async fn check_database(db: &PgPool) -> bool {
    matches!(
        tokio::time::timeout(READY_CHECK_TIMEOUT, sqlx::query("SELECT 1").fetch_one(db)).await,
        Ok(Ok(_))
    )
}

async fn check_redis(redis: &Client) -> bool {
    matches!(
        tokio::time::timeout(READY_CHECK_TIMEOUT, redis.ping::<()>(None)).await,
        Ok(Ok(()))
    )
}
