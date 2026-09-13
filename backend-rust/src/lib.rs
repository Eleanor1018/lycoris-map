#![forbid(unsafe_code)]

//! Lycoris Rust 后端库根。
//!
//! - [`app`]：Axum Router、AppState 与健康检查；
//! - [`config`]：环境变量配置，错误信息不泄露连接串密码；
//! - [`error`]：显式的四类响应体与错误类型；
//! - [`migrate`]：内嵌迁移基线与启动只读校验。

pub mod app;
pub mod config;
pub mod error;
pub mod migrate;
