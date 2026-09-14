# Lycoris Web v2（`frontend/`）

Web v2 新工程，当前处于 **S1 工程基础** 阶段：工程外壳、后端连通状态屏、地图生命周期验证和本机浏览器诊断入口。Figma 页面在后续阶段实现，**本 S1 构建不可部署**。

## 环境与命令

| 项目         | 值                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Node         | 24.19.0（`.nvmrc`）                                                                                   |
| 包管理器     | pnpm 11.19.0（`package.json#packageManager`）                                                         |
| 本机开发地址 | `http://127.0.0.1:5173`（`strictPort`，不会自动换端口）                                               |
| 后端代理     | `/api`、`/uploads`、`/health`（仅诊断）→ `http://127.0.0.1:8080`，同源、不改写 `Origin`、不读环境变量 |

```bash
pnpm install
pnpm dev
pnpm build        # tsc --noEmit && vite build
pnpm typecheck
pnpm format:check
pnpm test:unit
```

本工程不含 ESLint 或 lint 脚本；类型边界由 TypeScript 7 strict 负责。

## 目录

```text
src/
  app/                 启动、Providers、错误边界、S1 dev pathname 入口
  features/map/        S1 状态屏、地图模块（MapCanvas、coords、合成点位）、/__dev/map-spike
  features/dev/        S1 浏览器诊断页 /__dev/qa
  shared/api/          transport、ApiError、各接口 DTO/schema、session
  shared/query/        查询键约定（public / private）
  shared/i18n/         LanguageProvider 与 zh/en 词条
  shared/auth/         authEpoch 纯模块
  shared/lib/          cn 等纯工具
  shared/ui/           定制的 shadcn 原语
  styles/              tokens.css、fonts.css、global.css
```

## S1 开发验证入口（不是产品页面）

| 路径               | 用途                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `/`                | S1 状态屏：后端 `/health/live`、`/health/ready` 连通性与重试                                                   |
| `/__dev/map-spike` | 地图生命周期验证：200 个**固定合成**上海点位、常驻 Leaflet 实例、语言/面板/字段更新/增删按钮、更新的下一帧耗时 |
| `/__dev/qa`        | 本机浏览器诊断：375×812 固定 CSS 视口 iframe 预览 + 开发会话表单                                               |

这些入口由 `src/app/devRoutes.tsx` 按 `window.location.pathname` 切换，**S2 引入真实 Router 时替换**。它们**包含在当前 S1 构建产物中**（不是仅 dev server 存在，也未在生产构建里被排除），但约定只在本机使用、不对外发布。

### `/__dev/map-spike`

- 默认 OSM 底图 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`，保留 OpenStreetMap 署名，不做预取或离线下载，不引入第二套地图引擎、Mapbox 密钥或聚合库。
- 200 个点位是**合成样本**（`src/features/map/syntheticMarkers.ts`），id/version 固定、标题有 zh/en，不代表真实设施，也不是历史数据；用 `CircleMarker` 示意，**不是最终 Figma 图标**。
- 地图模块不按 `language`/面板/筛选/登录状态设 `key`：语言与点位变化只更新 props。地图实例标识用 `WeakMap<LeafletMap, string>` + `L.stamp` 记录，重放 effect 不会伪造新实例。
- 页面展示点数、实例标识、center/zoom，以及一次字段更新到下一动画帧的耗时。该耗时是本机合成样本的**观测值，不是 GPU 或完整地图渲染的性能结论**。

### `/__dev/qa`

- 只提供 **375×812** 一个固定 iframe 尺寸，避免对桌面窗口产生大幅横向溢出。iframe 用真实 CSS 视口尺寸，仅做响应式检查，**不是 iPhone 设备模拟，也不缩放截图冒充手机视口**。
- 开发会话表单是 S1 本机诊断工具，不是产品账号 UI（正式登录在 S4）：
    - 操作者自行输入合成 username/password → 真实 `POST /api/login`，随后 `GET /api/me`（取 AuthEnvelope 的 `data`）、`GET /api/me/avatar`（Blob）、`POST /api/me/avatar`（仅 `file` 字段，合成图片）、`POST /api/logout` 并确认 `/api/me` 返回 401。
    - **不注册账号、不改密码、不硬编码任何凭据或真实用户数据。**
    - 密码不落 localStorage、不打印、不写 URL，提交后立即从组件状态清空。
    - 会话响应受 authEpoch 保护：旧 `/me`、旧头像、旧上传结果不会恢复旧用户；登录 A→B、当前 401、退出都会撤销旧头像 object URL、取消并删除旧 scope 私有查询，公开缓存保留。
    - 登录/退出/上传等操作串行执行，进行中禁用输入与 file 选择。

## 图标与 UI 资产

Figma 图标按设计稿**原样导出**为项目资产，不手绘近似图标，也不用其它图标库代替。因此本工程当前**不依赖 `lucide-react`**（registry 默认图标库仅用于后续取用官方内容时的来源参考）。

## shadcn 组件：来源与当前限制

当前 `src/shared/ui/button.tsx` 的实际来源：

```bash
pnpm dlx shadcn@4.21.0 add button
```

- 取自 **官方 shadcn registry**（CLI 4.21.0），随后按本工程 tokens 调整了颜色、圆角与高度等类名。
- 该次执行时 `components.json` 的 `@/...` 别名在 TS7 无 `baseUrl` 环境下被错误解析，官方 CLI 把文件写到了绝对路径 `frontend/@/shared/ui/button.tsx`，而不是 `src/shared/ui/button.tsx`。该误建目录已由温晓清理，工程内不再存在。

### 已验证的兼容边界

`components.json` 的 aliases 已改为可验证的项目相对真实路径：

```json
{
    "aliases": {
        "components": "src/shared/ui",
        "utils": "src/shared/lib/cn",
        "ui": "src/shared/ui",
        "lib": "src/shared/lib",
        "hooks": "src/shared/lib/hooks"
    }
}
```

`pnpm dlx shadcn@4.21.0 add button --dry-run --yes` 现在能解析到 `src/shared/ui/button.tsx`，**路径问题已修复**。但 **CLI 的完整可用性仍未解决**：dry-run 依然同时报告

```
+ cn
+ radix-ui
```

其中 `cn` 是 registry 组件内部 `import { cn } from "cn"` 触发的依赖解析，会把一个无用的 npm 包 `cn` 写进依赖并生成 `import { cn } from "cn"`。本工程不使用该包，`cn` 一律指向 `@/shared/lib/cn`。因此：

**推荐流程（不直接用 `shadcn add` 覆盖定制组件）：**

1. 从官方 registry 取得目标组件内容（例如 `shadcn view <component>` 或 registry JSON）。
2. 按本工程规范落盘到 `src/shared/ui/<component>.tsx`：
    - 工具函数固定 `import { cn } from '@/shared/lib/cn'`，**不使用** `'cn'` 包；
    - 颜色/圆角/高度改用 `src/styles/tokens.css` 的 `--ui-*` token；
    - 需要的 Radix 依赖走 `radix-ui`，具体版本显式固定。
3. 落盘后**核对 diff**（`git diff src/shared/ui/`）并运行 `pnpm typecheck` 与 `pnpm test:unit`。
4. 不运行裸 `shadcn add ... --overwrite`，避免覆盖已经按 tokens 定制的组件。

`cn` 包不得进入 `package.json` / `pnpm-lock.yaml`。

## 供应链约束

`pnpm` 的最短发布冷却（`minimumReleaseAge`）保持开启。当前无豁免条目；依赖均选用已过冷却期的稳定版本（例：`zod` 使用 4.5.4，而非更新的 4.6.x）。
