# 详情布局与贡献位置

日期：2026-09-21

详情内容块之间统一为 11pt，左右留白也为 11pt。标题与编辑图标在同一行居中对齐；编辑图标右缘和图片右缘一致，同时保留 44pt 点击区域。菜单使用实际内容高度加上拖动把手区域，包含底部安全区；大字体超过屏幕时继续使用滚动。拖动期间忽略临时变窄的测量，回到静止状态重新测量。

新贡献使用 Core Location 返回的当前位置创建草稿。顶部原生 Form 行提供“在地图上选择其他位置”，进入已有地图点选界面。取消保留原坐标和已填字段，确认后才更新坐标。已有草稿保留自己的位置；编辑已发布点位不提供移动入口。

定位请求与主地图独立。关闭表单、手动选点或切换账号后，迟到结果不能新建或覆盖草稿；定位失败或权限被拒绝时进入显式点选，不以地图中心冒充当前位置。

## 验证方式

使用 `scripts/place-metadata-fixture.py` 的合成账号和点位，只连接本机内存 fixture。普通运行及 GPS 预设见 [标签测试说明](place-metadata.md#复现验证)。

拒绝定位用例需要单独运行，先记录模拟器原有权限状态，运行结束恢复它。以下命令适用于本次原本已授权的测试模拟器：

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl privacy booted revoke location com.lycoris.maps
xcodebuild -project apps/ios/Lycoris.xcodeproj -scheme Lycoris -configuration Test \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- SWIFT_EMIT_LOC_STRINGS=NO \
  -parallel-testing-enabled NO \
  -only-testing:LycorisUITests/PlaceMetadataUITests/testDeniedLocationFallsBackToExplicitMapSelection test
xcrun simctl privacy booted grant location com.lycoris.maps
```

`ContributionFlowTests` 的旧入口假设同步改为 GPS 草稿或定位失败后的手动选点。本次仅编译该完整照片上传用例，未运行它所需的另一套 Rust 合成后端。

## 验证结果

- `final.log`：ContributionTests、PanelLayoutTests 共 23 项单元测试通过；GPS 草稿、换位置取消／确认保留字段、图片详情与完整按钮显示的 2 项界面测试通过。
- `visual-forms.log`：原生六类场所 Picker、新建和编辑提案实际 PATCH 的 2 项界面测试通过。
- `denied-location.log`：已拒绝定位权限时，成功从空点选状态确认位置并进入中文贡献表单，1 项界面测试通过。
- `typography.log`：英文标准字体和中文最大辅助功能字体的详情、标签及各操作按钮检查通过。早期运行的搜索焦点及中文面板状态断言失败，修正测试的展开／键盘等待和本地化断言后，此项最终单独通过。
- 已检查模拟器截图，确认图标、图片右缘、间距、完整按钮和中文原生选点入口。Debug 真机签名构建通过；本次 CoreDevice 未找到已连接的 iPhone，因此未完成真机安装。

日志、xcresult 和截图位于任务工作目录 `work/ios-detail-polish/artifacts/`。
