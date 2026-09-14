#![forbid(unsafe_code)]

//! 可执行入口：装配配置、PG 连接池、Redis 客户端与 Router。
//!
//! 普通启动只校验迁移已应用且不执行 DDL；`--migrate` 对空库执行 SQLx 迁移后退出；
//! `--check-baseline` 只读预检已有库结构；`--adopt-baseline` 核对接管已有库并登记真实
//! 基线校验和后退出；`--healthcheck [path]` 只做一次本地 HTTP 探针后退出，不读取数据库配置。
//! 参数互斥，未知参数直接失败，不会误启动服务。

use std::net::SocketAddr;
use std::process::ExitCode;

use fred::clients::Client;
use fred::interfaces::ClientLike;
use lycoris_backend::app::{AppState, build_router};
use lycoris_backend::baseline;
use lycoris_backend::cli::{self, Command};
use lycoris_backend::config::Config;
use lycoris_backend::error::AppError;
use lycoris_backend::healthcheck;
use lycoris_backend::migrate;
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    // 只在入口解析一次，随后按命令分发，避免重复解析或绕过互斥/未知参数校验。
    let command = match cli::parse(std::env::args().skip(1)) {
        Ok(command) => command,
        Err(error) => {
            eprintln!("参数错误: {error}");
            return ExitCode::FAILURE;
        }
    };

    match command {
        Command::Help => {
            println!("{}", cli::USAGE);
            ExitCode::SUCCESS
        }
        // 健康检查不初始化 tracing、不读取数据库配置、不构建 Router。
        Command::Healthcheck(path) => healthcheck::run(path),
        command => {
            init_tracing();
            match run(command).await {
                Ok(()) => ExitCode::SUCCESS,
                Err(err) => {
                    tracing::error!("启动失败: {err}");
                    ExitCode::FAILURE
                }
            }
        }
    }
}

async fn run(command: Command) -> Result<(), AppError> {
    let config = Config::from_env()?;
    // 只记录“已加载”，不打印连接串或其参数。
    tracing::info!("配置加载完成");

    let pool = PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .acquire_timeout(config.db_acquire_timeout)
        .max_lifetime(config.db_max_lifetime)
        .idle_timeout(config.db_idle_timeout)
        .connect(&config.database_url)
        .await?;

    match command {
        Command::Migrate => {
            migrate::run(&pool).await?;
            tracing::info!("迁移完成");
            return Ok(());
        }
        Command::AdoptBaseline => {
            let report = baseline::adopt_baseline(&pool).await?;
            report.log_summary("基线接管");
            tracing::info!("基线接管完成");
            return Ok(());
        }
        Command::CheckBaseline => {
            let report = baseline::check_baseline(&pool).await?;
            report.log_summary("基线预检");
            report.into_result().map(|_| ())?;
            tracing::info!("基线预检通过");
            return Ok(());
        }
        Command::Serve | Command::Help | Command::Healthcheck(_) => {}
    }

    // 普通启动只读校验，不自动执行 DDL。
    migrate::verify_applied(&pool).await?;
    tracing::info!("迁移校验通过");

    let redis = connect_redis(&config.redis_url).await?;
    let state = AppState::new(pool.clone(), redis.clone(), config.clone())?;
    let router = build_router(state);

    let listener = tokio::net::TcpListener::bind((config.server_host, config.server_port)).await?;
    tracing::info!(
        "HTTP 服务已启动，监听 {}:{}",
        config.server_host,
        config.server_port
    );
    // 提供 `ConnectInfo<SocketAddr>`，注册限流据此取得真实连接 IP。
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    tracing::info!("收到关闭信号，释放连接");
    let _ = redis.quit().await;
    pool.close().await;
    tracing::info!("已退出");
    Ok(())
}

async fn connect_redis(url: &str) -> Result<Client, AppError> {
    let config = fred::types::config::Config::from_url(url)?;
    let client = fred::types::Builder::from_config(config).build()?;
    client.init().await?;
    Ok(client)
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,lycoris_backend=debug"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

/// Ctrl+C 或 SIGTERM 触发优雅关闭。
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            tracing::warn!("安装 Ctrl+C 处理器失败: {err}");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
            }
            Err(err) => tracing::warn!("安装 SIGTERM 处理器失败: {err}"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
