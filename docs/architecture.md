# Lycoris 程序架构

仓库与本地开发默认使用 **Rust + Axum + SQLx** 单体后端，Web 和 App 共用账号、点位、图片与审核逻辑。旧 Java 后端已退出默认开发流程；线上 API 暂时继续运行 Java，本次没有线上切流。

## 模块

| 目录 | 职责 |
| --- | --- |
| [frontend/src](../frontend/src) | React + Vite 网页；`App.tsx` 定义路由，地图使用 Leaflet。 |
| [mobile](../mobile) | React Native Android / iOS 应用，地图使用 WebView + Leaflet。 |
| [backend-rust/src](../backend-rust/src) | 默认后端：Axum Router、认证提取器、业务服务与 SQLx 数据访问，按点位、用户、媒体等业务划分模块。 |
| [backend-rust/migrations](../backend-rust/migrations) | SQLx 版本化迁移；结构变更显式执行，普通启动只做只读校验。 |
| [backend-rust/scripts](../backend-rust/scripts) | 本地启动、检查与发布演练工具。 |
| [backend](../backend) | 已弃用的 Java 源码及原运维配置，为现有线上服务和回退参考保留。 |

## 请求流程

`Web / App → Axum Router → 认证与请求提取 → 业务服务 → SQLx 参数化 SQL → PostgreSQL`

HTTP 层处理输入和既有响应契约；业务服务处理权限、事务与审核规则；数据访问层直接执行 SQL，不引入 ORM。SQLx 宏与 `.sqlx/` 离线元数据支持编译期查询检查。

Web 开发默认通过 Vite 同源代理把 `/api` 与 `/uploads` 转发到 Rust `127.0.0.1:8080`。`VITE_BACKEND_URL` 可在启动 Vite 的进程环境中覆盖；浏览器写请求来源须列入 Rust 的 `WRITE_ALLOWED_ORIGINS`。原生客户端通过配置的 API 地址直连。

登录保留 Cookie + 账号密码 + 管理员二次验证体验。类型化 Redis 会话与 `CurrentUser`、`AdminUser`、`VerifiedAdmin` 提取器执行权限检查；资源读取仍校验点位图片的可见性。Rust 与 Spring Session 的会话格式不同，未来线上切换时需要重新登录。认证重设计另案进行。

## 数据与资源

- **PostgreSQL + PostGIS** 保存用户、点位、收藏、提案与译文。附近查询使用生成的 `geography` 列、GiST 部分索引与 `ST_DWithin` 候选筛选，再按兼容的距离规则计算和排序，保留历史坐标的处理分支。
- **Redis** 保存会话、短期点位 ID 缓存与限流计数；Rust 使用独立命名空间。
- **双语点位**：`map_markers` 保存原文和共享信息，`map_marker_translations` 保存译文；缺失或过期时回退原文。
- **图片与头像** 写入 `UPLOAD_DIR`（默认 `uploads/`），数据库保存 URL；经后端 `/uploads/...` 读取。

安装与启动见 [README](../README.md#克隆与初始化)，环境变量、迁移接管与测试见 [Rust 后端说明](../backend-rust/README.md)。

## 当前验收状态

[重构计划](rust-backend-plan.md) 的阶段 0 至 5 已完成本地验收，包含既有 43 个 API 契约、Linux 发布测试、PG 升级与应用回退、空间查询、Web/Android 流程与同条件性能测量。历史结果见 [执行记录](rust-migration/execution.md)，本轮入口切换见 [本地默认切换](rust-migration/local-default.md)。线上部署须另行安排。
