# iPad 原生适配验收

日期：2026-09-21 至 2026-09-22。分支：`feat/ios-ipad`。版本：0.1.0（2）。

后续完整矩阵重跑与交互测试修复见 [iPad 自动化交互故障排查](ipad-test-stability.md)；下文保留首次适配验收记录。

## 实现范围

- 同一 SwiftUI / MapKit 应用覆盖 iPhone 与 iPad；iPhone 竖屏，iPad 四方向。
- 按实际窗口宽高选择侧栏或底部菜单。宽屏导航、内容栏和地图并列；内容栏可独立关闭。
- 搜索、附近、详情、收藏复用现有业务与组件；匿名用户隐藏收藏。
- 设置在原生导航表单内选择具体选项；账号和贡献保留原生弹窗。
- 保留根地图与各业务 store，切换布局不重建定位或地图状态。四边遮挡参与 MapKit 聚焦，键盘采用窗口坐标计算并排除浮动键盘。
- 侧栏提供语义标签、选中状态、44pt 最小点击区域、Command-F 和 Escape。地图选点时禁用隐藏侧栏及其快捷键。
- 应用只支持一个可缩放的 scene；草稿与照片仍由单一业务实例管理，避免独立窗口互相覆盖共享文件。没有要求全屏运行。

## 验证环境与数据

Xcode 26.6，iOS / iPadOS 26.5 模拟器。UI 请求使用 `Test` 配置和 `scripts/place-metadata-fixture.py` 的回环 HTTP 服务，账号、点位、收藏与草稿均为本机测试数据。Debug / Release 的生产 API 配置不受 fixture 影响。

## 自动化结果

- 23 项单元测试通过：`AdaptiveMapLayoutTests`、`MapKeyboardTests`、`MapViewportTests`、`LocationFocusTests`、`PanelLayoutTests`。覆盖布局阈值、窗口缩放、键盘交叠、地图镜头稳定、定位跟随和底部菜单边界。
- iPad mini：`IPadCompactWindowTests` 通过。真实 744pt 竖屏 / 1133pt 横屏往返时，搜索文字、结果和已选详情保留；底部面板与侧栏正确互换，详情操作可达。
- iPad Pro 11 英寸：搜索关闭再打开、搜索旋转保留、原生设置导航、登录后收藏列表及收藏详情、编辑登录承接、草稿旋转与关闭重开均已通过 UI 测试。
- iPhone 17：`MapInteractionTests` 四项通过，覆盖底部面板拖动、键盘与搜索、详情打开关闭、匿名收藏门控、最大辅助字号下的操作可达性。
- iPad Pro 13 英寸：附近类别筛选、详情旋转保留、竖屏原生分享弹窗、关闭内容栏保持导航与地图通过；最大辅助字号下的侧栏和设置流程通过。
- Release 真机架构构建通过；产物 Bundle ID 为 `com.lycoris.maps`，设备族 `[1, 2]`，iPad 四方向、iPhone 竖屏，API 为 `https://api.lycoris-map.com`，出口合规键为 `false`，版本为 0.1.0（2）。此构建没有签名或上传。

## 检查中发现并修复的问题

侧栏和搜索结果的父级标识原本会覆盖部分子控件的无障碍标识；改为明确的子元素容器，保留账号按钮与结果标题的独立语义。最大辅助字号下，侧栏图标与文字改为上下排列，并让图标占据自己的实际布局宽高。地图选点模式禁用隐藏侧栏快捷键；异步搜索聚焦确认仍处于可搜索状态后才执行。

## 验证记录

本机测试报告：`/tmp/lycoris-ipad-unit.xcresult`、`/tmp/lycoris-ipad-mini.xcresult`、`/tmp/lycoris-ipad-ui-v2.xcresult`、`/tmp/lycoris-ipad-ui-v3.xcresult`、`/tmp/lycoris-ipad-iphone.xcresult`。v2 / v3 包含已通过用例和排查过程中的失败用例，不能将整个报告称为全绿。

13 英寸最终流程报告为 `/tmp/lycoris-ipad-13-v2.xcresult`。首次启动曾遇到模拟器 Accessibility 服务初始化超时，重跑后两个用例均通过。11 英寸反向横屏后的分享点击曾未响应，现有记录不能确认是应用问题还是模拟器事件问题；已验证 13 英寸竖屏的系统分享正常，这一特定横屏操作仍保留为手动复核项。

大字号布局修正后的 `/tmp/lycoris-ipad-a11y-final.xcresult` 通过；关闭自动 scene manifest 生成后，Release / Test 产物均确认 `UIApplicationSupportsMultipleScenes=false`，且 `/tmp/lycoris-ipad-single-scene.xcresult` 的附近、旋转、分享和侧栏关闭流程再次通过。总计覆盖 23 项单元测试、6 项 iPad UI 用例和 4 项 iPhone UI 用例。

截图位于 `/Users/nora/Documents/Codex/2026-09-14/wen/outputs/ios-ipad/`。XCTest 横屏截图存在方向元数据与裁切异常，不能将其作为应用出现黑边的证据，也不适合作为商店截图。

## 复现

先在独立终端运行 `python3 apps/ios/scripts/place-metadata-fixture.py`，然后使用 Test 配置运行 `IPadLayoutTests`。宽窄布局切换使用 iPad mini 上的 `IPadCompactWindowTests`；iPhone 回归使用 `MapInteractionTests`。

构建与测试命令均需 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`。Test 的地址为回环地址，不能将它作为真机或 TestFlight 配置。

## 真机边界

模拟器能够验证布局、读写流程和状态切换，但不能证明 iPad 真机上的指南针、设备端语音识别、实际定位精度、硬件键盘和连续窗口拖动体验。发布前仍应在实际 iPad 上进行这些设备能力检查。

本轮后段 Computer Use 报告 Mac 锁定，已向用户请求解锁。自动化和本地构建继续完成；连续窗口缩放、VoiceOver 手动遍历、照片选择及两个横屏方向的分享，尚未完成手动复核。

本轮不上传 TestFlight，不修改生产数据，不部署服务器。
