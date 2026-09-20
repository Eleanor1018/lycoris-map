# 账号、收藏和冷启动编辑回归（2026-09-20）

## 行为

- 登录字段继续同时接受邮箱和用户名。客户端只去掉账号两端空白，保留用户名与密码的大小写。Rust 同时匹配精确用户名与忽略大小写的邮箱，因此含 `@` 的合法用户名也可登录；同一用户只计一次，匹配多个用户仍拒绝认证。
- 收藏按钮立即显示系统蓝色实心书签，取消收藏立即恢复。失败恢复之前的状态；成功后只刷新收藏，不等待本人点位和头像。首次收藏状态读取仍有独立的等待标记，避免在未知状态时反向操作；版本标记隔离迟到读取与账号切换。
- 编辑先打开原生 sheet，以 ProgressView 等待读取。读取会等待正在进行的身份检查或账号操作，再检查账号与会话；关闭 sheet 取消任务。ContributionStore 自行同步，不依赖先打开创建页。失败可在 sheet 内重试。

## 已完成验证

- AccountTests + ContributionTests：35 项通过。覆盖客户端账号原样传递、收藏即时反馈／回滚／旧读／身份变化、首次收藏与本人点位加载分离、直接编辑、身份恢复期间编辑，以及等待身份或读取详情时取消。
- AccountRegressionUITests：2 项通过。使用本机受控 HTTP fixture 注入 4 秒身份检查延迟，验证收藏先填充；全新 fixture 身份不经过贡献入口，直接打开并预填编辑表单。截图已人工检查。
- Rust auth_integration：29 项通过。使用独立的本机合成 PostgreSQL / Redis，覆盖混合大小写邮箱、含 `@` 的用户名、密码大小写、同账号双重匹配及跨账号歧义。
- Xcode Debug 真机签名构建通过；后端 cargo fmt 检查通过。生产服务没有部署或写入测试数据。

## 复现 UI 回归

先在没有其他服务占用 8080 时运行：

```sh
python3 apps/ios/scripts/account-regression-fixture.py
```

在 Xcode 中选择 **Test** 配置的 Lycoris scheme，运行 `AccountRegressionUITests`；也可通过 `xcodebuild -configuration Test -only-testing:LycorisUITests/AccountRegressionUITests test` 指定可用模拟器。测试只接受 `127.0.0.1:8080/__ui_fixture` 返回约定标识的服务，不使用真实账号。

该 Python 服务仅用于控制 UI 响应时序，不是 Rust 后端；后端认证行为由独立的 Rust 集成测试验证。完成后停止 fixture，避免与其他本机 8080 服务冲突。
