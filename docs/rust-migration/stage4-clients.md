# 阶段 4 客户端独立验收记录

温晓直接操作既有客户端，使用本地合成演练入口 http://127.0.0.1:18180。用户原 5197 预览保持。
Web 隔离预览 5198，实际 Vite 7.3.1；浏览器为独立 Playwright 会话 lycoris-stage4。
内置浏览器工具两次初始化因缺失 kernel assets 失败，改用已安装 Playwright 技能的 CLI。

## Java 基线与回退环境（已执行）

- 合成普通用户真实登录，POST /api/login 200、GET /api/me 200，页面显示个人中心。
- 切换 Java 会话代次之后，浏览器旧登录显示“登录已失效，请重新登录”，公开发现仍可用。
- 发现页显示附近点位、搜索框、类别下拉。初始合成数据错误采用 elevator/ramp 等类别，导致真实四类筛选空缺；已让苏瑶修正为四类均衡数据，重新执行升级/回退演练。
- 修正后医疗类别筛选显示 91 张附近卡片，前几个距离为 562m、567m、807m、1.0km、1.0km、1.1km。
- 搜索 Synthetic Marker 369 缩至一张医疗卡片；真实 /uploads/markers/synth-marker-369.png 加载成功，naturalWidth=192。
- 点标题跳转 /maps?markerId=369&lang=zh；地图弹窗显示点位名、医疗类别、全天可用、图片、说明、收藏操作与坐标31.229483,121.483841。
- 导航链接为 Google Maps walking，destination=31.229483338203185,121.48384121204207；仅核对链接，未发起用户实际导航。
- 观察证据见 .playwright-cli/page-2026-09-14T06-15-28-154Z.yml、page-2026-09-14T06-18-10-125Z.yml、page-2026-09-14T06-21-19-256Z.yml 与 work/web-stage4-java-requests.txt。

## Android（构建/测试已执行）

- 原 mobile 源码 Android debug APK 构建成功，350 tasks（107执行/243缓存），API固定演练10.0.2.2:18180，Metro18088，未改产品源码。
- 隔离临时 emulator-5580 / medium_phone / Android36 / x86_64，安装 com.mobile 并启动、加载真实应用，打开 Discover，定位31.23,121.47。操作时恰逢后端切换，附近列表曾失败，尚不计作完整设备流程通过。
- 原有 Jest 全套首次负载重时 1 项5000ms超时；单独重跑发现页7/7通过。停止本任务模拟器及Metro后再次跑完整套件：19 suites、123 tests 全部通过（28.965s），报告 work/android-stage4-jest-full.json。

## Rust Web 独立验收（已执行）

- 入口为Rust(PG18) g6，镜像sha256:51776d6b0f3a9bd93d4a5f0a35595fc1df0a3285a2a4dbb38118eb1e8fa0875a。真实登录rehearsal_user_2成功，页面显示个人中心；匿名初始化的/api/me 401属于预期。
- 发现页正常显示附近点位、搜索、类别下拉；友好医疗机构筛选后搜索Synthetic Marker 369仅余1张，图片真实加载naturalWidth192。标题点击跳转/maps?markerId=369&lang=zh，地图弹窗和OSM图层实际显示，导航目标31.229483338203185,121.48384121204207。
- 地图收藏由“收藏点位”变为“取消收藏点位”；离开地图再重新载入仍为已收藏。个人中心显示账号、创建点位和收藏列表。
- 编辑个性签名为“Rust stage 4 Web review”，保存成功且整页刷新后仍保持。该值为合成用户测试数据，供Android核对跨客户端一致性。
- 截图.playwright-cli/page-2026-09-14T07-05-21-173Z.png经温晓查看；登录/发现/地图/个人中心快照分别为06-57-10-735Z、06-59-40-383Z、07-01-10-270Z、07-04-15-672Z。work/web-stage4-rust-requests.txt记录最后页面的真实200请求，导航仅核对目标链接。

## Rust Android 设备验收（已执行）

- 重新启动同一只读临时AVD，安装原debug APK。Metro18088经adb reverse连接；首次默认10.0.2.2连接未载入，开发菜单改为127.0.0.1:18088后重启本测试App成功，未改源码。启动时System UI曾显示未响应，选择Wait后完成启动。
- 只授权本次定位，模拟位置31.23,121.47；真实发现列表361点，友好医疗机构+有图筛选2点，再搜索Synthetic Marker 369为1点。图片实际显示，距离1.3km，截图work/android-stage4-rust-discover.png已查看；XML证据work/android-stage4-rust-nearby.xml与work/android-stage4-rust-filter-search.xml。
- 使用合成用户 rehearsal_user_2 真实登录成功，个人中心显示 Rehearsal User 2 和 Web 刚保存的签名“Rust stage 4 Web review”；跨客户端资料一致，证据 work/android-stage4-rust-profile.xml。
- 打开 My Favorites，分页查看 33 条收藏，最后一页包含 Web 刚收藏的 Synthetic Marker 369；证据 work/android-stage4-rust-favorites.xml。点击该收藏跳转 Map，显示对应点位。
- 温晓查看 work/android-stage4-rust-map.png：弹窗显示 Synthetic Marker 369、Friendly Clinic、全天开放、图片、说明、坐标31.229483,121.483841，以及 Directions、Share、Edit 和 Saved 星标。地图上的点位覆盖层正常显示。
- Android 使用占位测试地图配置，第三方底图瓦片未显示，不能据此声称底图验收通过；Web 实际 OSM 图层已显示。未发起真实外部导航。设备验收覆盖后端关联的登录、资料、筛选、搜索、图片、跨端收藏及点位跳转。

Java↔Rust↔Java完整切换与新写入回退证据由演练工具另记。第三方地图使用测试配置，不以地图图层加载衡量后端性能。
