# Lycoris 项目总览（2026-09-17）

Lycoris 是提供无障碍与友好设施信息的地图协作平台。核心能力包括点位发现、附近查询、图片预览、收藏、导航跳转、投稿、编辑提案、图片提案与管理员审核。

## 仓库与默认技术栈

| 目录 | 当前职责 |
| --- | --- |
| `frontend/` | **生产 Web**：React 19.3 + TypeScript 7 strict + Vite 8 + Tailwind 4 + shadcn，部署于 `lycoris-map.com` |
| `frontend-old/` | 重构前 Web 本地归档，已取消 Git 跟踪并忽略；历史源码可从 Git 提取 |
| `mobile/` | 旧 React Native 应用，仅保留本地并由 Git 忽略；后续重构为原生 App |
| `backend/` | **默认后端**：Rust + Axum + SQLx；无 ORM，按业务划分模块的单体服务 |
| `backend-old/` | 已停用的 Java / Spring Boot 本地归档，已取消 Git 跟踪并忽略；历史源码可从 Git 提取 |
| `apps/ios/` | 原生 iOS 工程，使用同一 Rust API |

数据库使用 PostgreSQL + PostGIS；Redis 保存会话、缓存与限流状态。版本由 Rust 工具链文件、Cargo.lock 与 Compose 镜像固定，详见 [Rust 后端说明](backend/README.md)。

## 业务与认证

Web 和 App 共用既有 HTTP 契约。点位、译文与图片提案经审核后公开；用户可以管理资料、头像、收藏和自己创建的点位。图片通过后端受控接口读取。

Rust 保留 Cookie、账号密码与管理员二次验证体验，通过类型化 Redis 会话与 Axum 提取器实施权限校验。全部 PostgreSQL 业务读写使用 SQLx 参数化 SQL。认证方式的后续重设计独立进行。

## 本地启动与验证

后端默认地址为 `http://127.0.0.1:8080`，Web 默认经 Vite 代理到该地址。按根 README 设置进程环境变量后执行：

```bash
cd backend
cargo run --locked
```

Web v2 使用 Node 24.19.0（`frontend/.nvmrc`）与 pnpm 11.19.0，本机开发地址固定 `http://127.0.0.1:5173`：

```bash
cd frontend
pnpm install
pnpm dev          # 另外提供 pnpm build / typecheck / format:check / test:unit
```

本工程不包含 ESLint 或 lint 脚本，类型检查为 TypeScript 7 strict。

另有仅开发模式可用的本地验证入口，不进入正式构建：

- `/__dev/map-spike`：200 个固定合成上海点位的地图生命周期验证（常驻 Leaflet 实例、语言/面板/字段更新/增删与更新耗时）。
- `/__dev/qa`：本机浏览器诊断（375×812 固定 CSS 视口 iframe；开发会话表单走真实 `/api/login`、`/api/me`、头像 Blob、`/api/logout`，不注册、不改密码、不硬编码凭据）。

首次配置、数据库启动与显式迁移步骤见 [README](README.md#克隆与初始化)。普通启动不自动执行 DDL。

重构阶段 0 至 5 已完成本地验收：43 个 API 契约模板、223 项 Linux 检查、64 条真实 TCP 断言，以及 PG 升级、媒体核对、Java 应用回退、Web/Android 和空间查询验证。该数字对应阶段 5 的已保存证据，本轮启动入口的检查单独记录于 `docs/rust-migration/local-default.md`（仅本地）。

## 发布边界

生产 Web 由 Cloudflare Pages 跟随 GitHub `main` 自动部署到 `lycoris-map.com`；旧域名 `lycoris.online` 以 302 保留路径和参数跳转到新域名。生产 API `api.lycoris-map.com` 使用新服务器上的 Rust、PostgreSQL 与 Redis，旧 Java 服务器的应用服务已停用，数据与备份保留。详见 [Web 部署说明](frontend/deploy/cloudflare/README.md)和 [API 部署说明](backend/deploy/production/README.md)。

架构见 `docs/architecture.md`（仅本地），开发计划与历史验收见 `docs/rust-backend-plan.md`（仅本地） 和 `docs/rust-migration/execution.md`（仅本地）。

Python 开发工具与根 `docs/` 开发文档仅保留本地并由 Git 忽略；新拉取仓库按根 README 使用 Cargo 原生命令。

旧移动端目录仅本地保留，原生 iOS 工程见 `apps/ios/`。
