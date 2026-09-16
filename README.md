# 夏水仙 Lycoris 🌸

[简体中文](./README.md) | [English](./README.en.md)

**夏水仙**是一个为**跨性别者**提供**无障碍设施信息**和**互助信息**的平台 💗

夏水仙目前由以下页面组成：

- 地图：夏水仙的**核心功能**，我们可以在地图上标注无障碍卫生间、跨性别友好的医疗机构、母婴室等地点，实现信息共享
- 文档：目前编写了**雪雁的HRT指南**；旨在尽量用最简洁的语言、最容易理解的方式，把行之有效的HRT方案和踩过的坑分享给大家
- 关于：介绍夏水仙的项目理念、背景故事与联系方式，让来到这里的人知道这盏小灯为何被点亮

目前提供**网页端**；已发布的 React Native 移动端见下方下载信息。旧 App 源码已转为本地保留，后续将进行原生应用重构。

## Android APK 下载

[下载 Lycoris 1.0.1 Android APK](https://github.com/Eleanor1018/lycoris/releases/download/v1.0.1/Lycoris-v1.0.1.apk) · [SHA-256 校验文件](https://github.com/Eleanor1018/lycoris/releases/download/v1.0.1/Lycoris-v1.0.1.apk.sha256) · [发布说明](https://github.com/Eleanor1018/lycoris/releases/tag/v1.0.1)

本次版本为 **Lycoris 1.0.1（versionCode 3）**，支持 **Android 7.0 及以上**，包含 `arm64-v8a` 和 `x86_64` 架构。APK 沿用 2026-09-06 开始使用的 Release 签名，可在真机侧载安装。

**旧 v1.0 或此前开发包无法被本包覆盖安装，需先卸载旧包。卸载会清除本机登录状态、设置等应用数据。**

2026-09-06 使用同一证书的 **1.0.3 测试版（versionCode 2）可以直接覆盖更新**，无需卸载。本次显示版本为 1.0.1，Android 用于判断更新顺序的 `versionCode` 已由 2 递增至 3。

APK 包含运行所需的 JavaScript 和文档资源，**不需要启动 Metro**；连接生产 API `https://api.lycoris.online`，地图和账号等在线功能需要网络。

## 地图的内置功能

- 标记：可以在地图上标注无障碍卫生间，友好医疗机构，母婴室等点位信息，包含名称 图片 开放时间等。
- 搜索附近：快速搜索定位点附近（0-10000m）的无障碍卫生间等信息。
- 收藏：可以把点位添加到自己的收藏列表中，需要时快速查看。

**注意：添加或编辑点位需要管理员审核，这是为了防止被恶意破坏，敬请谅解。**

## 我们的理念

&ensp;&ensp;&ensp;&ensp;**以温柔与专业守护跨性别者的日常安全，让信息共享成为彼此的光。**

&ensp;&ensp;&ensp;&ensp;所有跨性别都有权利生活在阳光下，自然的展示自己，不必躲闪，不必隐藏，堂堂正正，大大方方。每一个人都应当有平等的权益，跨性别者也不例外。

&ensp;&ensp;&ensp;&ensp;社会的进步是缓慢的，然而每一个微小的努力都会被看见。就从无障碍卫生间开始。  

&ensp;&ensp;&ensp;&ensp;我们会搜集很多个无障碍卫生间，只要打开手机，就可以看到哪里可以上厕所。这样做，就可以让跨性别者，尽量不被误解、避免尴尬，能够放心大胆的出门。

&ensp;&ensp;&ensp;&ensp;**你不是孤单的。**
无论你现在处在探索、挣扎，还是重建生活的哪一步，你都值得被尊重、被认真对待。我们希望在你需要的时候，给你一点真实可用的支持，让你在现实世界里更安全一点、少受一点伤。

&ensp;&ensp;&ensp;&ensp;如果这盏小灯能在某个夜晚帮到你，那我们做的一切，就都值得。

## 技术栈

开发者快速了解项目：[Rust 后端说明](./backend/README.md)。

- frontend：Web v2 新工程，React 19 + TypeScript 7 + Vite 8 + Tailwind 4（S1 工程基础，页面未完成）
- frontend-old：旧 Web 归档，React + MUI + Leaflet，保留用于行为对照与回退，不再新增功能
- backend：Rust + Axum + SQLx（默认后端；无 ORM）
- backend-old：已弃用的 Java / Spring Boot 实现，保留供现有线上与回退参考
- mobile：旧 React Native 应用，仅本地保留；原生 App 重构待实施
- 数据库：PostgreSQL + PostGIS；Redis 用于会话、缓存与限流

## 开源协议

本项目采用 [MIT License](./LICENSE) 开源。

## 克隆与初始化

本仓库已采用单仓库（Monorepo）结构，`backend` / `frontend` 在同一仓库中，`backend-old` 为旧 Java 实现，`frontend-old` 为归档旧 Web；`mobile/` 仅保留本地并由 Git 忽略。

### 1. 准备环境并获取代码

| 组件 | 本仓库的要求 |
| --- | --- |
| JavaScript | Node.js 24.19.0（`frontend/.nvmrc` 已固定）与 pnpm 11.19.0（`packageManager` 已固定）。 |
| 后端 | rustup；进入 `backend/` 后按 `rust-toolchain.toml` 使用 Rust 1.98.1。Windows 原生编译需 Visual Studio C++ Build Tools。后端不再要求 JDK/Maven。 |
| 数据库 | 本地 Compose 固定 PostgreSQL 18.6 + PostGIS 3.6.4；附近查询使用 PostGIS 候选筛选与距离计算。 |
| 缓存与会话 | 本地 Compose 固定 Redis 8.10.1；登录会话需要 Redis。 |

以下示例获取包含本 README 所述功能的 `refactor/rust-backend` 分支：

```bash
git clone --branch refactor/rust-backend https://github.com/Eleanor1018/lycoris-map.git
cd lycoris-map
```

已有仓库时切换到该分支再更新；本机配置和依赖分别安装，不要复制其他机器的 `node_modules`。

```bash
git switch refactor/rust-backend
git pull
```

以下各节从仓库根目录开始操作。后端和网页分别保留在独立终端运行。

### 2. 后端：Rust、数据库与本地启动

**仓库与本地默认后端为 `backend/`（Axum + SQLx）。** `backend-old/` 的 Java 实现保留供现有线上服务与回退参考，线上 API 本次未切换。

从仓库根目录启动本地 PostgreSQL / PostGIS 与 Redis（需要 Docker）：

```bash
docker compose -f backend/compose.test.yml up -d --wait
```

Rust 二进制读取进程环境变量，不自动加载 `.env`。完整变量见 `backend/.env.example`；下面使用 Compose 的空开发库示例，自定义本地数据库或上传目录时设置对应变量。

Windows PowerShell：

```powershell
cd backend
$env:DATABASE_URL = 'postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust'
$env:REDIS_URL = 'redis://127.0.0.1:56379'
$env:WRITE_ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173'
$env:SQLX_OFFLINE = 'true'
```

macOS / Linux：

```bash
cd backend
export DATABASE_URL='postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust'
export REDIS_URL='redis://127.0.0.1:56379'
export WRITE_ALLOWED_ORIGINS='http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173'
export SQLX_OFFLINE=true
```

新开发库首次显式迁移，然后启动；日常只需最后一条命令：

```bash
cargo run --locked -- --migrate
cargo run --locked
```

在 `backend/` 内运行 Cargo，使用目录中固定的 Rust 工具链。默认服务地址为 `http://127.0.0.1:8080`，可访问 `/health/ready` 和 `/api/markers/public` 检查服务；新开发库返回空列表正常。普通启动只读校验迁移状态，不自动建表；已有 Java 数据库按 [Rust 基线接管说明](./backend/README.md) 处理。

Web 的 `/api` 与 `/uploads` 经 Vite 同源代理访问 Rust。若页面端口或域名改变，需调整 `WRITE_ALLOWED_ORIGINS`；真机联调另需设置 `SERVER_HOST=0.0.0.0` 并使用电脑局域网地址。

Python 开发脚本与根 `docs/` 文档仅保留本地，不随 Git 分发。已有本地 `run-local.py` 仍可读取自己的 `.env` 运行；新拉取仓库使用上面的 Cargo 命令，不需要 Python。详细配置与测试见 [Rust 后端说明](./backend/README.md)。

### 3. 网页：安装依赖并启动

> **当前状态：Web v2 处于 S1 工程基础阶段。** 新工程只有工程外壳与后端连通状态屏，完整 Figma 页面在后续阶段实现，尚未达到可用产品状态。需要对照旧行为时参阅 [frontend-old](./frontend-old)（归档，不再新增功能，其 MUI/Cypress/旧构建命令仅适用于旧工程）。

在新的终端，从仓库根目录执行：

```bash
cd frontend
pnpm install
pnpm dev
```

开发服务器固定为 `http://127.0.0.1:5173`（`strictPort`，避免自动换端口导致后端 Cookie/写入来源白名单失配）。Vite 将 `/api`、`/uploads` 与仅用于本机诊断的 `/health` 同源代理到本地 Rust 后端 `http://127.0.0.1:8080`，代理目标为本机固定值，不读取环境变量、不配置服务器地址或密钥，也不改写 `Origin`。

构建和检查：

```bash
pnpm build
pnpm typecheck
pnpm format:check
pnpm test:unit
```

静态产物在 `frontend/dist/`。本工程不包含 ESLint 或 lint 脚本，类型边界由 TypeScript 7 strict 检查负责。

### S1 开发验证入口（不是产品页面，S1 构建不可部署）

S1 只交付工程基础与验证工具；正式地图与账号流程分别在 S2、S4 实现。以下路径**包含在当前 S1 构建产物中**（并非仅开发服务器存在、也未在生产构建中被排除），但约定只在本机使用、不对外发布，不构成可上线功能：

| 路径 | 用途 |
| --- | --- |
| `/` | 状态屏：后端 `/health/live`、`/health/ready` 连通性与重试 |
| `/__dev/map-spike` | 地图生命周期验证：200 个固定**合成**上海点位、常驻 Leaflet 实例、语言/面板/字段更新/增删按钮与更新耗时 |
| `/__dev/qa` | 本机浏览器诊断：375×812 固定 CSS 视口 iframe 预览 + 开发会话表单（真实 `/api/login`、`/api/me`、头像 Blob、`/api/logout`；不注册、不改密码、不硬编码凭据） |

上述诊断不写部署脚本；S1 构建与静态产物**不作为可部署产物**，上线与切流属后续任务。

### 3.1 旧 Web（frontend-old，归档对照）

`frontend-old` 是重构前的 Web，使用 React 19.2 + TypeScript 5.9 + Vite 7 + MUI + Leaflet，并带有 Cypress 用例。它只用于回退与行为对照，依赖安装与构建命令均属于旧工程：

```bash
cd frontend-old
npm ci
npm run dev
npm run build
npm run lint
```

旧工程的历史说明（MUI 组件、Cypress 端到端用例、旧的 `.env.local` 与底图 key 配置）仅适用于 `frontend-old`，不影响新 `frontend`。

### 4. App：准备原生重构

旧 React Native 应用完整保留在本机 `mobile/`，整个目录已由 Git 忽略，新拉取仓库不包含它。旧开发说明可在本机 `mobile/README.md` 与 `mobile/IOS.md` 查阅。

接下来将重构为原生应用；本次仅整理仓库，尚未创建新的原生 App 工程。上方已发布 APK 的下载信息保留为旧版本参考。
