# I4 — 原生账号与收藏

> 2026-09-16 后续调整：用户改为要求登录／注册全部使用 Apple 原生 UI／UX，已替换本文初次验收时的 Figma 紫色登录样式。当前设计以 [design-mapping.md](design-mapping.md#i4-account-presentation-updated-2026-09-16) 为准；下文原有测试记录保留为 I4 历史验收。

2026-09-16，分支 `feat/ios-native`。温晓亲自实现；辅助代理仅只读核对 Rust 契约、设计映射和竞态边界。没有部署服务器或合并主分支。

## 功能与设计

- 地图头像打开原生账号 sheet。登录、注册使用 Figma `126:382`、`126:513` 的颜色、字段顺序、圆角和 SVG；字体适配为 SF。Apple／Google 按钮保持移动端全宽、24pt 圆角与居中文字。验证码保留明确不可用占位，不要求填写。
- 已获用户批准：资料、头像、改密、本人点位使用原生 Form／List。昵称、代词、签名可保存；用户名、邮箱只读；资料可下拉刷新。字段保存期间禁用编辑，避免把尚未提交的新文字标成已保存。
- PhotosPicker 只提供用户选中的照片。头像生成方向修正、最大1024px的JPEG，不把HEIC或原图元数据传给后端。头像失败回退当前账号首字母，不影响收藏列表。
- 原生改密调用现有接口，随后核验会话；服务端若清除当前会话则回到登录，网络错误单独提示。本人点位保留公开／私有、待审核／通过／拒绝状态；私有详情及照片使用认证请求。
- 未登录时整组 Bookmarks 隐藏；登录后显示标题、最多三条原稿点位行，空列表只保留紧凑提示。标题进入完整列表。支持收藏、取消收藏、失败反馈；未登录点击收藏会在登录成功后继续原操作。
- 账号各级页面都有原生返回和完成关闭入口。关闭 sheet 不替换地图实例。笔按钮／编辑、设置与语音的后续阶段边界保持不变。

完整映射与明确的原生适配见 [design-mapping.md](design-mapping.md)。Computer Use 实际打开并检查了模拟器登录、注册；原生 XCTest 完成输入、系统照片选择、账号操作和地图交互，并检查截图。

## 会话与数据隔离

账号请求使用独立 URLSession；公共点位及图片请求继续不带 Cookie。私有 URLCache 和 URLCredentialStorage 均关闭，密码只存在表单请求期间，完成后清空。

服务端 Cookie 的域、路径、Secure、HttpOnly 与原过期时间保留。真实用例发现系统 Cookie 延迟落盘会在刚登录后立即结束进程时丢失新会话，因此 Set-Cookie 响应返回前同步写入设备专用 Keychain；只保存有效的持久 Cookie，退出保存空快照。每个服务 origin 每进程仅恢复一次，避免组件重新初始化覆盖新 Cookie。Keychain 不可写时报告错误，不静默假装已可靠保存。

启动和回到前台核验 `/api/me`。401 清除身份和私有内容；网络／服务故障保留最后确认的身份并显示错误。登录、退出和账号写入串行；账号 publicId、epoch、身份读取代次和列表／详情代次一起拒绝旧响应。收藏登录续做还绑定独立操作意图，退出、换号或关闭账号页后不能继续给新账号提交。

私有照片不进入公共图片缓存。退出立即清理头像、收藏、本人点位、选中私有详情和图片。认证详情404取消旧列表、移除旧行与图钉并重新读取；公共与认证图片模式切换会重新启动正确的加载路径。

## 验证记录

环境：Xcode 26.6、Swift 6.3.3、iOS 26.5 Simulator，iPhone 17／iPhone 17 Pro Max。

- 单元测试覆盖：原有28项地图／配置测试，账号HTTP状态与信封、空体收藏响应、私有DTO、Unicode限额、头像转换、401与503区分、退出失败、账号写入前身份核验、迟到资料／收藏／头像响应、认证请求串行，以及Cookie作用域／过期与Keychain同步写入。
- 原生账号UI覆盖：注册／登录、第三方不可用提示、资料保存、收藏增删、重启恢复、退出后隐藏、辅助大字号、PhotosPicker合成头像上传、改密使另一会话401、本人私有待审核详情、登录续做收藏和第二账号隔离。
- 地图回归覆盖：原有7条面板／键盘／预览／匿名、搜索／详情／分享／Apple Maps、空结果、附近分类、拒绝定位回退与模拟定位流程。
- Pro Max 重复账号／恢复／退出及大字体布局。Debug／Release、Swift strict concurrency、swift-format strict lint、plist与diff检查。

最终结果（全部通过，没有跳过）：

| 验证 | 结果 |
| --- | --- |
| iPhone 17 全量单元测试 | 46 / 46，8个套件 |
| iPhone 17 原生UI | 11 / 11：4条账号流程、7条地图回归 |
| iPhone 17 Pro Max 补充UI | 2 / 2：账号／重启／退出、大字号注册 |
| 截图复核后的消息清理定向复测 | 1 / 1：改密、本人点位、头像流程 |
| Debug测试构建、Release模拟器构建 | 通过 |
| Swift格式严格检查、plist、JSON、本次diff | 通过 |

截图复核还修正了改密成功提示进入本人点位列表的问题；进入列表清除上一页面的操作反馈，当前列表的失败反馈继续保留。定向复测：`/tmp/lycoris-ios-i4-feedback-final.log`。

完整测试日志：`/tmp/lycoris-ios-i4-acceptance-final.log`；Pro Max：`/tmp/lycoris-ios-i4-promax-final.log`；Release：`/tmp/lycoris-ios-i4-release-final.log`。

完整 xcresult：`/tmp/lycoris-ios-i1-build/Logs/Test/Test-Lycoris-2026.09.16_17-55-12-+0800.xcresult`。全量UI结果包含“登录并收藏后立即结束进程，再启动保持登录”和“退出后重启保持匿名”，均未通过额外等待绕过持久化问题。

修复记录：Foundation将未限制端口的Cookie返回为一个空的portList；重建时若写入空Port字符串，就会变为仅限端口0。恢复时跳过空端口数组，保留实际非空限制，已通过隔离单元测试和真实重启流程验证。

只使用已识别的本机 `lycoris_s1_synthetic` 栈。UI测试创建并复用自己的随机合成账号，凭据保存在测试runner容器；不使用真实用户账号或旧S1/S4账号。仅改变本阶段合成账号自己的资料、头像、收藏、密码会话版本和一个幂等私有点位。改密测试重用合成账号原密码并确认另一会话失效，避免改变后续测试的登录凭据。没有扩大服务监听或修改后端代码。

## 工具与发布边界

Keychain 测试需要 Xcode 的本机 ad-hoc 签名：`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`。无需 Apple 开发者团队；旧的完全禁签名命令会缺失应用身份并返回 `errSecMissingEntitlement`。真机签名、真实照片／网络和正式服务地址仍属于后续设备与发布验收。

Apple／Google登录、验证码、找回密码及账号注销缺少后端流程，本阶段没有假实现；退出登录不等于注销。Release 服务地址仍为空。服务端Cookie有30天有效期，本阶段没有延长它。

截图保存在本机 `/Users/nora/Documents/Codex/2026-09-14/wen/outputs/ios-i4/`。日志位于 `/tmp/lycoris-ios-i4-*.log`；未将Cookie或真实凭据写入仓库。早期测试中的Photos无hit point与面板动画时序已修正为真实可操作定位；真实Cookie持久化缺陷已通过Keychain修复，测试没有用额外等待掩盖问题。

## 原生登录调整验收（2026-09-16）

按用户最新要求，登录与注册改为完整原生 SwiftUI Form 和 NavigationStack。系统字体、背景、分组行、导航／关闭按钮、键盘焦点及密码自动填充承接交互；移除账号 sheet 的自定义圆角。Apple／Google 登录改为尚未启用的文字说明，验证码保留原生非交互占位。

Computer Use 在用户当前 Xcode 运行的 iPhone 17 Pro 上验证了中文登录、注册、系统返回和键盘“完成”，并停留在登录页供体验。原生 UI 测试的五条账号流程均已通过：键盘登录／资料／收藏／重启／退出、辅助大字号、注册 Next／无效 Go／系统返回、登录后续做收藏与换号隔离，以及头像／改密／本人私有点位。测试中拒绝保存合成账号密码，等待系统密码提示关闭后页面可操作，没有关闭 App 的原生密码功能。

验证日志：

- `/tmp/lycoris-ios-native-auth-final2.log`：键盘登录和注册导航，2项通过。
- `/tmp/lycoris-ios-native-auth-test3.log`：大字号与收藏续做两项通过；该轮其余两项测试的系统弹窗等待／键盘假设已在上面的定向复测修正并通过。
- `/tmp/lycoris-ios-native-auth-profile2.log`：头像、改密、私有点位，1项通过。
- `/tmp/lycoris-ios-native-auth-build.log`、`/tmp/lycoris-ios-native-auth-release.log`：Debug、Release构建通过。Swift格式严格检查和diff检查通过。

截图：`/Users/nora/Documents/Codex/2026-09-14/wen/outputs/ios-native-auth/`。本次没有改后端、账号会话或地图数据逻辑。开始前已有的两个本地化目录改动，以及 Xcode 后续自动提取状态，保留在工作区，不纳入本次提交。
