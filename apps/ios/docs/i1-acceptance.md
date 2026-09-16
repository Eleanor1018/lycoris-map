# I1 — 工程与原生交互验证

2026-09-16，分支 `feat/ios-native`，起点 `88fbb4a`。I1 已完成；本阶段是可运行的交互原型，完整页面视觉收尾属于 I2，真实业务从 I3 开始。

## 已交付

- Xcode 工程、共享 Lycoris Scheme、Debug/Release 配置；Swift 6 语言模式和完整并发检查，最低 iOS 26，首轮 iPhone 竖屏。
- 持续存在的 Apple Maps 原生地图；收起、Nearby、全展开三个面板档位；手柄拖动和点击、雷达展开、右侧工具随面板移动。
- 搜索聚焦展开、键盘避让、内容滚动、收起后保留输入；拖动手势限定在手柄，避免抢占输入框编辑手势。
- Figma 原始图标、系统 SF 字体、原生材质、颜色资产与中英文 String Catalog；匿名状态不显示 Bookmarks，也不预留空白。
- Debug 默认本机地址和真机配置方式；Release 地址待提供，配置验证拒绝非 HTTPS 正式地址。I1 尚不请求 Rust API。
- [画稿对应与缺稿清单](design-mapping.md)、[素材来源](figma-assets.md)、[运行说明](../README.md)。

## 容器决定

先验证系统 sheet。iOS 26.5 的最大档位不能保持画稿两侧 10pt 留白，因此只定制面板容器，内部使用 SwiftUI 原生输入、滚动与材质。收起态侧边距 25pt，打开后 10pt，圆角 26pt；真实安全区优先于画稿里的静态状态栏。

地图使用小范围 MKMapView 桥接，通过公开 layoutMargins 把署名放在面板最低停靠位置上方。署名保持不动，展开面板暂时盖住它，符合 [Apple Maps 设计指引](https://developer.apple.com/design/human-interface-guidelines/maps/)。屏幕或字体尺寸改变边距时，保持屏幕中心地理位置、距离与方向；不访问 MapKit 私有视图层级。

## 实际验证

环境：Xcode 26.6（17F113）、Swift 6.3.3、iOS 26.5 Simulator。命令使用单次 DEVELOPER_DIR 选择 Xcode，没有修改 Mac 全局开发目录。

| 检查 | 结果 |
| --- | --- |
| Debug 与 Release 模拟器构建 | 通过；Release 未带开发地址或 Debug ATS 例外 |
| Swift Testing | 11 个测试、3 个 suite 通过；含多尺寸面板、投影落点、同高档位、配置边界和 3 个地图旋转角度 |
| iPhone 17 UI 自动化 | 通过：雷达 → 地图拖动 → 手柄展开 → 输入 → 键盘上方滚动 → 收起保留输入 |
| iPhone 17 Pro Max UI 自动化 | 同一流程通过；最终署名调整后再用 Computer Use 检查三档布局 |
| Figma MCP + Computer Use | 已核对 iOS 页面及外置同级组件，实际操作模拟器，检查侧边距、工具联动、键盘和地图稳定性 |
| swift-format、工程/配置 plist | 通过 |

界面自动化捕获并修复了拖动结束时点击手柄也触发、面板错误收起的问题。键盘验证明确检查屏幕键盘存在，以及滚动后的末行处于键盘上方。

本机证据目录：`/Users/nora/Documents/Codex/2026-09-14/wen/outputs/ios-i1/`。最终 iPhone 17 六张流程截图位于 `ui-test-final/`；大屏最终截图为 `promax-nearby-final.png` 和 `promax-expanded-final.png`。构建与测试日志位于 `/tmp/lycoris-ios-i1-*.log`；重新运行命令见 README。

## 后续范围

I2 完成四个画板的逐状态视觉还原与点位详情。当前分类、设置、头像、地图源、定位和笔图标是原型展示，麦克风行为仍待定义；没有把这些标为已接通的功能。真实点位、定位授权、登录、收藏、贡献及上传按 I3–I6 实现。没有进行真机签名、发布、服务器部署或 main 合并。
