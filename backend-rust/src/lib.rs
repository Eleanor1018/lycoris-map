#![forbid(unsafe_code)]

//! Lycoris Rust 后端库根。
//!
//! - [`app`]：Axum Router、AppState 与健康检查；
//! - [`config`]：环境变量配置，错误信息不泄露连接串密码；
//! - [`error`]：显式的四类响应体与错误类型；
//! - [`media`]：图片存储与读取核心（头像/点位图片共用，不含路由与授权）；
//! - [`multipart`]：上传用的 multipart 读取辅助与媒体错误映射；
//! - [`migrate`]：内嵌迁移基线与启动只读校验；
//! - [`modules`]：按业务域拆分的 HTTP 模块（当前为公开点位读取）；
//! - [`session`]：类型化 Redis 会话（五类原子操作）；
//! - [`password`]：受并发许可保护的 BCrypt 与历史明文兼容；
//! - [`users`]：用户数据访问；
//! - [`auth`]：身份提取器 `OptionalUser`/`CurrentUser`/`AdminUser`/`VerifiedAdmin`；
//! - [`origin`]：写请求来源校验；
//! - [`ratelimit`]：注册限流；
//! - [`routes`]：阶段 2 HTTP 处理器。

pub mod app;
pub mod auth;
pub mod config;
pub mod dto;
pub mod error;
pub mod media;
pub mod migrate;
pub mod modules;
pub mod multipart;
pub mod origin;
pub mod password;
pub mod ratelimit;
pub mod routes;
pub mod session;
pub mod users;
pub mod web;
