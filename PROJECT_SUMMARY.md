# Lycoris 项目总览（2026-09-14）

Lycoris 是提供无障碍与友好设施信息的地图协作平台。核心能力包括点位发现、附近查询、图片预览、收藏、导航跳转、投稿、编辑提案、图片提案与管理员审核。

## 仓库与默认技术栈

| 目录 | 当前职责 |
| --- | --- |
| `frontend/` | React + TypeScript + Vite + MUI + Leaflet 网页 |
| `mobile/` | React Native Android / iOS 应用，包含原生桥接与 WebView 地图 |
| `backend-rust/` | **默认后端**：Rust + Axum + SQLx；无 ORM，按业务划分模块的单体服务 |
| `backend/` | 已弃用的 Java / Spring Boot 实现；保留供现有线上服务和回退参考 |

数据库使用 PostgreSQL + PostGIS；Redis 保存会话、缓存与限流状态。版本由 Rust 工具链文件、Cargo.lock 与 Compose 镜像固定，详见 [Rust 后端说明](backend-rust/README.md)。

## 业务与认证

Web 和 App 共用既有 HTTP 契约。点位、译文与图片提案经审核后公开；用户可以管理资料、头像、收藏和自己创建的点位。图片通过后端受控接口读取。

Rust 保留 Cookie、账号密码与管理员二次验证体验，通过类型化 Redis 会话与 Axum 提取器实施权限校验。全部 PostgreSQL 业务读写使用 SQLx 参数化 SQL。认证方式的后续重设计独立进行。

## 本地启动与验证

后端默认地址为 `http://127.0.0.1:8080`，Web 默认经 Vite 代理到该地址。日常在仓库根执行：

```bash
python backend-rust/scripts/run-local.py
```

首次配置、数据库启动与显式迁移步骤见 [README](README.md#克隆与初始化)。普通启动不自动执行 DDL。

重构阶段 0 至 5 已完成本地验收：43 个 API 契约模板、223 项 Linux 检查、64 条真实 TCP 断言，以及 PG 升级、媒体核对、Java 应用回退、Web/Android 和空间查询验证。该数字对应阶段 5 的已保存证据，本轮启动入口的检查单独记录于 [本地默认切换](docs/rust-migration/local-default.md)。

## 发布边界

本次正式切换的范围是**仓库与本地开发**。线上 `api.lycoris.online` 继续运行 Java；旧部署文件保持原用途，Rust 的发布 Compose 仍用于本地演练。生产切换、数据库升级与认证演进需按后续任务执行。

架构见 [程序架构](docs/architecture.md)，开发计划与历史验收见 [重构计划](docs/rust-backend-plan.md) 和 [执行记录](docs/rust-migration/execution.md)。
