//! `markers` 模块：公开点位读取、本地化、查询缓存与阶段 3 写入核心。
//!
//! 拆分：
//! - [`model`]：数据库行 [`model::MarkerRow`] 与响应 DTO [`model::MarkerDto`] 分离；
//! - [`repository`]：固定 SQL（`sql/` 下的 `.sql` 文件 + `query_file_as!`）；
//! - [`localization`]：语言协商、类别/开放时间纯函数与源文本哈希；
//! - [`cache`]：独立 Rust 命名空间的 Redis ID 缓存；
//! - [`service`]：读取业务编排（可见性、去重、批量译文、缓存回源）；
//! - [`write_model`]：`Actor`、写入请求 DTO、提案行与局部 `WriteError`；
//! - [`write`]：创建/收藏/删除/编辑提案/管理员审核的事务核心；
//! - [`http`]：公开读取的薄 handler 与路由；
//! - [`write_http`]：写入/收藏/审核的薄 handler 与路由（认证 + 本地化复用）。

pub mod cache;
pub mod http;
pub mod localization;
pub mod model;
pub mod repository;
pub mod service;
pub mod write;
pub mod write_http;
pub mod write_model;
