# Lycoris 程序架构

Web 和 App 共用一套 Spring Boot 后端，账号、点位和审核逻辑统一在服务端处理。

## 模块

| 目录 | 职责 |
| --- | --- |
| [frontend/src](../frontend/src) | React + Vite 网页；`App.tsx` 定义路由，`pages/` 放页面，地图使用 Leaflet。 |
| [mobile](../mobile) | React Native Android / iOS 应用；`App.tsx` 定义导航，`src/screens/` 放页面，地图使用 WebView + Leaflet。 |
| [backend/src/main/java/com/lycoris](../backend/src/main/java/com/lycoris) | Spring Boot 单体服务；处理业务、权限和数据访问。 |
| [backend/deploy](../backend/deploy) | 数据库迁移与 Nginx 回源配置。 |

## 请求流程

`Web / App → HTTP API → controller → service → repository → PostgreSQL`

`controller` 接收请求，`service` 处理业务，`repository` 通过 JPA 读写数据库。线上 API 经 Nginx 转发到后端。

登录使用 `LYCORIS_SESSION` Cookie 和服务端会话；权限由后端校验。普通用户的点位投稿、修改经过审核后公开。

## 数据与资源

- **PostgreSQL** 保存用户、点位、收藏、审核提案与译文；**Redis** 保存登录会话、短期查询缓存和注册限流计数。
- **双语点位**：`map_markers` 保存原文和共享信息，`map_marker_translations` 按点位与语言保存译文。译文缺失或过期时回退原文。
- **图片** 写入上传目录（默认 `uploads/`），数据库保存 URL；通过后端 `/uploads/...` 接口读取，点位图片会校验访问权限。
- **内置文档** 分别位于 `frontend/src/docs/` 和 `mobile/src/docs/`，修改时同步两端内容与图片。

依赖安装和启动步骤见 [README](../README.md#克隆与初始化)；数据库变更见[迁移说明](../backend/deploy/migrations/README.md)。

## 后端重构规划

[Rust 后端重构计划](rust-backend-plan.md) 记录 Axum + SQLx 的架构、最新稳定版本策略、认证演进、注释与代码质量要求，以及温晓指导、苏瑶执行、温晓验收的协作方式。当前在 `refactor/rust-backend` 实施至阶段 3，[执行记录](rust-migration/execution.md) 跟踪验收结果；上述 Spring Boot 服务仍承担生产请求。
