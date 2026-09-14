# 夏水仙 Lycoris 🌸

[简体中文](./README.md) | [English](./README.en.md)

**夏水仙**是一个为**跨性别者**提供**无障碍设施信息**和**互助信息**的平台 💗

夏水仙目前由以下页面组成：

- 地图：夏水仙的**核心功能**，我们可以在地图上标注无障碍卫生间、跨性别友好的医疗机构、母婴室等地点，实现信息共享
- 文档：目前编写了**雪雁的HRT指南**；旨在尽量用最简洁的语言、最容易理解的方式，把行之有效的HRT方案和踩过的坑分享给大家
- 关于：介绍夏水仙的项目理念、背景故事与联系方式，让来到这里的人知道这盏小灯为何被点亮

目前有**网页端**和基于 **React Native** 的**移动端**可供使用。

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

开发者快速了解项目：[程序架构](./docs/architecture.md)。

- frontend： React(Typescript)
- backend-rust：Rust + Axum + SQLx（默认后端；无 ORM）
- backend：已弃用的 Java / Spring Boot 实现，保留供现有线上与回退参考
- mobile: React Native（TypeScript，包含 Android / iOS 原生桥接）
- 数据库：PostgreSQL + PostGIS；Redis 用于会话、缓存与限流

## 开源协议

本项目采用 [MIT License](./LICENSE) 开源。

## 克隆与初始化

本仓库已采用单仓库（Monorepo）结构，`backend-rust` / `frontend` / `mobile` 都在同一个仓库中；`backend` 为旧 Java 实现。

### 1. 准备环境并获取代码

| 组件 | 本仓库的要求 |
| --- | --- |
| JavaScript | Node.js 22（至少 22.12.0）或 Node.js 20（至少 20.19.4），以及随 Node 安装的 npm；同时满足 Vite 7 和 React Native 0.83.1 的要求。 |
| 后端 | rustup；进入 `backend-rust/` 后按 `rust-toolchain.toml` 使用 Rust 1.98.1。启动器需要 Python 3.10+；Windows 原生编译需 Visual Studio C++ Build Tools。后端不再要求 JDK/Maven；Android 构建仍需要其 Java 工具链。 |
| 数据库 | 本地 Compose 固定 PostgreSQL 18.6 + PostGIS 3.6.4；附近查询使用 PostGIS 候选筛选与距离计算。 |
| 缓存与会话 | 本地 Compose 固定 Redis 8.10.1；登录会话需要 Redis。 |
| Android | Android Studio、Android SDK Platform 36、Build-Tools 36.0.0、NDK 27.1.12297006；模拟器或开启 USB 调试的 Android 设备。 |
| iOS | macOS、完整 Xcode、Ruby/Bundler 与 CocoaPods；详细要求见 [iOS 指南](./mobile/IOS.md)。 |

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

以下各节从仓库根目录开始操作。后端、网页和 Metro 分别保留在独立终端运行。

### 2. 后端：Rust、数据库与本地启动

**仓库与本地默认后端为 `backend-rust/`（Axum + SQLx）。** `backend/` 的 Java 实现已退出默认开发流程，保留源码与原运维文件供现有线上服务和回退参考；本次没有切换线上 API。

从仓库根目录启动本地 PostgreSQL / PostGIS 与 Redis（需要 Docker），首次复制配置；已有 `.env` 时保留自己的配置：

```bash
docker compose -f backend-rust/compose.test.yml up -d
python backend-rust/scripts/check-services.py
cp backend-rust/.env.example backend-rust/.env
```

Windows PowerShell 可用 `Copy-Item backend-rust/.env.example backend-rust/.env` 完成首次复制。Python 使用 3.10 或更新版本；macOS / Linux 如只有 `python3`，将命令中的 `python` 替换为 `python3`。

示例连接本机 `55432` 的 `lycoris_rust` 数据库与 `56379` 的 Redis。修改 `backend-rust/.env` 可选用自己的本地数据库和上传目录。新库第一次启动前显式执行迁移，然后启动服务：

```bash
python backend-rust/scripts/run-local.py --migrate
python backend-rust/scripts/run-local.py
```

日常只需第二条命令。启动器读取 `.env`，已有进程环境变量优先，并在正确的 Rust 工具链目录运行 `cargo run --locked`，默认使用 SQLx 离线元数据。首次运行会下载和编译依赖。

默认服务地址为 `http://127.0.0.1:8080`；访问 `/health/ready` 检查数据库与 Redis 是否就绪，访问 `/api/markers/public` 查看 JSON。新开发库返回空列表正常。普通启动只检查迁移状态，不自动建表或修改结构；已有 Java 数据库应按 [Rust 基线接管说明](./backend-rust/README.md) 先检查和接管，不能当空库重复初始化。

Web 通过 Vite 的同源代理访问 `/api` 和 `/uploads`。示例 `WRITE_ALLOWED_ORIGINS` 允许本机 5173 端口；若 Vite 改端口或域名，需把实际页面来源加入白名单并重启 Rust，否则登录等写操作会被拒绝。原生 App 真机联调还需显式设置 `SERVER_HOST=0.0.0.0` 并使用电脑的局域网地址。

详细配置、测试命令和 Linux 发布演练说明见 [Rust 后端说明](./backend-rust/README.md)。`compose.test.yml` 是本地开发/测试依赖，`compose.release.yml` 是发布演练配置，均不作为线上部署命令。

### 3. 网页：安装依赖并启动

在新的终端，从仓库根目录执行：

```bash
cd frontend
npm ci
cp .env.example .env.local
```

编辑 `frontend/.env.local`，本地开发保持 `VITE_API_BASE_URL=` 为空。没有对应底图 key 时，把 `VITE_THUNDERFOREST_API_KEY`、`VITE_TIANDITU_API_KEY` 等模板值清空，使用 OSM。

```bash
npm run dev
```

按终端显示的地址打开网页，默认是 `http://localhost:5173`。Vite 将 `/api` 和 `/uploads` 代理到 `http://127.0.0.1:8080`；自定义代理目标时，在启动 Vite 的**进程环境**中设置 `VITE_BACKEND_URL`。若本机存在配置的 HTTPS 证书与私钥，Vite 会自动使用 HTTPS，以终端输出为准。

构建和检查：

```bash
npm run build
npm run lint
```

静态产物在 `frontend/dist/`。部署静态网页时配置 `VITE_API_BASE_URL` 为目标 API；开发服务器的代理不会随静态产物发布。

### 4. Mobile：安装依赖并启动 Android / iOS

在新的终端，从仓库根目录安装移动端锁定的 JavaScript 依赖：

```bash
cd mobile
npm ci
```

**Android：** 在 Android Studio 的 SDK Manager 安装上述 SDK/NDK，配置 `ANDROID_HOME` 或本机 `android/local.properties` 的 `sdk.dir`，然后启动模拟器或连接调试设备。

```bash
cp .env.mobile.example .env.mobile
```

编辑 `mobile/.env.mobile`：Android 模拟器访问电脑上的后端可使用 `LY_API_BASE_URL=http://10.0.2.2:8080`；真机需改为手机可访问的电脑局域网地址。未使用的底图 key 留空即可。此配置编译进原生应用，修改后需要重新安装应用。

在 `mobile/` 启动 Metro：

```bash
npm start
```

另开终端，在 `mobile/` 安装并运行 Android 应用：

```bash
npm run android
```

**iOS（仅 macOS）：** 在 Mac 上重新运行 `npm ci`，安装完整 Xcode 和 Ruby/Bundler，再安装仓库 Gemfile 与 Pods 依赖：

```bash
bundle install
cd ios
bundle exec pod install
cd ..
npm start
```

另开终端，在 `mobile/` 执行 `npm run ios`。iOS 开发版默认从 Metro 主机推导后端的 8080 端口；自定义 Debug/Release 地址使用 `ios/RuntimeConfig.local.json`，不读取 Android 的 `.env.mobile`。Xcode、模拟器、真机网络、权限、签名和 Archive 的完整步骤见 [mobile/IOS.md](./mobile/IOS.md)。

移动端检查：

```bash
npm test -- --runInBand
npx tsc --noEmit
npm run lint
```

更多移动端配置见 [mobile/README.md](./mobile/README.md)。本地开发步骤与上方可直接安装的测试 APK 独立；后续更新包应沿用本次 Release 的包名和签名。
