# Rust 重构执行与验收记录

## 范围与协作

Nora 于 2026-09-14 授权完成计划阶段 0、0.5、1、2、3。分支 `refactor/rust-backend`，实施起点 `8c60383`。温晓负责设计、指导、代码审查和验收，苏瑶通过 OpenCode Go 的 DeepSeek V4.1 Flash 完成实现、测试与返工。

每个完成并验收的改动独立 commit；每个阶段满足通过条件后 push 到同名远端分支并核对远端提交。阶段 4 的生产发布和阶段 5 的 PostGIS 查询替换不属于本轮。

## 阶段状态

| 阶段 | 状态 | 验收依据 |
| --- | --- | --- |
| 0：契约与数据基线 | 已验收 | 43 个接口与 Java 路由逐项一致；三处契约偏差已返工；结构基线在临时数据库建表成功，80 个列定义和 64 项 PG 约束与恢复库一致 |
| 0.5：最新版本运行基线 | 已验收 | Rust 1.98.1；PG 18.6 / PostGIS 3.6.4 / Redis 8.10.1 运行检查通过；备份 7 张表的行数和指纹匹配；旧 Java 通过结构校验及三类公开查询。Rust crate 编译在阶段 1 验证 |
| 1：骨架与公开读接口 | 进行中 | 苏瑶实现基础工程，温晓审查配置、迁移、故障行为；公开点位接口随后验收 |
| 2：认证与用户 | 未开始 | 本轮保持既有账号和登录体验；认证重设计另案 |
| 3：业务写入与审核 | 未开始 | 等待基础接口和身份校验完成 |

## 已执行的基线检查

- Java：`backend/mvnw.cmd -q test` 退出码 0；Surefire 汇总 95 个测试实例，93 通过、2 跳过、0 失败、0 错误。随后显式设置 `LYCORIS_RUN_NEARBY_POSTGRES_TESTS=true` 并执行 `mvnw.cmd -q -Dtest=MapMarkerNearbyPostgresTest test`，原先跳过的真实 PG 测试通过。该测试自行创建并清理合成数据容器；其中性能数字属于旧 Java 查询优化，不作为 Rust 性能结论。
- 本地 Rust：原工具链 1.95.0；通过官方 rustup 安装 1.98.1，并包含 rustfmt 和 Clippy，未更改用户默认工具链。
- 镜像网络：直连 Docker Hub 遇到 DNS 解析问题；使用本地代理核对官方 manifest，通过镜像站取得相同 digest 的公开镜像。测试数据不发送到镜像站。

## 本轮已确定的兼容边界

- 创建点位维持 HTTP 200；无明确排序的公开列表只比较内容集合，不凭空新增排序承诺。
- `/api/markers/all` 维持管理员校验；`/api/admin/markers/all` 继续叠加二次验证。
- `/api/markers/me/created` 返回本人创建的点位，包括自己的私有和待审点位。
- 后续认证重设计保持独立；本轮兼容 Cookie、Session、BCrypt、账号失效和管理员二次验证语义。
- 所有实现测试使用合成数据；生产备份仅用于本地隔离恢复核验，不进入 Git 或发给苏瑶。

## 验收记录

每阶段完成后在此记录实际执行命令、关键回归、提交和推送结果。未执行项目保持待验证状态。

### 阶段 0 与 0.5

- `python docs/rust-migration/verify-contract.py`：43 条契约与 43 条 Java 路由匹配，退出码 0。契约提交 `b058d2d`。
- 结构基线在随机命名的临时测试库执行，与 PostgreSQL 18 恢复库比较 information_schema 列定义及 pg_constraint，80 列和 64 项约束均一致，检查后删除该临时库。
- `python backend-rust/scripts/check-services.py`：两个专用容器 healthy，精确版本检查和创建临时数据库检查均通过。
- 生产备份恢复到独立本地 `lycoris-restore-review`，6 张业务表与 `spatial_ref_sys` 的行数及 SHA-256 全部匹配。比较时显式设置 `PGTZ=Asia/Shanghai`，以匹配原备份的时间戳文本表示；默认 UTC 的文本指纹差异不代表数据变化。
- Java 以 `ddl-auto=validate` 连接恢复后的 PostgreSQL 18.6，启动成功；公开列表、附近与视口三个接口均返回 200，分别得到 360、27、68 条记录。此项是结构及读取兼容性检查，完整写入回退演练仍属于阶段 4。
- 详细恢复校验保存在本地交付目录 `rust-migration-verification/postgres18-restore.json`，包含汇总与指纹，真实数据未进入仓库。
- 阶段 0 推送提交 `8438765`，阶段 0.5 推送提交 `6907c5f`；均已通过 `git ls-remote` 核对。GitHub 返回仓库迁移提示后，origin 更新为同一仓库的规范地址 `git@github.com:Eleanor1018/lycoris-map.git`。

### 阶段 1：基础工程改动

- 苏瑶实现后按温晓审查意见返工：删除连接 URL 日志、限制就绪探针等待、修正 CORS 来源校验、补全迁移脏状态检测、限制测试连接地址。
- 温晓复跑 `powershell -NoProfile -File backend-rust/scripts/check-rust.ps1`：fmt、Clippy 全 targets 零警告、12 个测试均通过（3 个单元、9 个真实服务集成）。
- 迁移覆盖空库初始化、CLI、缺迁移、校验和不符、失败记录、未知版本；就绪检查覆盖正常与各个下游故障，失败返回 503。
- 温晓对合成开发库运行 `lycoris-backend --migrate` 后，启动真实 TCP 服务检查 `/health/ready` 及允许/未允许来源的 CORS，均通过；临时服务已退出。公开点位读取尚未实现，此处不代表阶段 1 整体完成。
- SQLx CLI 0.9.0 已安装；下一项改动开始生成固定 SQL 的离线元数据并校验。
