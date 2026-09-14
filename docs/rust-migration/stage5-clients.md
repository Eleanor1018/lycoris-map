# 阶段 5：现有 Web / Android 查询复查

2026-09-14，温晓直接操作现有客户端。入口为本地合成 `http://127.0.0.1:18180`，
唯一后端为 Rust stage5 g23 / PG18 up / cache on，镜像 `sha256:d074e39c…`。
本轮没有修改客户端源码，沿用阶段 4 的 APK 与构建/测试结果；这里记录空间迁移后的最小实际回归。

## Web

- 独立 Vite 5198、Playwright 会话 `lycoris-stage5`，用户的 5197 预览未改。
- 将测试位置设为 `31.23,121.47` 后，发现页显示附近点位，保持标题、搜索框和类别下拉。
- 选择友好医疗机构，再搜索 `Synthetic Marker 369`，仅有一张卡片，距离 1.3 km。
  图片实际加载，`naturalWidth=192`，资源 `/uploads/markers/synth-marker-369.png`。
- 点击标题进入 `/maps?markerId=369&lang=zh`，地图弹窗显示相同点位、类别、图片和说明；
  OSM 底图实际显示。导航链接精确为 Google Maps walking，目标
  `31.229483338203185,121.48384121204207`，只核对链接，没有发起外部导航。
- 浏览器中的 `/api/me` 401 为匿名初始化的预期结果；实际点位/资源请求成功。原始网络记录还保留
  页面重载、地图视角变化时被取消的 `ERR_ABORTED` 请求，后续目标查询成功，不宣称所有请求零取消。

## Android

- 原 debug APK，临时只读 `medium_phone` / Android 36 / emulator-5580，Metro 18088。
  默认模拟器地址未连接 Metro，开发菜单改为 `127.0.0.1:18088` 并使用 adb reverse 后加载成功。
  模拟器启动时 System UI 短暂未响应，选择 Wait 后恢复；这些准备过程未计作业务通过。
- 允许本次定位，模拟坐标 `31.23,121.47`；发现页实际显示 364 个附近点位。
- Friendly clinic + With photos 筛选得到 2 点；搜索 `Synthetic Marker 369` 后剩 1 点，
  图片实际显示，距离 1.3 km。点击标题跳到地图并显示对应弹窗、图片、类别、说明与坐标。
- 地图覆盖层中也能看到本轮 Java 新增的 `Stage5 Java edited 1789391735`。
  Android 测试配置的第三方底图仍为空，此项未标记通过；与阶段 4 相同，后端点位及图片正常。
- 本轮为匿名查询回归；登录、资料、跨端收藏已在阶段 4 实测，阶段 5 后的身份/收藏保留由
  [Java/Rust 切换演练](stage5-java-compatibility.md)再次通过真实 HTTP 验证。

## 证据与清理

温晓已查看 Web 发现/地图与 Android 发现/地图四张截图，均与上述观察一致。
截图、Android XML、Web 请求清单和弹窗快照保存在本地任务
`outputs/rust-migration-verification/stage5/`，由 `accepted-evidence-manifest.json` 逐文件记录 SHA-256。
本次 Playwright 会话、临时模拟器、Vite 5198 与 Metro 18088 已关闭，保留合成演练后端 g23。
