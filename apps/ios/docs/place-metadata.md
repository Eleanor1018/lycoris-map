# iOS 场所标签与营业状态

日期：2026-09-21

## 行为与数据契约

- 无障碍卫生间在点位列表、详情中显示场所标签：地铁站、医院、商场、火车站、学校、其他。使用原生 SwiftUI Label、SF Symbols 和动态字体；其他点位类别不显示该标签。
- 对齐 Axum `venueType` 的六个值：`metro`、`hospital`、`mall`、`railway_station`、`school`、`other`。缺失、null 或未知值不伪装成“其他”，也不使整个点位解码失败。
- 新建／编辑表单使用原生 Picker。新建卫生间默认“其他”；离开卫生间类别时清除标签，重新切回才恢复默认。旧草稿或未知标签仅修改文字时，不提交一个猜测的标签。
- 营业时间以轻色背景突出，状态同时使用文字与图标。距结束营业不超过 30 分钟且仍在营业时显示“即将结束营业”。详情使用独立提醒标签。
- 时间判断使用服务端 `hoursTimezone`，不使用用户设备时区推断远处点位状态。当前服务端返回部署级 `APP_AVAILABILITY_ZONE`（默认 `Asia/Shanghai`），不是逐点独立配置。
- 与 Web 相同：开始时间包含边界、结束时间不包含边界；支持跨午夜；合法起止时间相等视为全天；无效时间不判断状态；非全天时间缺少有效时区时只展示计划营业时间。
- 一个随前台生命周期运行的时钟在每分钟边界刷新，回到前台立即更新。刷新不触发搜索、重定位或重建点位 ID。
- `hoursTimezone` 为只读响应字段。编辑提案的 PATCH 响应仍是已发布点位，审核通过前不把提交值假装成公开数据。已冻结的提交／图片续传请求字节保持不变。

## 对应的已有服务端与 Web 实现

- Axum／迁移：`59dcb70243e8b0af1c1d9a9d250fb7b8d263fafe`，迁移 `0005_marker_venue_type.sql`。
- Web 标签／营业状态：`dac5c4113adc6c8f78a0cc9b10d5d8fe9b3584eb`。
- 本次仅只读核对真实接口：`GET https://api.lycoris-map.com/api/markers/411?lang=zh` 返回 HTTP 200、`venueType: mall`、`hoursTimezone: Asia/Shanghai`、`10:00–22:00`。
- 数据库字段与现有点位分类已由之前的标签任务完成；本次不重复分类、不做软删除或去重、不部署服务器。

## 复现验证

本地 HTTP fixture 仅绑定 `127.0.0.1:8080`，使用内存中的合成点位与账号，接收测试中的创建／编辑请求，不接触真实账号或生产写入。

```sh
python3 apps/ios/scripts/place-metadata-fixture.py
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/ios/Lycoris.xcodeproj -scheme Lycoris -configuration Test \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- SWIFT_EMIT_LOC_STRINGS=NO \
  -parallel-testing-enabled NO \
  -only-testing:LycorisTests/PlaceMetadataTests \
  -only-testing:LycorisTests/ContributionTests \
  -only-testing:LycorisUITests/PlaceMetadataUITests test
```

真实 VoiceOver 的逐项滑动、读音和手势体验仍需真机人工体验；自动化标签断言不等价于完整的 VoiceOver 验收。

## 本次结果

- `checks-light-110108.log`：41 项单元测试（PlaceMetadataTests、ContributionTests）和 3 项界面测试通过，覆盖原生六类 Picker、新建选点、编辑预填、类别切换、实际 PATCH 请求和中英文最大动态字体。
- `checks-dark-110248.log`：深色模式的中英文／最大动态字体界面测试通过；温晓检查了导出的实际截图，确认标签、时间背景及状态文字显示。
- 首轮同时运行的 AccessibilityRegressionTests、PlaceDataTests、PanelLayoutTests、MarkerHTTPTests，以及收起菜单间距回归通过。
- 营业状态覆盖 30 分钟边界、开始／结束边界、跨午夜、全天、非法时间／时区、夏令时和设备时区无关性；旧 JSON 和已冻结请求的兼容性有独立测试。
- `checks-light-110646.log`：最后复核列表／详情标签、非卫生间无虚构标签及原有收藏预览流程，3 项 UI 测试全部通过。早先收藏预览的一次即时状态断言失败未更改产品逻辑或削弱原测试，最终复核通过。
- iOS 真机 Debug 签名构建通过，构建使用正常 HTTPS API 配置；已安装至 Nora 的 iPhone 16 Pro Max（bundle `com.lycoris.maps`）。安装成功不代表已完成真机人工功能走查。

本地详细日志、xcresult 导出截图与接口核对记录位于本次任务工作目录 `work/ios-place-tags/artifacts/`。
