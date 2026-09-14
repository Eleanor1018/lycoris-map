# Rust 重构执行与验收记录

## 范围与协作

Nora 于 2026-09-14 授权完成计划阶段 0、0.5、1、2、3。分支 `refactor/rust-backend`，实施起点 `8c60383`。温晓负责设计、指导、代码审查和验收，苏瑶通过 OpenCode Go 的 DeepSeek V4.1 Flash 完成实现、测试与返工。

每个完成并验收的改动独立 commit；每个阶段满足通过条件后 push 到同名远端分支并核对远端提交。阶段三交付后，Nora 进一步授权阶段 4 的发布演练和阶段 5 的 PostGIS 查询优化，按 `stages-4-5-design.md` 继续；正式生产切流不由本地演练自动触发。

## 阶段状态

| 阶段 | 状态 | 验收依据 |
| --- | --- | --- |
| 0：契约与数据基线 | 已验收 | 43 个接口与 Java 路由逐项一致；三处契约偏差已返工；结构基线在临时数据库建表成功，80 个列定义和 64 项 PG 约束与恢复库一致 |
| 0.5：最新版本运行基线 | 已验收 | Rust 1.98.1；PG 18.6 / PostGIS 3.6.4 / Redis 8.10.1 运行检查通过；备份 7 张表的行数和指纹匹配；旧 Java 通过结构校验及三类公开查询。Rust crate 编译在阶段 1 验证 |
| 1：骨架与公开读接口 | 已验收 | 37 个测试通过；同一合成 PG 数据上的 23 项 Java/Rust 真实 HTTP 比较全部通过 |
| 2：认证与用户 | 已验收 | 温晓复跑 126 项完整检查通过，真实 TCP 头像/私有详情/上传边界 23/23，测试连接保护 18/18；认证核心另有 19 项真实 Java/Rust 兼容验证 |
| 3：业务写入与审核 | 已验收 | 主分支完整检查 162 项通过；独立真实 TCP 验收 64/64，覆盖全部 43 个既有接口模板；公开查询 23/23、认证兼容 19/19、头像/上传边界 23/23 再次通过 |
| 4：发布演练 | 进行中 | Linux 发布基础、已有库基线接管、升级/回退与公平性能工具已分配到独立工作树；最终以实际运行和父级复核为准 |
| 5：空间查询优化 | 独立工作树实现中，未验收 | 保持产品球面距离，PostGIS 候选过滤、生成列与 GiST、历史坐标兼容路径；正式性能测量与交付在阶段 4 验收后完成 |

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

### 阶段 1：公开点位读取

- 苏瑶实现 5 个公开读取接口，温晓审查后修正缓存首次失效、精确坐标缓存键、Redis 故障回源、译文归属及 Java 语言协商边界。
- 温晓复跑 `check-rust.ps1`：SQLx 在线元数据核对、离线全 targets 编译、fmt、Clippy 均通过；37 个测试通过、0 跳过（11 单元、9 基础集成、17 点位 PG/Redis 集成）。
- 温晓另建合成契约库，启动原 Java 与 Rust 的真实 TCP 服务，比较 23 组请求的状态码和响应内容：23/23 通过。覆盖五类读取、语言协商、有效和过期翻译、日期变更线、极点、历史坐标、可见性。没有排序承诺的列表按 ID 归一后比较，附近距离排序由 Rust 集成测试另外验证。
- Spring 框架生成的缺参数 400 JSON 与 Rust 明确的 400 文本，以及空列表的语言 Vary 头，已在 `api-contract.md` 标明兼容边界；没有把这些差异算作逐字一致。
- 测试只用合成数据；生产与前端均未切换。
- 阶段 1 推送提交 `99edde7`，已通过 `git ls-remote` 核对远端。

### 共享媒体核心与业务服务

- 图片存储核心在独立工作树经返工后通过温晓的 36 项复跑，合并公开点位模块后 61 项门禁通过；主分支提交 `bfe94ad`。读取使用文件句柄流式发送接口，Windows 目录 junction 逃逸用例实际执行，Unix 专用分支尚未在 Linux 执行。
- 媒体业务服务覆盖头像条件更新、直接/历史提案图片权限、图片提案审批事务、失效引用 CAS 清理。审查修正已删身份权限、受控日志、413 类型区分、部分清理成功后发生错误时的缓存失效。
- 温晓复跑完整门禁：69 通过、0 失败、0 跳过（19 单元、9 基础、17 公开读取、16 图片存储、8 媒体 PG/Redis/文件业务）；SQLx 元数据、离线编译、fmt、Clippy 均通过。此时头像及媒体 HTTP 尚未接入，不能据此标记阶段 2/3 完成。
- 并行全套建库曾触发测试 PostgreSQL 容器 1 GiB cgroup OOM，造成迁移连接 EOF；Docker `State.OOMKilled=true`，并非业务断言失败。该轮不计通过，随后设置 `RUST_TEST_THREADS=4` 并依次复跑通过。后续门禁默认限制测试并发，保持既有容器资源限制。此现象不是应用的生产内存基准。

### 认证与点位事务的独立验收

- 认证核心在工作树提交 `cc7eae3`。温晓审查并要求返工：会话快照 CAS、改密 60 秒转换标记、退出删除失败、注册替换旧会话、角色与二次验证、来源检查、配置及日志、固定 SQLx 宏。温晓复跑 59 项测试通过（22 单元、28 认证 PG/Redis、9 基础），另行复跑 SQLx prepare --check 和 SQLX_OFFLINE 全 targets 检查通过。
- 温晓用真实 TCP 比较认证并验证密码回退：19/19 通过，包括新 Rust BCrypt 的中文/emoji 和恰好 72 字节密码可在原 Java 服务实际登录。缺角色 403 的 Boot JSON 形状据实修正；时间戳按可解析的动态字段校验，不要求两个请求发生于同一毫秒。
- 点位事务核心在工作树提交 `1ba8612`。温晓审查后修正幂等重放顺序、删除多余 RETURNING ID 及无用结果分配；以测试并发 4 独立复跑完整门禁，57 项通过（14 单元、9 基础、17 公开读取、17 写入事务）。包括唯一约束重放、收藏与删除、一次性审核、同基准提案竞争、原文/译文版本与强制失败回滚。尚未挂载对应 HTTP 路由。

### 阶段 2：头像与 HTTP 集成验收

- 认证核心合并主分支提交 `8d836b8` 后，完整检查 116 项通过；温晓再跑公开查询 23/23 与认证 19/19 的实际 Java/Rust HTTP 比较通过。
- 头像三路由、受控 `/uploads` 读取及私有点位详情接入真实身份。`AppState` 初始化媒体失败明确报错，测试使用独立 `TempDir`，迁移命令不初始化上传目录。
- 审查返工保留 tower-http 的全局 8 MiB 限制与逐块 5 MiB 图片限制，沿完整错误来源链识别超限；CORS 包住错误响应，413 统一为既有 `ApiResponse`。头像内部上传错误保持 `上传失败`，普通请求体读取失败为 400。所有图片 HTTP 使用文件句柄流式发送。
- 温晓复跑 `check-rust.ps1`：SQLx 在线元数据核对、离线全 targets、fmt、Clippy 零警告全部通过；126 项测试通过，0 失败、0 跳过（39 单元、28 认证、9 基础、17 公开读取、16 图片存储、8 媒体业务、9 媒体 HTTP）。
- 温晓独立真实 TCP 验证 23/23：头像上传与三种读取路径、私有点位权限、3 MiB 合法 PNG 输入、5 MiB 文件超限、已知长度与 chunked 的 8 MiB 总量限制、64 KiB 认证 JSON 限制、CORS、错误后头像引用保持。测试客户端对已声明超限的请求先发头部并读取提前返回的 413，避免在服务端关闭后继续盲发大请求体。
- 测试脚本在任何 DDL 前检查协议、回环主机和合成库白名单，拒绝查询参数/fragment 与编码路径，避免 SQLx `host`/`dbname` 参数覆盖校验结果。温晓只运行脚本校验前缀的独立检查 18/18，通过合法目标与各类拒绝目标；没有执行网络或 DDL，错误没有回显连接密码。
- 本地复核脚本和原始报告位于本次工作目录的 `work/check-stage2-media-http.py`、`work/stage2-media-http-report.json`、`work/check-test-target-guard.py`、`work/test-target-guard-report.json`。这些均使用合成数据，不含生产备份。

### 阶段 3：非图片 HTTP 独立验收

- 在认证与媒体核心基础的独立工作树接入 18 条点位/收藏/审核路由，提交 `c5dc2bf`；写核心接入提交为 `d1aa643`（来自已验收 `1ba8612`）。
- 温晓要求区分认证 64 KiB 与点位 8 MiB JSON 限制，保留普通 PATCH 只生成提案、审核事务/版本冲突、请求语言与响应语言分离、18 字段编辑提案 DTO。首次新建禁止直接填写非空 `markImage`，幂等重放仍优先返回原点位。
- 温晓复跑完整检查 144 项通过，0 失败、0 跳过；其中 8 项点位 HTTP 集成验证 18 条成功路径、权限矩阵、两个同基准提案审核竞争、大文本边界与图片引用入口。该结果为独立工作树验收，尚不代表主分支阶段 3 或全部 43 个接口已完成。

### 阶段 3：主分支最终验收

- 阶段 2 交付提交 `091a16b` 已推送并通过 `git ls-remote` 核对。阶段 3 的点位事务、18 条非图片接口分别合并为 `1780282`、`871abb8`；后者主分支复跑 154 项通过。
- 温晓对照计划发现日志缺少请求编号，苏瑶补齐并通过双方各自 155 项检查，提交 `eefb6f1`。服务端生成 UUID，响应附 `X-Request-ID`，下游受控日志进入同一 span；完成事件仅记录请求编号、方法、路由模板、状态和耗时。
- 5 条图片 HTTP 在独立工作树由温晓复跑 133 项后验收，提交 `6deb394`；苏瑶解决共享文件冲突并整合全部业务，主分支提交 `bbca95f`。图片上传、审批、驳回和失效引用清理复用已验收事务、权限及文件处理。
- 苏瑶与温晓分别运行完整 `check-rust.ps1`，最终均为 **162 通过、0 失败、0 跳过**：42 单元、28 认证、9 基础、8 点位 HTTP、17 公开读取、17 写事务、16 图片存储、8 媒体业务、17 媒体 HTTP。SQLx 在线元数据核对、离线全 targets 编译、fmt、Clippy 零警告全部通过。测试并发为 4。
- 温晓在 crate 目录执行 `SQLX_OFFLINE=true cargo build --locked` 后，以正常可执行程序启动真实 TCP 服务，独立执行 **64/64** 项断言，覆盖全部 **43/43** 个既有 API 模板的成功路径，以及主要拒绝和状态转换。流程包括登录/用户管理、头像、点位创建幂等重放、公开查询、收藏、译文提交/审批/驳回、原文更新使译文过期、图片提交/审批/驳回/读取/清理、删除和退出。
- 最终主分支再次通过公开查询 **23/23** 项 Java/Rust 比较、认证 **19/19** 项兼容检查、头像和上传边界 **23/23** 项真实 TCP 检查。认证包含 Rust 新账号与恰好 72 字节密码在原 Java 服务实际登录；公开列表按约定归一无序结果。43 路由覆盖不等于所有输入和错误体与 Java 逐字一致，已知框架差异仍见 `api-contract.md`。
- 额外真实 TCP 日志检查验证成功、404 和全局 413：各自具有唯一 UUID，允许来源可读取响应头，每个编号都对应一条含路由/状态/耗时的完成日志；构造的客户端路径、查询、Cookie 和伪造编号均未出现在日志中。测试连接保护仍沿用已验收的 18 项检查。
- 全部实现测试与独立 HTTP 验收只操作合成库、随机命名空间和临时上传目录。Java、前端和生产部署文件未修改；没有接管生产流量，没有启用 PostGIS 查询，也没有将功能测试耗时当作生产性能结论。

最终源码为 `bbca95f`，本次文档提交记录完成状态；阶段 3 交付推送包含二者。温晓在推送后核对远端提交，并将准确提交号和校验结果保存在本地交付清单。

### 本地验收交付物与后续边界

本次交付目录：[rust-migration-verification](C:/Users/Nora/Documents/Codex/2026-09-12/wen/outputs/rust-migration-verification)。`stage3-delivery.json` 保存源码与交付提交、测试摘要、报告 SHA-256 和远端核对状态；`stage3-final-parent-gate.log` 为父级最终完整检查原始输出。真实 HTTP 的报告与独立复核脚本一并保留，均为合成数据，不含生产备份。

阶段 4 待做：Linux/文件权限验证、正式构建与容器发布、前后端完整流程、同负载资源和延迟测量、已有库迁移接管、历史重复账号处理决策、重新登录的切换安排、保留新增数据的 Java 回退、数据库升级及增量回退演练。阶段 5 再评估 PostGIS 查询与索引；认证最终形态仍单独设计。

### 阶段 3：图片 HTTP 独立验收补充

- 在阶段 2 已验收提交 `091a16b` 的隔离工作树 `work/rust-images-http-20260914` 接入 5 条图片接口：`POST /api/markers/{id}/image`、`GET /api/admin/markers/pending-images`、`POST /api/admin/markers/image-proposals/{id}/approve`、`POST .../{id}/reject`、`POST /api/admin/markers/cleanup-missing-images`。
- 复用已验收的头像上传/流式读取/认证/来源中间件与 multipart 逐块 5 MiB 文件/8 MiB 总量 helper，以及 `MediaService` 事务/授权/缓存与 `MarkerService` 本地化；未重写这些核心，也不重复其它工作树已验收的 18 条非图片路由。`MarkerService` 仅新增 `localize_row` 供成功响应本地化，handler 不手写 SQL、不二次更新。
- 响应与错误按契约保留形状：点位上传成功为本地化原点位（不换图、带 `Vary`），缺失/不可见 404 文本、非法 400 文本、413 `ApiResponse`、保存类 500「上传失败」、繁忙 503；4 条管理接口全部 `VerifiedAdmin`，未二次 403 文本、非管理员 403 Boot JSON、匿名 401 固定 JSON，重复处理 400、关联点位缺失 404。
- 苏瑶自测：`check-rust.ps1` 全通过，`RUST_TEST_THREADS=2`（温晓已设置，本轮保持），**133 项通过、0 失败、0 跳过**；SQLx 在线元数据核对、离线全 targets 编译、fmt、Clippy 零警告。新增 7 项媒体 HTTP 测试覆盖上传/本地化、只建 `PENDING` 不改图、待审文件权限矩阵、点位接口 413 形状、管理员/二次验证、审批/驳回/清理与两条审批 HTTP 并发单成功。`Cargo.toml` description 改为不限阶段的 `Lycoris Rust 后端（Axum + SQLx）`。
- 温晓随后在该工作树独立复跑 133 项通过，提交 `6deb394`；已整合到主分支 `bbca95f`，全部接口的最终验收结果见上文。

### 阶段 4：发布运行参数补齐（已验收，提交 d0d10b8）

- 起点由温晓指定工作树 `work/rust-limits-worktree`；苏瑶实现、测试，未 `git add`/`commit`/`push`。
- 新增配置：`DB_STATEMENT_TIMEOUT_MS`（默认 `20000`）与 `DB_LOCK_TIMEOUT_MS`（默认 `5000`），均在
  `1..=300000` ms 内且拒绝 `0`/超上限/溢出，错误只报变量名不回显原值；`PASSWORD_MAX_CONCURRENCY`
  默认按 `available_parallelism` clamp `1..=4`，显式 `1..=32`。`MEDIA_MAX_CONCURRENCY` 语义不变。
  `Config::new` 与 `from_env` 默认一致。
- 新增 `src/db.rs`：服务池沿 `PgConnectOptions` + `after_connect` 对**每条**服务连接用绑定参数
  `set_config` 设置 `statement_timeout`/`lock_timeout`，保留 `max_connections`/`acquire_timeout`/
  `max_lifetime`/`idle_timeout`；维护池（`--migrate`/`--check-baseline`/`--adopt-baseline`）不设置
  服务语句超时，只保留独立 `lock_timeout=5000ms` 等待上限。数据库参数全部绑定，无拼接。
- `migrate::run` 改为与已验收接管一致的独占连接：`pool.acquire().await?.detach()` 后交给 SQLx
  `MIGRATOR`；成功后主动 `close`，出错或任务取消时连接随 future drop 关闭。SQLx 迁移锁是会话级
  advisory lock，独占避免把带锁连接退回池而永久阻塞后续迁移；SQLx 自身迁移事务与 checksum 校验不变。
- `AppState::new` 改用 `config.password_max_concurrency` 建立 `PasswordHasher`，许可仍在
  `spawn_blocking` 闭包内持有至任务结束。
- SQLSTATE `57014`/`55P03` 由 `db::is_timeout_sqlstate` 识别，按既有错误形状受控映射 503
  （Auth JSON、点位写/读文本、媒体 `ApiResponse`/文本）；未知数据库错误仍 500（Auth 本来映射
  unavailable 的路径保持）；失败事务整体回滚、不自动重试；PG 提交后的 Redis/清理成功语义未改；
  点位读取日志不再输出底层 driver detail。
- 苏瑶初轮完整脚本通过 199 项；本轮收尾按套件分别执行（`RUST_TEST_THREADS=2`、
  `CARGO_BUILD_JOBS=2`）：`cargo sqlx prepare --check`、`SQLX_OFFLINE=true cargo check --all-targets`、
  `cargo fmt --all -- --check`、`cargo clippy --all-targets -- -D warnings` 全部通过；各测试套件合计
  **202 项通过、0 失败、0 跳过**（50 单元、28 认证、25 基线接管、5 db_runtime、**11 基础迁移**、
  8 点位 HTTP、17 公开读取、17 写事务、16 图片存储、8 媒体业务、17 媒体 HTTP）。阶段 3 为 162 项，
  阶段 4 既有 29 项，本轮新增 11 项（`config` 3 项 + `db` 1 项 SQLSTATE 分类单元、`db_runtime`
  5 项真实 PG/Router、`integration` 2 项迁移锁独占/争用）。
- `tests/db_runtime.rs` 实测：**同时持有两条物理连接**（`pg_backend_pid` 不同），两条
  `statement_timeout=250ms`/`lock_timeout=125ms` 都生效；短 `pg_sleep(5)` 在 200ms 语句超时下被
  PG `57014` 取消且同连接 `SELECT 1` 可用；`FOR UPDATE` 持锁写在 150ms 锁超时下按 `55P03` 返回
  503、收藏 0 行且点位版本不变，解锁后成功；维护池 `statement_timeout=0` 且 `lock_timeout=5000ms`，
  `pg_sleep(0.4)` 不被服务 150ms 超时取消；真实 Router（`tower::ServiceExt::oneshot`，**非**真实
  TCP 服务）持锁 `PATCH /api/admin/markers/{id}` 返回 503 `服务暂时不可用`，带
  `Access-Control-Allow-Origin` 与合法服务端 `X-Request-ID`，解锁后 200 且写入生效。夹具统一先用
  维护/默认池建立 schema，再建立被测短超时服务池，避免把 PostGIS 建表耗时误判为产品超时。
- `tests/integration.rs` 迁移新增：脏历史使迁移在取得会话锁后失败，断言 `pg_locks` 无残留迁移锁
  （独占连接防泄漏）；持锁争用时另一连接在 200ms 有界锁超时内失败且不建 `_sqlx_migrations`，
  释放后可立即取得迁移锁并完成迁移。已有 migration 9 项保留。
- 配置上下界（含 `0`、`300001`、`u64` 溢出、负数、非数字、`PASSWORD_MAX_CONCURRENCY` 的
  `0`/`33`）由纯函数单元测试覆盖，不依赖环境变量；未知 SQLSTATE 仍 500 由 `db` 单元测试钉住。
- 未测项（据实记录）：未在本轮跑 Linux 发布基础、容器资源配额、真实 release TCP 超时验收或真实
  生产切流；未用真实备份/生产库，仅回环合成库与 Redis；未单独测量 BCrypt 并发生效对延迟的影响
  （仅验证配置接线与许可持有语义）。真实 release TCP 超时验收由温晓另备。
- 文档：`backend-rust/README.md` 配置表新增三项并新增「数据库超时与密码并发」小节，写明单位/范围、
  服务与维护策略差异、`--migrate` 独占连接与 `500 → 503` 新边界；新增 `backend-rust/.env.example`
  模板；`api-contract.md` 记录 Rust 的 503 边界。温晓独立复跑 5 项 db_runtime 与 11 项基础集成
  全部通过，审查通过后提交；最终 Linux 整合门禁与真实 TCP 另记。

### 阶段 4：Linux 整合与独立 HTTP 验收

- 整合基线接管 `0815d6b`、Linux 发布与统一 CLI `ec61e0b`、运行超时与密码并发 `d0d10b8`。发布构建增加专用 BuildKit target 缓存，并在同一构建步骤复制二进制到 `/out` 供最终镜像读取；不改变运行逻辑。
- 苏瑶在线 SQLx 元数据核对、离线全 targets、fmt、Clippy 全通过；真实 Linux 完整套件 **216 项通过、0 失败、0 跳过**。温晓从原始输出重新汇总：61 单元、28 认证、28 基线接管、5 运行参数、11 基础迁移、8 点位 HTTP、17 公开读取、17 写事务、16 图片存储、8 媒体业务、17 媒体 HTTP。
- `lycoris-rust-stage4:local` 的镜像 ID 为 `sha256:51776d6b0f3a9bd93d4a5f0a35595fc1df0a3285a2a4dbb38118eb1e8fa0875a`，Linux amd64 二进制 SHA-256 为 `1be6aa15785f7baf18ef64f64b46bd5dd10c4cd6d25cd895e03365f924ee9e93`。非 root 10001、只读根目录、上传持久化、健康检查、SIGTERM 退出 0、错误上传目录拒绝启动均实际通过，见 `release-linux-evidence.json`。
- 温晓直接运行该 release 镜像，经真实 TCP 独立执行原阶段三契约流程，**43 个接口模板、64 条断言全部通过**，报告 `work/stage4-http-report.json`。复核脚本保留原 64 条断言，记录原始脚本 SHA-256 与本次镜像 ID。
- 温晓另建 UUID 合成库，在真实 release 服务外持有点位表排他锁：GET 与 PATCH 均返回 503，带允许来源 CORS 与服务端 UUID；两次超时合计 0.324 秒。失败 PATCH 后原版本和内容不变；解锁后 PATCH 与 GET 均 200，共 7 条检查通过。首次审核夹具漏填非空 `last_edited_by_owner` 导致建数失败，修正夹具后通过，未改产品；失败与通过报告分别保存在 `work/stage4-timeout-http-fixture-failure.json`、`work/stage4-timeout-http.json`。
- 上述均为本地合成环境验收。完整应用/数据库切换、客户端与公平性能矩阵继续执行，尚未据此标记阶段 4 完成。
