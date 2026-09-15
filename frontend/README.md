# Lycoris Web v2（`frontend/`）

Web v2 新工程，当前已实现 **S2 设计外壳**：对应 Figma 的 8 个桌面状态、5 个手机状态、常驻 OSM 地图与面板导航。S2 由温晓亲自编码，使用 Figma MCP 原始资产和 Computer Use 逐屏核对。真实地点、搜索、账号及贡献提交等业务接入属于后续阶段；当前仅供本机开发与验收。

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
  app/                 启动、Providers、错误边界、React Router、DEV 按需入口
  layouts/             桌面导航/面板、手机三态/详情、面板历史与焦点恢复
  features/map/        产品 MapSurface、S1 地图验证与后端状态屏
  features/dev/        仅开发环境的 Figma 样本与 S1 浏览器诊断页
  assets/figma/        原始导出图标、DEV 样本、来源节点及 SHA256
  shared/api/          transport、ApiError、各接口 DTO/schema、session
  shared/query/        查询键约定（public / private）
  shared/i18n/         LanguageProvider 与 zh/en 词条
  shared/auth/         authEpoch 纯模块
  shared/lib/          cn 等纯工具
  shared/ui/           定制的 shadcn 原语
  styles/              tokens.css、fonts.css、global.css
```

## 页面与设计验收

正常入口 `/`（兼容 `/maps`）使用真实 OSM 瓦片，不放入 Figma 的样本账号、距离、地点、照片或模拟点。面板使用 `?panel=search|bookmarks|languages|settings|contribute|contribute-form|details`；手机吸附高度使用 `?snap=collapsed|half|full`。关闭面板和浏览器返回/前进保留已有 query、hash 和搜索草稿，切换屏宽不重新创建地图。

| 仅开发环境的路径                    | 用途                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/__design/desktop?screen=initial`  | 桌面原稿比对，可选 initial / search / bookmarks / languages / settings / contribute / contribute-form / details |
| `/__design/mobile?screen=collapsed` | 手机原稿比对，可选 collapsed / half / full / contribute-form / details                                          |
| `/__dev/status`                     | 后端 `/health/live`、`/health/ready` 连通状态                                                                   |
| `/__dev/map-spike`                  | S1 的 200 个固定合成点位及地图生命周期诊断                                                                      |
| `/__dev/qa`                         | S1 本机 Cookie 会话、头像与固定手机视口验证                                                                     |

这些开发页面由 `import.meta.env.DEV` 隔离并按需加载；生产构建不包含其组件、样本地图/照片或诊断词条。画稿样本与正常入口共用 `MapShell`、`DesktopPanel`、`MobileSheet`，不是整页截图。

Figma 基准：[Lycoris v2](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=9-397)。桌面基准为 1440×1024，手机为 375×812，手机系统栏与设备边框不复制为网页。已额外检查 390/430/768/1024 宽度与短视口滚动。手机手柄支持拖动、点击及方向键/Home/End；详情关闭、输入法 Escape 和焦点返回有相应处理。

桌面和平板采用侧边栏布局（宽度 ≥768px），手机采用底部面板（≤767px）。搜索框由圆角外框整体显示焦点；手机空 Bookmarks 与 Settings 之间保留 13px，有收藏时保持原稿卡片排布。

贡献入口对应 [桌面表单 72:2369](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=72-2369) 与 [手机表单 74:4744](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=74-4744)：桌面/平板先显示气泡，点击地图后打开表单；拖动地图不会触发表单，键盘可在地图上按 Enter 选择中心。手机点击笔按钮直接打开。关闭表单退出本次贡献流程，切换屏宽保留草稿与已选坐标。

当前表单支持本次页面会话内的标题、类别、描述、时间及本地照片选择；重新打开仍保留草稿，刷新后清空。手机直接进入时尚未选择坐标，不假定为用户当前位置。Submit 保持 `aria-disabled`，不发送创建或上传请求；认证、手机坐标确认、校验和真实提交属于 S5。

布局、色值、图标按原稿实现；**尚不能宣称所有文字像素一致**：Figma 的 SF Pro 与本机 SF 系统字体存在字宽差异。Fredoka、Roboto、Noto Sans 的所用 Latin 字重自托管，SF 使用本机系统字体，不把下载的 SF 字体打包分发。中英文完整业务切换留在 S6。

原稿尚未定义的流程不新增弹窗、toast 或可见说明。未接业务的按钮保留原稿外观并标记 `aria-disabled`；语言选择当前仅保存页面内选择，不冒充已持久化设置。S2 可验收页面结构和已有面板交互，不能据此验收 S3–S6 的业务功能。

## S1 开发诊断保留范围

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
