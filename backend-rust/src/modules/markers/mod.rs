//! `markers` 模块：公开点位读取、本地化与查询缓存。
//!
//! 拆分：
//! - [`model`]：数据库行 [`model::MarkerRow`] 与响应 DTO [`model::MarkerDto`] 分离；
//! - [`repository`]：固定 SQL（`sql/` 下的 `.sql` 文件 + `query_file_as!`）；
//! - [`localization`]：语言协商、类别/开放时间纯函数与源文本哈希；
//! - [`cache`]：独立 Rust 命名空间的 Redis ID 缓存；
//! - [`service`]：业务编排（可见性、去重、批量译文、缓存回源）；
//! - [`http`]：薄 handler 与路由。

pub mod cache;
pub mod http;
pub mod localization;
pub mod model;
pub mod repository;
pub mod service;
