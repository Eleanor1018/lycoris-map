# Lycoris Web v2（`frontend/`）

Web v2 新工程，当前已完成 **S4 账号与收藏**：登录/注册/退出、资料、头像、改密、收藏、本人点位已接通 Rust 接口。温晓亲自编码，结合 Figma MCP 与 Computer Use 核对。当前仅供本机开发与验收，贡献提交和完整设置留在 S5–S6。

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
  features/auth/       账号窗口、Cookie 会话、跨标签页同步
  features/bookmarks/  收藏查询与按点位独立的乐观更新
  features/profile/    资料、头像、改密、本人点位
  features/places/     搜索/附近/详情和公开数据读取
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
| `/__dev/qa`                         | 固定手机视口；账号验证转到产品页面                                                                              |

这些开发页面由 `import.meta.env.DEV` 隔离并按需加载；生产构建不包含其组件、样本地图/照片或诊断词条。画稿样本与正常入口共用 `MapShell`、`DesktopPanel`、`MobileSheet`，不是整页截图。

Figma 基准：[Lycoris v2](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=9-397)。桌面基准为 1440×1024，手机为 375×812，手机系统栏与设备边框不复制为网页。已额外检查 390/430/768/1024 宽度与短视口滚动。手机手柄支持拖动、点击及方向键/Home/End；详情关闭、输入法 Escape 和焦点返回有相应处理。

桌面和平板采用侧边栏布局（宽度 ≥768px），手机采用底部面板（≤767px）。搜索框由圆角外框整体显示焦点；手机空 Bookmarks 与 Settings 之间保留 13px，有收藏时保持原稿卡片排布。

桌面/平板的关闭按钮与 Escape 直接收起第二栏，保留主导航和地图；即使从 Settings 打开 Languages、从 Bookmarks 打开详情，也不返回上一面板。浏览器返回仍按历史记录导航，手机保留原有返回来源的关闭行为。贡献表单的桌面输入聚焦时直接改变原有圆角边框颜色，不在外围另留间隙。

贡献入口对应 [桌面表单 72:2369](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=72-2369) 与 [手机表单 74:4744](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=74-4744)：桌面/平板先显示气泡，点击地图后打开表单；拖动地图不会触发表单，键盘可在地图上按 Enter 选择中心。手机点击笔按钮直接打开。关闭表单退出本次贡献流程，切换屏宽保留草稿与已选坐标。

当前表单支持本次页面会话内的标题、类别、描述、时间及本地照片选择；重新打开仍保留草稿，刷新后清空。手机直接进入时尚未选择坐标，不假定为用户当前位置。Submit 保持 `aria-disabled`，不发送创建或上传请求；认证、手机坐标确认、校验和真实提交属于 S5。

布局、色值、图标按原稿实现；**尚不能宣称所有文字像素一致**：Figma 的 SF Pro 与本机 SF 系统字体存在字宽差异。Fredoka、Roboto、Noto Sans 的所用 Latin 字重自托管，SF 使用本机系统字体，不把下载的 SF 字体打包分发。中英文完整业务切换留在 S6。

S3 搜索/附近结果和加载、空结果、失败状态经 Nora 同意，复用原稿点位行、卡片与颜色，在原区域显示简短文字，不新增弹窗或 toast。未接业务的按钮保留原稿外观并标记 `aria-disabled`；语言选择当前仅保存页面内选择，不冒充已持久化设置。未接入的账号、收藏、贡献提交和设置功能不计入 S3 验收。

## S3 数据与交互

- 公共 viewport、nearby、search 及匿名 detail 明确 `credentials: omit`；登录后的 detail 切到独立私有 scope，避免 OptionalUser 数据进入公开缓存；23 字段 DTO 在边界校验，坐标越界及不安全整数显示受控失败。
- viewport 250ms 防抖，经度 wrap、越日期线拆请求并按 ID 合并。默认全部类别不传过滤，以兼容后端读取时归一的历史类别。Supercluster 仅减少屏上图钉，不截断服务端结果。
- 搜索 300ms 防抖、取消过时请求，查询键包含语言和实际过滤值；不因 version 相同忽略新标题、坐标或可用性数据。超过 100 条的结果使用虚拟列表，支持方向键、Home/End，以及手机详情返回的滚动/焦点恢复。
- 主动点击 Locate me 才请求浏览器定位。附近类别使用已取得的位置或地图中心，标明 1km 的参考点；重新定位同步更新查询中心。距离仅在有实际定位时显示直线距离，不把地图中心当作用户所在位置。
- 详情按实际内容排版：无图片不填假图，图片失败收起；无开放时间明确显示未提供，不从 isActive 猜测全天开放。404 会撤掉旧选中点和缓存行，之后新的公开读取可恢复重新公开的点位。
- Share 优先系统分享，支持时回退复制 ID＋语言链接；Navigate 使用 Google Maps 步行导航，仅在用户点击时传所选目的地，不传用户起点。
- 保留 `/maps?markerId=…&lang=…`、`/maps?lat=…&lng=…&title=…`、`/search?q=…`。ID 优先，关闭详情不会激活原先被忽略的坐标；手机搜索直达展开结果，切至平板保留正在浏览的结果栏。
- 历史数据库坐标基准仍未通过外部控制点核验。本机真实 Rust 联通使用隔离的合成样本，不能据此宣称历史坐标准确或已上线。

### `/__dev/places-performance`

仅开发模式可用。固定 1,000/10,000 合成 DTO 由 Vite 本机 HTTP middleware 提供，复用产品地图、查询控制器和结果/详情组件。每个规模先预热，再点击加载三次，随后缩放、平移、选点、关闭面板，点击 Record snapshot。页面记录响应体字节、HTTP 完成、JSON 解析、校验、聚合索引/查询、更新到两帧、可用 JS heap、帧间隔与长任务。

原稿内容对照可打开 `/__dev/places-performance?panel=details&markerId=1&design=desktop`（或 `mobile` / `long`）。只在该开发入口使用原稿照片与合成内容，正常应用入口不读取这些样本。

这不是 Rust 大数据量基准或 GPU 绘制完成时间；内存包含仪器开销，重复数据可能被 Query 结构共享。实测 10,000 条约 5.36MB 原始 JSON，11 级下聚合为 163 个屏上标记，1440px 视口结果列表只渲染 19 行且最后一条可由 End 到达。聚合不解决移动网络响应体，后续应评估轻量 viewport DTO / 服务端分层读取，不做静默截断。

## S4 账号与收藏

- 设计基准：桌面登录 `126:382`、注册 `126:513`，手机登录 `126:805`、注册 `126:1008`。桌面窗口居中，375×758，短屏内部滚动；手机从顶部 46px 展开到底部安全区，延续 Nora 指定的两端 11px。输入框 44px、半径 22px，原始 Apple/Google/登录/关闭图标附来源与 SHA256。
- 桌面关闭和 Escape 只关闭账号窗口；不会关闭其后的地图面板。地图不按登录状态重新挂载。手机账号窗口展开时隐藏原底部菜单，避免透出重复搜索框；关闭后恢复菜单与焦点。
- 注册使用现有 `{username,email,password}` 契约，成功后从 `/api/me` 确认 Cookie。**验证码按 Nora 确认保留禁用占位，不发码或验码。** Apple/Google 保留设计按钮，点击提示暂未接入，不跳转或伪造成功。后端尚无这三类接口。
- 资料、头像、改密、本人点位尚无独立画稿，复用现有窗口、输入框、设置行和点位卡片。昵称/代词/签名按后端 Unicode 长度边界校验；头像检查格式与 5MiB 大小，服务端继续校验像素/实际内容。改密后重新确认会话，要求重新登录时不会误报仍已登录。
- SessionStore 是产品 Cookie 会话唯一写入器。Web Locks 可用时按同源标签页串行调度 Cookie 请求；无 Web Locks 时退化为当前页面队列。BroadcastChannel 与 storage 仅广播变更信号，身份由 `/api/me` 核实；focus/pageshow 也会复查。旧浏览器不具备 Web Locks 时不承诺同等的跨标签页请求互斥。
- 私有读取/修改以 `publicId + authEpoch` 归属，发送前核对当前 Cookie 所属账号。退出、切账号、过期会话取消请求、清空原 scope 缓存和头像 object URL，撤掉私有详情/地图标记；403/503 不被当作退出成功。身份相关 HTTP 读取明确 `no-store`。
- 收藏按点位独立更新/回滚，失败立即恢复按钮并保留重试入口；同点位重复点击去重，其他点位的成功不被覆盖。内容 DTO 带语言，切语言不让旧乐观标题覆盖目标语言结果。匿名用户登录成功后仅恢复本次仍有效的收藏操作，取消登录会清除待办。
- 本人点位包含私有/待审数据，仅进入账号查询和详情 scope，公共 viewport/search/nearby 不混入这些 DTO。账号窗口按打开轮次防止旧提交结果覆盖后来打开的界面。
- 开发地址 `http://127.0.0.1:5173` 已在本机合成后端写入 Origin 白名单中。若使用 `pnpm preview` 的默认 4173 端口，需由相应本机后端显式允许该 Origin 才能测试写操作；不能通过改写 Origin 绕过检查。S4 未变更服务器配置或部署。

## S1 开发诊断保留范围

### `/__dev/map-spike`

- 默认 OSM 底图 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`，保留 OpenStreetMap 署名，不做预取或离线下载，不引入第二套地图引擎、Mapbox 密钥或聚合库。
- 200 个点位是**合成样本**（`src/features/map/syntheticMarkers.ts`），id/version 固定、标题有 zh/en，不代表真实设施，也不是历史数据；用 `CircleMarker` 示意，**不是最终 Figma 图标**。
- 地图模块不按 `language`/面板/筛选/登录状态设 `key`：语言与点位变化只更新 props。地图实例标识用 `WeakMap<LeafletMap, string>` + `L.stamp` 记录，重放 effect 不会伪造新实例。
- 页面展示点数、实例标识、center/zoom，以及一次字段更新到下一动画帧的耗时。该耗时是本机合成样本的**观测值，不是 GPU 或完整地图渲染的性能结论**。

### `/__dev/qa`

- 只提供 **375×812** 一个固定 iframe 尺寸，避免对桌面窗口产生大幅横向溢出。iframe 用真实 CSS 视口尺寸，仅做响应式检查，**不是 iPhone 设备模拟，也不缩放截图冒充手机视口**。
- S4 已移除旧诊断页独立的 Cookie 写入器。账号操作统一从产品地图的账号窗口进入，使用同一 SessionStore；此页只显示会话状态和返回地图的链接。原诊断竞态回归已迁移到产品会话与账号流程测试。

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
