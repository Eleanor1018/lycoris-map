# 版本基线与数据来源

记录时间：2026-09-14（Asia/Shanghai）。本文件按实施顺序保留各次候选、运行和验收记录；下文“未提交”“待验收”等表述描述当次交付状态。当前阶段 0 至 3 已通过温晓验收，完整后端提交为 `bbca95f`，最终结果见 [执行与验收记录](execution.md)。

最终锁定组合已通过 SQLx 在线元数据核对、离线全 targets 编译、fmt、Clippy 零警告和 162 项测试；正常可执行程序另经 `SQLX_OFFLINE=true cargo build --locked` 构建。独立真实 HTTP 验收为 64/64，覆盖 43/43 个既有 API 模板。生产升级及性能测量属于阶段 4。

## 工具链与宿主

| 项目 | 版本 | 状态 | 说明 |
| --- | --- | --- | --- |
| Rust toolchain | 1.98.1 | 已安装 | 温晓通过官方 rustup 安装，含 rustfmt、Clippy；后续用精确 toolchain，不改用户默认 |
| Docker Desktop | 29.3.1 | 已安装 | 仅作宿主测试工具，不是本轮部署目标 |

来源：`rustup show`、官方 rust-lang.org 元数据、本机 Docker Desktop。工具链在阶段 0.5 安装，随后已用于阶段 1 至 3 的全部编译与测试。

## 运行依赖镜像

| 组件 | 候选/上游引用 | Digest | 状态 |
| --- | --- | --- | --- |
| PostgreSQL + PostGIS | `postgis/postgis:18-3.6` | `sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677` | 已运行（PG 18.6 + PostGIS 3.6.4） |
| Redis | `redis:8.10.1` | `sha256:298e5b3bc566bade82f46ad5511777a4a07a294097ce16ada2f6a42be5239df5` | 已运行（Redis 8.10.1） |

本机镜像站地址（与上游 digest 一致，供受限网络覆盖）：

- `docker.m.daocloud.io/postgis/postgis@sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677`
- `docker.m.daocloud.io/library/redis@sha256:298e5b3bc566bade82f46ad5511777a4a07a294097ce16ada2f6a42be5239df5`

来源：温晓经官方 registry 确认上游 digest 与镜像站一致；本机通过 `compose.test.yml` 启动后由 `scripts/check-services.py` 读取精确版本。测试环境不含真实数据。

## Crate 版本

阶段 1 直接依赖（已编译、已写入 `backend-rust/Cargo.lock`，`cargo test` / `clippy` 通过）：

| Crate | 版本 | Crate | 版本 |
| --- | --- | --- | --- |
| axum | 0.8.9 | serde | 1.0.229 |
| sqlx | 0.9.0 | serde_json | 1.0.151 |
| tokio | 1.53.1 | thiserror | 2.0.20 |
| tower | 0.5.3 | chrono | 0.4.45 |
| tower-http | 0.7.1 | chrono-tz | 0.10.4 |
| fred | 10.1.0 | uuid | 1.26.1 |
| tracing | 0.1.44 | tracing-subscriber | 0.3.23 |
| sha2 | 0.11.0 | | |

来源：`Cargo.lock`。sqlx 0.9.0 的启用 feature 为
`postgres/runtime-tokio/tls-rustls/chrono/uuid/json/macros/migrate`
（0.9 已把 TLS feature 从 `rustls` 更名为 `tls-rustls`，按官方清单修正）。
`sha2 0.10.9` 仍作为其他依赖的传递版本存在，直接依赖使用 0.11.0。

阶段 2 新增直接依赖（已编译、已写入 `Cargo.lock`）：`cookie 0.18.2`、`bcrypt 0.19.3`；
`fred 10.1.0` 启用 `i-scripts` feature 以使用 `EVAL`（默认 `i-std` 不含 scripts 接口）。
媒体与上传另加入 `image 0.25.10`（`default-features=false`，启用 gif/jpeg/png/webp）、
`tempfile 3.27.0`；本改动新增 `axum` 的 `multipart` feature（传递 `multer 3.1.0`）与
`tokio-util 0.7.19`（`io` feature，`ReaderStream` 流式响应），均只加不降级已有依赖。
tower-sessions 0.15.0 经温晓评估后**未采用**：其通用记录保存默认整份覆写，不提供本项目
所需的字段级原子条件更新；改用范围有限的类型化 Redis 会话模块（见 `auth-design.md`）。

## 结构差异（生产结构与 Java 实体）

`schema-baseline.sql` 依据生产库纯结构导出，与 Java 实体核对后记录如下，未擅自加约束：

- `users` 的 `username`、`email` 在生产结构中无唯一约束（Java `User` 也未声明 `unique`）；本基线保持无约束。
- 6 张表主键均为 identity 自增，与 Java `GenerationType.IDENTITY` 一致。
- 唯一约束：`users(public_id)`、`map_markers(user_public_id, client_request_id)`、`map_marker_translations(marker_id, language)`、`marker_favorites(user_public_id, marker_id)`，与 Java 实体声明一致。
- 外键仅有 `map_marker_translations.marker_id → map_markers.id ON DELETE CASCADE`；其余表按业务字段关联，无数据库级外键。
- `map_markers.created_at/updated_at` 为 `timestamp(6) with time zone`，属 Hibernate 时间戳精度差异，结构以生产导出为准。
- `map_markers.client_request_id`、`user_public_id` 可空：唯一约束允许多行 NULL，与 Java 语义一致。

## 验证记录（2026-09-14，本机）

在 `refactor/rust-backend` 分支执行，仅启动并检查 `lycoris-rust-postgres`、`lycoris-rust-redis`，未触碰 `lycoris-restore-review`：

```
python backend-rust/scripts/check-services.py --start \
  --pg-image "docker.m.daocloud.io/postgis/postgis@sha256:60f6ad1d…" \
  --redis-image "docker.m.daocloud.io/library/redis@sha256:298e5b3…"
```

结果：

- PostgreSQL 18.6（`18.6 (Debian 18.6-1.pgdg13+2)`，`server_version_num=180006`），连接可用。
- PostGIS 3.6.4。
- 可创建并删除临时数据库（验证集成测试建库权限）。
- Redis 8.10.1，`PING` 返回 `PONG`。
- 两个容器均 `running`/`healthy`，退出码 0。

说明：PostgreSQL 18 官方镜像要求数据卷挂载到 `/var/lib/postgresql`（PGDATA 位于其下
`18/docker` 子目录），`compose.test.yml` 已按此设置。测试库为空，无测试或真实用户数据。

### 阶段 1：Rust 基础工程（2026-09-14）

工具链由 `backend-rust/rust-toolchain.toml` 精确固定为 `1.98.1`（含 rustfmt、Clippy），
不改用户默认工具链。执行 `backend-rust/scripts/check-rust.ps1`（在脚本进程内设置
`TEST_DATABASE_URL` / `TEST_REDIS_URL`，仅指向回环地址的合成测试服务）：

- `cargo fmt --all -- --check`：通过。
- `cargo clippy --all-targets -- -D warnings`：通过，无警告。
- `cargo test`：12 个测试通过（3 个单元测试 + 9 个集成测试）。集成测试从测试管理员连接，
  经 `PgConnectOptions` 校验主机为回环地址后创建 UUID 命名的临时库，执行
  `migrations/0001_baseline.sql`，构造 Router 并用 `tower::ServiceExt::oneshot` 验证
  `/health/live` 与 `/health/ready`。覆盖：未迁移库被 `NotMigrated` 拒绝且确认只读校验不建表、
  迁移记录缺失/校验和不符/`success=false`/未知已应用版本分别被拒、`--migrate` 子进程对空库迁移、
  坏 PG 与未初始化 Redis 时 `/health/ready` 返回 503（检查各自 2 秒超时、并发执行）。
  测试退出后仅删除本用例的 UUID 临时库并输出清理提示（已核对无残留 `lycoris_test_*`）。
- `migrations/0001_baseline.sql` 与 `schema-baseline.sql` 内容逐字一致（6 张表、无数据，
  含 `CREATE EXTENSION IF NOT EXISTS postgis`）。

配置与日志：`Config` 不派生 `Debug`；启动只记录“配置已加载”与监听地址，不打印连接串；
数据库/Redis/I-O 启动错误的 `Display` 只给受控摘要。`CORS_ALLOWED_ORIGINS` 逐项校验为
`http`/`https` 源，拒绝 `*`、`null`、路径、查询、片段与用户名密码；空白名单表示不放行跨域。
`DB_MAX_CONNECTIONS` 及其他时长参数拒绝 0。访问日志按路由模板、方法、状态与耗时记录，
不使用 `TraceLayer` 默认的完整 URI。

`Cargo.lock` 已生成，作为提交候选交由温晓确认。普通启动只校验迁移已存在，不自动执行 DDL；
对空库需显式运行 `lycoris-backend --migrate`。已有生产库的接管尚未自动化，初始建表不得重复
用于已有库，接管验证留待后续阶段专项进行。

### 阶段 1：公开点位读取（2026-09-14）

本改动为阶段 1 第二项独立改动：所有公开点位读取（匿名），沿用已验收基础工程与锁定依赖，
未新增 crate。范围仅 `backend-rust/` 与本文件；未访问服务器、`lycoris-restore-review`
或任何备份，未 commit / push。

结构与契约：

- 新增 `src/modules/markers/`：`model`（`MarkerRow` 数据库行与 `MarkerDto` 响应 DTO 分离）、
  `repository`（`sql/*.sql` + `query_file_as!` 固定 SQL）、`localization`（语言协商、类别、
  开放时间纯函数与源文本哈希）、`cache`（Redis 命名空间缓存）、`service`（可见性、去重、
  批量译文、缓存回源）、`http`（薄 handler 与路由）。
- 5 条匿名路由：`GET /api/markers/public`、`/search`、`/nearby`、`/viewport`、`/{id}`。
  响应字段与 Java `MapMarker` 一致（23 项，camelCase）；成功带
  `Vary: Accept-Language, X-App-Language`；错误为中文纯文本；详情不可见返回 404 空体。
- 可见性 `is_public AND review_status='APPROVED'`，不筛 `is_active`；资源级判定集中在
  `can_view(row, Option<&Viewer>)`，本阶段全部以 `None` 调用，未引入伪身份，留待下一阶段
  接 `OptionalViewer`。
- 语言优先级与哈希逐字节对照 Java：显式 `lang` > 非空 `Accept-Language`（不支持/非法直接
  `zh`，不回退 `X-App-Language`）> `X-App-Language` > `zh`；SHA-256 紧凑 UTF-8 JSON
  `[规范化语言,title或"",description或""]`，非 ASCII 不转义、控制字符小写 `\uXXXX`。
  既有 Java/Python 向量在本机 Rust 单元测试与真实接口测试中均通过。
- 类别 4 类；`safe_place`/`dangerous_place` 写/查询归一为 `self_definition`，未知查询 400，
  读取未知归一为 `self_definition`。`isActive` 按 `Asia/Shanghai`（`APP_AVAILABILITY_ZONE`
  可配）读取时计算，`start=end` 全天、跨午夜、单边/非法回退数据库值，不回写、不推进 `version`。
- 搜索合并原文/类别/经纬度文本（保留 `%`/`_` 通配）、有效译文与可解析坐标（容差 `0.00015`）
  并去重；缺失 `q` 为 400，仅显式空串/空白 `q` 返回 `[]`。邻近沿用有包围盒的 Haversine
  （6 371 000 m，非 PostGIS），默认半径 1000（夹取 1..50000）、默认类别 `accessible_toilet`，
  距离升序、同距按 ID 稳定；极区与日期变更线均有真实测试。视口拒绝反向 min/max 与越界，
  `categories` 白名单。
- Redis 查询缓存使用独立 Rust 命名空间（默认 `lycoris:rust:marker`），只存 ID 与缓存版本，
  `nearby` 12s / `viewport` 10s；命中后回 PG 校验可见性并读取最新内容，Redis 故障/超时/坏
  JSON 回源，每条命令 500ms 超时；失效用永不过期的 generation key 原子 `INCR`，不
  `FLUSHALL`/`KEYS`。缓存 key 中经纬度按 `f64::to_bits` 精确保留请求值，不因截断共享结果。
- `migrations/0001_baseline.sql` 未改动。`.sqlx/` 离线元数据由 SQLx CLI 0.9.0 生成；
  `scripts/check-rust.ps1` 迁移合成开发库（`lycoris_rust`）后执行
  `cargo sqlx prepare --check -- --all-targets` 与 `SQLX_OFFLINE=true cargo check --all-targets`，
  再跑 fmt / clippy / test；集成测试仍各自创建 UUID 临时库，未污染开发库。

温晓审查后的返工（2026-09-14，同一改动内）：

- generation 缺省为 `0` 且**不再自动过期**（每命名空间一个键），首次 `INCR` 即从 0→1 真正
  切换命名空间，之后每次失效继续递增；禁用缓存时 `invalidate` 不访问 Redis。测试预热缓存后
  两次 `invalidate` 结果分别为 1、2 且新增点位立即出现，并定向 `DEL` 自己的 generation 键
  （不使用 `KEYS`/`FLUSHALL`）。
- 缓存 key 经纬度改为 `f64::to_bits` 十六进制精确编码，新增“仅差小数第 5 位”的半径 1m 邻近与
  窄视口真实缓存回归，确认不共享结果。
- Redis generation/read/write 均带 500ms 命令超时；新增未连接与已断开专用客户端的回归，
  断言回源成功且等待有上限，不关闭共享服务。
- `translation_is_current` 增加 `row.id == translation.marker_id`，并补相同哈希但来自不同
  marker 的拒绝测试。
- `Accept-Language` 按本机 Java 合成探测（`Locale.LanguageRange.parse`）对齐：非法 range
  （如 `en--x`）、未知参数（`en;garbage`）、重复 q、整项解析错误一律回 `zh`；重复语言范围
  以首次权重生效；`en;q=0,zh;q=0.5,en;q=1` → `zh`。query `lang` 与 `X-App-Language` 优先级不变。
- 源文本哈希改用 `serde_json` 三元素字符串数组的紧凑编码，删除手写 JSON 转义；原 Unicode/
  控制符向量保持不变。
- HTTP 成功体仍为 23 个 Java `MapMarker` 字段。`GET /api/markers/search` 缺失 `q` 返回 400，
  仅显式空串/空白返回 `[]`；`GET /api/markers/nearby` 缺失 `lat/lng` 在本实现返回中文文本 400，
  与 Java 由参数解析前置拦截产生的 Spring 默认 400 JSON 属**解析层错误表现差异**，不伪造
  timestamp 等框架字段；业务错误、401/403/404 与语言行为保持兼容。邻近不伪造不可达的 PostGIS
  错误（当前无空间函数调用），底层失败按通用 500 文本返回。

验证记录（2026-09-14，本机，仅回环合成服务）：

```
powershell -NoProfile -File backend-rust/scripts/check-rust.ps1
```

结果：SQLx CLI 0.9.0 校验通过；合成开发库迁移成功；`cargo sqlx prepare --check` 通过；
`SQLX_OFFLINE=true cargo check --all-targets` 成功；`cargo fmt --all -- --check` 通过；
`cargo clippy --all-targets -- -D warnings` 零警告；`cargo test` 37 个测试全部通过
（11 个单元 + 9 个基础集成 + 17 个公开点位真实 PG/Redis 集成）。

真实 PG/Redis 覆盖：公开/私有/待审/驳回/关闭但公开；5 路由状态与字段形状；语言优先级、
坏/非法 header、控制字符源哈希、过期译文回退；搜索原文/译文/坐标与通配；邻近默认值、
同距、半径边界与夹取、日期变更线、极区；视口非法边界与类别白名单；缓存命中后转私有或
REJECTED 立即隐藏、内容修改读取最新、坏 JSON 与 Redis 故障回源、失效后新点位出现；读取
不修改 `version`/`is_active`/`category`/`updated_at`。

### 阶段 2：认证与用户核心（2026-09-14，`work/rust-auth-20260914`）

在隔离工作树实现第一项独立改动：保留 Cookie + 账号 + 密码 + 管理员二次验证体验，
11 个认证/用户路由（不含 3 个头像路由与点位模块）。设计与边界见 `auth-design.md`。

- 会话：`cookie 0.18.2` 解析/生成 Cookie，`uuid 1.26.1` 生成 64 ASCII 不透明标识，
  key 为标识的 SHA-256；Redis 哈希仅存 `userId`/`sessionVersion`/`role`/`secondAt`。
  五类原子操作全部用 Lua：创建（确认不存在 + TTL + 替换删除旧 key）、读取续期、
  删除、二次验证写入/清除、版本推进；所有字段更新校验 key 存在与身份一致。
- 密码：`bcrypt 0.19.3` 默认 cost 10，`spawn_blocking` 持有 `OwnedSemaphorePermit`
  直到任务真正结束；先检查 UTF-8 ≤ 72 字节再调用普通 `hash/verify`，不使用
  `non_truncating_*`。历史明文仅在无 `$2a$/$2b$/$2y$` 与 `{}` 前缀时按明文比较，
  成功后 `UPDATE ... WHERE password=$expected AND row_version=$expected` 条件升级。
- 提取器：`OptionalUser`/`CurrentUser`/`AdminUser`/`VerifiedAdmin`；每请求从 PG 重新加载
  `deleted`/`sessionVersion`/当前角色，权限只看当前 DB，角色变化清除二次验证。
- 注册：事务级 `pg_advisory_xact_lock` 下重新检查用户名与规范化邮箱后插入；历史库
  存在未删除重复账号，本轮**不加唯一索引、不自动清理账号**（临时例外，见 `auth-design.md`）。
- 写来源：对含 login/register/logout 的所有非安全方法统一校验 `Origin`/`Sec-Fetch-Site`/
  `Referer`；无浏览器头的原生 App 请求放行。注册限流用 Redis 原子 INCR + TTL，
  仅显式可信代理才信 `X-Forwarded-For`；Redis 故障按 503，不无上限放行。
- 数据访问：固定查询使用 SQLx 编译期宏 `query_file_as!`/`query_file_scalar!`/`query_file!`
  与 `queries/*.sql`，`.sqlx` 离线元数据已在本工作树生成，可用 `SQLX_OFFLINE=true` 构建；
  所有业务参数 bind，只有临时测试库名等真正动态 SQL 才用运行期 `AssertSqlSafe`。

验证（`backend-rust/scripts/check-rust.ps1`，仅回环合成服务）：

- `cargo fmt --all -- --check`：通过。
- `cargo clippy --all-targets -- -D warnings`：通过，无警告。
- `cargo sqlx prepare --check -- --all-targets`：通过（`.sqlx` 与实际查询一致）。
- 以 `SQLX_OFFLINE=true` 执行 `cargo test`：**59 个测试通过**（22 单元 + 28 认证集成 +
  9 阶段 1 集成）。
  认证集成覆盖：Java 合成 BCrypt 向量（ASCII/Unicode/内嵌 NUL/71/72 字节）、明文升级与
  哈希字面量拒绝、重复历史账号不授权、Cookie 稳定、失败登录保留会话、退出与二次验证
  CAS 竞争不复活、改密当前保留其它失效、重置/删除/恢复会话失效、角色降级不越权并清二次、
  二次验证过期、10 并发注册唯一、限流 429 与坏 Redis 503、可信代理与 XFF 伪造、
  写来源跨站拒绝与原生 App 放行、资料 null/空串、管理员分页/搜索/软删除形状。
- Java 合成向量（温晓提供，password 列 base64 UTF-8；cost 4 仅测试）已全部转为版本化
  单元/集成测试；Rust 生成的 `$2b$` 哈希沿用 Java `BCryptPasswordEncoder` 支持的格式前缀，
  但 Web 端回退识别的实机回归留待切换前专项执行（本轮未运行 Java）。

温晓复审返工（同轮完成）：

- 身份加载改为**按读取快照 CAS 失效**：版本失配先有界重读 Redis 等待并发推进落地，
  再以 key 存在且 userId/版本/观测角色一致为条件删除；CAS 输给并发则重读新状态。
  新增仓储级真实 Redis 测试证明旧快照不能删已推进的新版本，HTTP 验证改密期间并发 `/me`
  仍是当前会话、其它会话失效。
- 角色变化同步的 Redis 错误不再被忽略（返回 503），CAS 竞争有界重读、logout 后匿名；
  本次返回的 `second_at` 在角色变化时清空；二次验证要求 `elapsed ∈ 0..=TTL`，未来值拒绝。
- 固定查询改为 `query_file_*` 宏 + `queries/*.sql` + `.sqlx`，移除 `format!`+`AssertSqlSafe`
  的列拼接；新增 `SQLX_OFFLINE=true` 构建与 `prepare --check`。
- Session/限流 Redis 命令统一短超时（`REDIS_COMMAND_TIMEOUT_SECONDS`，≤10s），坏/受限
  Redis 均以真实 Redis 测试验证 503（含 ACL 拒绝 DEL 的 logout 回归）；TTL 换算用饱和转换
  且配置限制上限。
- 配置启动即校验 Cookie 名（RFC 6265 token）与 domain（无控制字符/分隔符）、命名空间非空；
  `Identity`/`UserRow` Debug 脱敏，含密码的请求 DTO 不再派生 Debug。
- logout 的 DEL 失败返回 503，不声称退出成功、不清 Cookie；注册与登录一致，携带请求旧标识
  原子轮换会话。
- Origin 校验：cross-site 拒绝、合法 FetchMetadata 仍校验 Referer、非法值不当可信；
  移除无必要的 `Headers` 包装；JSON 媒体类型精确判断（拒绝 `application/jsonp`），
  超限返回 413。
- 复审二：以**短期 Redis 转换标记**替代“几个 sleep 推断无并发改密”。改密写 PG 前在当前会话
  以预期 userId/version/role 标记随机 nonce + 60s 有界 `pendingUntil`（Redis 不可用不写 PG；
  已有转换 409）；PG 提交后同 nonce 原子推进 sessionVersion、清 secondAt 与 pending；
  PG 明确冲突按 nonce 清 pending，结果不确定任其过期。版本失配遇有效 pending 时有界重读，
  仍未结束返回 503，绝不 401 或删除；失效 Lua 检查“无有效 pending”且检查与删除原子。
  新增确定性窗口测试：begin→PG提交→等待超过原 18ms→/me 为 503（非 401/DEL）→complete→
  同 Cookie 200；旧设备 401；begin→退出→complete 不复活；PG 冲突 cancel；过期 pending 不阻止失效。
  `VerifiedAdmin` 的 `now-at` 与 `as_millis as i64` 改为 checked/saturating，未来/极值一律拒绝。
- 复审二：修正错误入口契约。真实 Java 对“已认证但角色不足”走 Spring Boot 默认错误分派，
  返回 `{timestamp,status:403,error:"Forbidden",path}` JSON（原契约误记为空体）。已更新
  `api-contract.md`/`api-contract.json`，并让 `AdminUser`/`VerifiedAdmin` 缺角色时返回该 JSON
  （path 取自 `Parts.uri`，timestamp 为当前 UTC 毫秒）；401 与二级密码 403 文本不变，
  点位属主 403 中文纯文本不变。

未完成项（当时）：头像 3 路由、点位模块；媒体流式存储由另一 media 任务负责。其后已在主工作
树整合并接入头像/受控读取，见下一节。该独立改动未 commit/push。


### 阶段 2：认证/用户/头像集成与受控图片读取（2026-09-14，主工作树 `refactor/rust-backend`）

在主工作树整合认证核心、公开点位读取、`ImageStore`/`MediaService` 后，接入头像 HTTP 与
受控 `/uploads` 读取，并把私有点位 detail 接到真实数据库身份。范围仅 `backend-rust/` 与
`docs/rust-migration/`，未改 Java/前端/服务器/恢复库/备份，未 commit/push。

- `GET /api/markers/{id}` 接 `OptionalUser`，按当前数据库身份构造真实 `Viewer`
  （`publicId`/`role`/`deleted`）：属主/管理员可见私有待审，其他匿名 `404`。其余四个公开读接口
  保持匿名，不加载会话、不伪造身份。
- 头像 3 路由：`GET /api/me/avatar`（`CurrentUser`）、`GET /api/users/{publicId}/avatar`（匿名）、
  `POST /api/me/avatar`（`CurrentUser` + 写来源校验 + multipart `file`）。读取只接受合法
  `/uploads/avatars/*` 引用，用户缺失/已删/无图/非法引用 `404` 空体；成功为流式图片，
  MIME 按扩展名，`Cache-Control: public, max-age=600`、`X-Content-Type-Options: nosniff`。
  上传使用 `MediaService.upload_avatar(user.id, user.row_version, user.public_id, bytes)`，
  `Updated` 后以固定 SQL 回读最新 `UserResponse` 返回 `ApiResponse{code:0}`，不覆盖其它资料列；
  `NotFound` → `404`、`VersionConflict` → `409 ApiResponse`。PG 提交后回读失败只记录并返回
  本次已写入结果，绝不谎称上传回滚。
- 受控读取拆成 `/uploads/avatars/{filename}`（匿名、不加载会话）与
  `/uploads/markers/{filename}`（接 `OptionalUser`，权限交 `MediaService.open_uploads`）。
  合法读取用 `tokio_util::io::ReaderStream` 包装 `OpenedImage.file` 作 Body，带
  `Content-Type`/`Content-Length`/`Cache-Control: no-store`/`nosniff`；非法/缺失/不可见 `404` 空体，
  不整张读入内存，Open 之后的流错误交连接层传播。
- `AppState` 统一持有 `ImageStore`/`MediaService`（一个图片 CPU 并发许可，`MEDIA_MAX_CONCURRENCY`
  默认 1，必须为正值）；启动构造失败返回明确错误而非 `unwrap`/`panic`；`--migrate` 不初始化
  上传路径。其余认证/点位 state 保持不变。
- multipart 显式覆盖 Axum 默认 2 MiB 为 8 MiB（`DefaultBodyLimit`）；**恢复 tower-http 全局
  `RequestBodyLimitLayer` 8 MiB**，对所有接口（含不读 body 的 `GET /health/*`）按已知
  `Content-Length` 提前 413，未知长度流式 body 在读取时由 `Limited` 抛 `LengthLimitError`。
  逐块读取文件累计 `<=5 MiB`、不依赖 `Content-Length`；读到 multipart 结束以覆盖无长度尾随
  字段，未知字段流式丢弃，重复 `file`/缺 `file`/空文件明确 `400`。
- 超限识别沿整条 `source()` 链检测 `http_body_util::LengthLimitError`（`web::is_length_limit_error`
  供 JSON 提取器与 multipart 共用），不再依赖 Axum 单层 `status()`，也不靠错误字符串。tower-http
  全局限制产生的 413 统一为
  `ApiResponse{code:413,message:"上传文件过大，请选择 5MB 以内的图片",data:null}`；JSON 提取器
  保持 64 KiB，真实超限为结构化 413 并复用统一文案 `上传文件过大，请选择 5MB 以内的图片`，截断/网络读取失败
  为 400 `请求体读取失败`，不误报为图片过大。
- `src/multipart.rs` 只提供读取错误分类，响应形状由调用接口**显式选择**（`ErrorShape` 参数）：
  头像用 `ApiResponse`，且 `avatar_media_error_response` 对 `Internal` 保持 Java
  `AuthController.uploadAvatar` 的 `500 "上传失败"`；通用 `media_error_response` 供未来管理员
  媒体业务仍用一般内部错误，阶段 3 点位图片业务错误用中文纯文本（全局 413 与乐观锁 409 例外
  仍为 `ApiResponse`），避免未来复用后静默改变点位错误体。
- CORS 调整为最外层，包住 `normalize_payload_too_large` 与全局请求上限：已允许 Origin 的
  已知 `Content-Length` 超限 413 与流式 multipart 超限 413 都带
  `Access-Control-Allow-Origin`/`Credentials` 与 `Vary`；非白名单 Origin 不发 allow-origin。
- `Config`/Origin/Session 核心逻辑保留；写来源中间件覆盖 multipart；未对 GET 强制身份。
- `scripts/check-rust.ps1`：在任何 `cargo sqlx database create` / `migrate` 之前先校验
  scheme（PG 仅 `postgres`/`postgresql`，Redis 仅 `redis`/`rediss`）、主机（仅
  `127.0.0.1`/`::1`/`localhost` 或静态 `IPAddress.IsLoopback`，移除 `127.` 前缀授权）、
  拒绝任何 query/fragment（SQLx 的 `host`/`hostaddr`/`dbname` 覆盖参数）与编码/非法库路径，
  迁移目标只允许完整 `lycoris_rust` 或 `^lycoris_test_[A-Za-z0-9_]+$`（拒绝
  `restore_review`/`contract_review` 等）；参数错误不回显连接串或密码；未显式设置
  `RUST_TEST_THREADS` 时默认 4 并提示不要多工作树同时跑门禁；不枚举或批量删除
  `lycoris_test_*`。

验证（`backend-rust/scripts/check-rust.ps1`，仅回环合成服务，测试并发默认 4）：
`cargo sqlx prepare --check -- --all-targets`、`SQLX_OFFLINE=true cargo check --all-targets`、
`cargo fmt --all -- --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test` 全部通过；
**126 个测试通过、0 失败、0 跳过**（39 单元 + 28 认证 PG/Redis + 9 基础集成 + 17 公开点位 +
16 图片存储 + 8 媒体业务 + 9 媒体 HTTP）。`.sqlx` 实际以 `cargo sqlx prepare -- --all-targets`
重新生成并通过 `--check`；本轮未新增 SQL。

脚本拒绝路径另做了**不连接目标**的实跑（仅触发校验即退出）：
`db.example.com`（非回环）→ 拒绝；`127.0.0.1/restore_review` 与 `contract_review` → 拒绝；
`?host=evil.example.com`、`?dbname=restore_review`（query 覆盖）→ 拒绝；
`mysql://`（错误 scheme）→ 拒绝；`127.example.invalid`（前缀伪装）→ 拒绝；
`lycoris%2Frust`（编码分隔符）→ 拒绝；默认 `lycoris_rust` 正常执行门禁。所有错误信息均不含
连接串或密码。

未完成项（当时，不声称阶段 3 完成）：点位图片上传 `POST /api/markers/{id}/image`、管理员图片提案
审批与 `cleanup-missing-images` 的 HTTP 路由尚未挂载，`MediaService` 仅为核心准备；
点位写入/编辑/审核路由属阶段 3 另案（已在独立工作树验收 18 条非图片接口）。上述 5 条图片
接口其后在同一 Rust 核心上接入，见下一节。本改动未 commit/push，由温晓验收。


### 阶段 3：点位图片上传与管理员图片提案/清理 HTTP（2026-09-14，`work/rust-images-http-20260914`）

在阶段 2 验收提交 `091a16b` 的隔离工作树上接入阶段 3 剩余 5 条图片 HTTP 接口，复用已验收的
头像上传/流式读取/认证/来源中间件、multipart 逐块 5 MiB 文件/8 MiB 总量 helper、`MediaService`
事务/授权/缓存与 `MarkerService` 本地化；**未重写**这些核心，也不重复其它工作树已验收的 18 条
非图片路由。范围仅 `backend-rust/` 与 `docs/rust-migration/`，未改 Java/前端/服务器/恢复库/备份，
未 commit/push。

- `POST /api/markers/{id}/image`（`CurrentUser` + 写来源校验 + multipart `file`）：先认证与来源
  校验，再逐块读取 `file`；从数据库身份构造真实 `Viewer`（`publicId`/`role`/`deleted`）与
  `username`，调用 `MediaService.submit_marker_image`。只插入 `PENDING` 提案、**不**改
  `map_markers.mark_image` 或推进 `version`；成功 `200` 返回经
  `MarkerService.localize_row` 按 `lang`/请求头本地化的原点位（成功响应带
  `Vary: Accept-Language, X-App-Language`）。错误形状：无会话 → 安全入口固定 401 JSON；
  缺失/不可见点位 → `404 点位不存在` 文本；空文件/非法图片 → `400` 文本；超 5 MiB 或整请求
  超 8 MiB → `413 ApiResponse`（复用头像已验证的形状）；保存类内部错误 → `500 上传失败`；
  图片处理繁忙/依赖故障 → `503`。
- 4 条管理接口全部 `VerifiedAdmin`：`GET /api/admin/markers/pending-images`（`PENDING`
  `createdAt DESC`，8 字段普通 JSON 数组）、`POST /api/admin/markers/image-proposals/{id}/approve`
  （同事务锁提案→更新点位 `mark_image`/`version`→写审核信息，`200` 返回本地化 `MarkerDto`）、
  `POST .../{id}/reject`（`200` 空体）、`POST /api/admin/markers/cleanup-missing-images`
  （`{checked,cleared,message}`）。未登录 → 固定 401 JSON；已认证非管理员 → Boot 默认 403 JSON
  `{timestamp,status,error,path}`；管理员未二次/过期 → 文本 403；重复处理 → `400 该提案已处理`；
  相关点位缺失 → `404 关联点位不存在`；提案缺失 → `404 图片提案不存在`。handler 不手写 SQL、
  不二次更新；图片读取仍全部走已实现的 `/uploads` 权限检查。
- `MarkerService` 新增 `localize_row`（复用公开读取的批量本地化与回退规则）供两处成功响应使用；
  `src/multipart.rs` 新增 `marker_upload_media_error_response`（`Internal` 保持 `500 上传失败`，
  其余文本形状、413 仍 `ApiResponse`）。`src/routes/admin_markers.rs` 为 4 条管理路由的薄 handler。
- `Cargo.toml` 的 package description 由限定阶段 1 改为不限阶段的
  `Lycoris Rust 后端（Axum + SQLx）`。
- `tests/media_http.rs` 增补 7 项真实 Cookie + PG/Redis + 临时文件路由测试（原 9 项增至 16 项）：
  上传成功并本地化、只建 `PENDING` 且不改点位图、匿名/他人看不到待审文件而属主/管理员/有权限
  提案者可见、非法/超限上传沿用头像已验证 helper 且点位接口 413 形状、管理员权限与二次验证矩阵、
  审批成功返回本地化 DTO 且重复/缺失/关联点位缺失错误、两条审批 HTTP 并发只有一个成功、驳回后与
  关联点位删除后的图片权限维持媒体核心、清理只取消确实缺失的引用且不删文件。其它阶段 3 路由若
  暂未合并，测试用合成 SQL 种点位，不重复实现 18 条路由。

验证（`backend-rust/scripts/check-rust.ps1`，仅回环合成服务；温晓已设 `RUST_TEST_THREADS=2`，
本轮保持 2）：`cargo sqlx prepare --check -- --all-targets`、`SQLX_OFFLINE=true cargo check
--all-targets`、`cargo fmt --all -- --check`、`cargo clippy --all-targets -- -D warnings`、
`cargo test` 全部通过；**133 个测试通过、0 失败、0 跳过**（39 单元 + 28 认证 PG/Redis +
9 基础集成 + 17 公开点位 + 16 图片存储 + 8 媒体业务 + 16 媒体 HTTP）。本轮未新增 SQL，`.sqlx`
离线元数据保持有效。阶段 3 最终 43 API 验收与推送由温晓完成，本工作树不提前声称全阶段完成。

### 阶段 3：点位写入、审核与收藏事务核心（2026-09-14）

本改动在已验收的阶段 1 上实现阶段 3 点位业务数据库核心，供下一项 HTTP 接入直接调用。
范围仅 `backend-rust/` 与本文件；未改主工作树、其它工作树、Java 与前端，未访问服务器或
`lycoris-restore-review`/备份，未 commit/push。未新增 crate，未加表、未改结构/默认、未生成
生产迁移，也未开启 PostGIS 查询。

结构（只新增必要文件，另加小而合理的读取复用）：

- `src/modules/markers/write_model.rs`：显式身份 `Actor { public_id, username, is_admin }`、
  复用 `Viewer` 的可见性、`MarkerCreateRequest`/`MarkerUpdateRequest`、提案行
  `EditProposalRow` 与响应 `EditProposalDto`、局部 `WriteError`。
- `src/modules/markers/write.rs`：`MarkerWriteService` 事务核心。固定 SQL 全部经
  `sql/*.sql` + `query_file!`/`query_file_as!` 编译期校验并生成 `.sqlx` 元数据；无 ORM、
  无 `AssertSqlSafe`、无拼接固定 SQL。无需结果集的 INSERT/DELETE/UPDATE 用
  `query_file!(...).execute()`，不为通过编译而 `RETURNING` 主键再 `fetch_all`；需要返回最新
  行的语句保留 `RETURNING` + `fetch_one`。
- 写入相关 `.sql`：`insert_marker`、`find_by_client_request`、`lock_marker[_share|_key_share]`、
  `update_marker_fields`、`insert_favorite`/`delete_favorite`/`find_favorite_ids`、
  `delete_favorites_by_marker`/`delete_translations_by_marker`/`delete_marker`、
  `find_by_user_public_id`/`find_by_ids_any_visibility`/`find_all`/`list_pending_markers`、
  `insert_edit_proposal`/`lock_edit_proposal`/`list_pending_edits`/`update_proposal_status`、
  `find_translation_for_language`/`upsert_translation_manual`。
- `service.rs` 新增 `MarkerService::localize(rows, lang)`，写接口返回最新 `MarkerRow` 后直接
  复用现有本地化，不复制一套 localization，也不回写读取期 `isActive`。
- `mod.rs` 导出 `write` / `write_model`；`repository.rs`、`http.rs` 未改。

契约与事务要点：

- 创建：顺序沿用 Java——先做最小必填字段（`lat/lng/category/title` 不能 null）与
  `clientRequestId` 归一/长度检查，再按 owner+key 读回已有点位；命中重放时不校验也不采纳重试
  载荷里的坐标/类别/开放时段（已有 key 携带非法 category 或单边开放时间仍返回同一 ID 且不改
  原点位）。仅首次创建做完整校验：`lat/lng` 有限且范围，`category` 归一（legacy→
  `self_definition`，未知 400），`title` 必填，`clientRequestId` trim、空白→null、≤64
  （UTF-16，Java `String.length()`）。DB `varchar` 字段（`title` 120、`category` 64、
  `username`/`user_public_id` 64、`mark_image` 512）按 PostgreSQL `char_length` 字符数校验。
  默认 `is_public=true`、`is_active=true`、`PENDING`、`version=0`。
  `(user_public_id, client_request_id)` 唯一约束处理并发重放：仅该约束 `23505` 才回读并返回
  同一 ID；其它数据库错误一律内部错误，不当幂等命中；无 key 不去重。
- 收藏：事务内 `FOR KEY SHARE` 锁点位并验 `can_view` 后 `INSERT ... ON CONFLICT DO NOTHING`；
  取消收藏不要求点位存在。删除点位在 `FOR UPDATE` 后同事务删收藏/译文/点位，历史提案留存。
- 普通 PATCH 只记录 `base_marker_version`、完整提案字段与 `proposer_is_owner` 并返回未修改
  点位；`FOR SHARE` 锁定保证记录版本与文本基线一致；不可见 404。
- `resolveEditText` 对齐 Java：无文本字段不改语言；目标语言无有效译文时必须同时给标题与
  描述（空描述允许）；原文/人工译文共用 `marker.version`，原文变更使旧译文按 `source_hash`
  失效但不删除，`origin=MANUAL` 保留。
- 编辑审核固定顺序 proposal→marker：锁提案、`PENDING` 检查、锁点位、`base_marker_version`
  核对、更新点位/译文/提案状态与审核人时间后提交。NULL/旧版本 409 且仍 `PENDING`，重复处理
  400，两管理员竞争仅一人成功；直接管理员 approve/reject/PATCH 也推进 `version`。
- 缓存：`MarkerCache::invalidate` 增加与读路径一致的 500ms 超时（超时映射 Fred
  `ErrorKind::Timeout`），禁用时立即返回；提交成功后才失效，`Generation` 首次从 0→1。
  失效失败只做受控日志（不含 SQL/参数），绝不把已提交写入报告为失败。

核心 API（供下一次 HTTP 接入）：

- 用户：`create_marker`、`add_favorite`/`remove_favorite`、`delete_owned_marker`、
  `create_edit_proposal`、`list_created`、`favorite_ids`、`favorite_markers`。
- 管理员：`pending_markers`、`pending_edit_proposals`、`approve_marker`/`reject_marker`、
  `approve_edit_proposal`/`reject_edit_proposal`、`admin_update_marker`、`admin_delete_marker`、
  `list_all_markers`。所有管理员入口均检查 `Actor.is_admin`（二次验证留待 HTTP 层
  `VerifiedAdmin`，不在 `Actor` 上伪造）。
- 均接受显式 `request_language`（handler 由显式 `language` 字段/请求语言解析后传入），
  返回数据库最新 `MarkerRow` 或提案行，由 `MarkerService::localize` 生成响应。

验证记录（2026-09-14，本机，仅回环合成服务）：

```
powershell -NoProfile -File backend-rust/scripts/check-rust.ps1
```

结果：SQLx CLI 0.9.0 校验通过；合成开发库迁移成功；`cargo sqlx prepare --check` 通过；
`SQLX_OFFLINE=true cargo check --all-targets` 成功；`cargo fmt --all -- --check` 通过；
`cargo clippy --all-targets -- -D warnings` 零警告；`cargo test` **57** 个测试全部通过
（14 单元 + 9 基础集成 + 17 公开点位读取 + 17 写入/审核真实 PG/Redis 集成）。

写入集成覆盖：并发同 key 重放返回同 ID、字段/范围/长度/开放时间校验与 trim；已有 key 重放
先做最小必填检查与 key 归一，随后直接读回原点位（携带非法 category/单边开放时段也不被拒绝、
不改动原点位），缺必填仍 400；收藏幂等与 `owner/private/pending` 可见性；收藏与删除竞争无孤儿
收藏；非属主删除 403；删除级联收藏/译文且历史提案留存；普通 PATCH 只提案不改点位（含 base
版本、`proposer_is_owner`、无有效译文时必须标题+描述）；管理员待审列表与直接 approve/reject
推进版本；双管理员并发审核一次性；两个同基准提案（一原文一译文）竞争仅一个成功、另一个 409；
NULL/过期基准 409 且仍 `PENDING`；原文与译文编辑共用同一 `version`、过期 hash 回退且
`origin=MANUAL` 保留；测试库触发器强制译文写入失败后 marker 与 proposal 全部回滚；创建/收藏/
管理员读取的可见性与权限；缓存首次失效 0→1、幂等重放不改代次、Redis 不可用/禁用时写入仍提交
且耗时有界。

未完成（明确不在本次范围，交下一次 HTTP 接入）：所有点位与管理员 HTTP 路由、认证/会话、
`AppState`/config 装配、二次验证 `VerifiedAdmin`、图片上传/图片提案/cleanup；本次未写任何
绕过 HTTP 认证的假路由来声称全接口完成。


### 阶段 3：点位写入/收藏/审核 HTTP 接入（2026-09-14）

本改动在已验收的事务核心上接通 MarkerController 与 AdminMarkerController 的非图片路由，
共 **18** 条，并加一项真实权限修正。范围仅 `backend-rust/` 与 `docs/rust-migration`；
未改主工作树/其它工作树/Java/前端/服务器/恢复库/真实 uploads，未 commit/push。

- `src/modules/markers/write_http.rs`：薄 handler。身份只从
  `CurrentUser`/`AdminUser`/`VerifiedAdmin` 的 `Identity.user` 当前数据库行构造 `Actor`
  （`publicId`/`username`/`role`），绝不从请求体填 owner/admin。成功 `MarkerRow`/`Vec<MarkerRow>`
  一律经 `MarkerService::localize` 生成与读取接口同形的 23 字段响应并带语言 `Vary`；
  `pending-edits` 直接返回既有 18 字段 `EditProposalDto` 普通 JSON。写请求的编辑语言取
  body `language`（非 null 优先）否则 `localization::from_headers`；响应语言独立用
  `localization::for_read(query.lang, headers)`。
- 路由与权限：用户写/本人读取（`POST /api/markers`、`PATCH`/`DELETE /api/markers/{id}`、
  `POST`/`DELETE /api/markers/{id}/favorite`、`GET /api/markers/me/favorites`、`/me/created`、
  `/me/favorites/details`）用 `CurrentUser`；`GET /api/markers/all` 用 `AdminUser`
  （不二次验证）；`GET /api/admin/markers/{pending,pending-edits,all}`、
  `POST /api/admin/markers/{id}/{approve,reject}`、`PATCH`/`DELETE /api/admin/markers/{id}`、
  `POST /api/admin/markers/edit-proposals/{id}/{approve,reject}` 用 `VerifiedAdmin`。
  匿名 401 安全入口 JSON、缺角色 403 Boot JSON（带请求 path）、二次密码 403 纯文本、
  业务属主 403 纯文本均由既有提取器/`WriteError` 契约给出。无新增绕过来源校验的路由。
- 既有 `GET /api/markers/{id}` 接 `OptionalUser`：身份只从当前数据库账号构造 `Viewer`
  （管理员或属主可见私有/待审，匿名仍只读公开已审核），不新增路由，也不从请求参数伪造身份。
- `app.rs`：`AppState` 挂载 `MarkerWriteService`（与读取共用同一 `MarkerCache` 命名空间），
  `build_router` 合并 `write_http::router()`。`http.rs` 的 `json_marker(s)`/`with_vary`
  改为 `pub(super)` 供复用，未复制第二套本地化。
- 安全兼容收紧：新建点位 `markImage` 只接受 `null`/空白（空白归一为 `null`），非空一律
  400 `markImage 只能为空，请通过图片上传提交`。检查落在事务核心**首次完整验证**处，
  因此不能从其它入口绕过；`clientRequestId` 幂等重放仍先返回原点位，历史引用不迁移。
  `api-contract.md`/`api-contract.json` 已记录。该收紧只影响新建，两个现网客户端新建均传
  空串/`null`。

验证记录（2026-09-14，本机，仅回环合成服务）：

```
powershell -NoProfile -File backend-rust/scripts/check-rust.ps1
```

`tests/markers_http.rs` 用真实 Router、真实 `/api/login` 会话 Cookie 与 UUID 临时
PG/Redis 覆盖：18 条路由的匿名/普通用户/管理员未二次/管理员二次权限矩阵与错误形状；
完整 `create → owner 私有可见(me/created) → admin approve → 匿名可见 → favorite/list/unfavorite
→ ordinary PATCH 只提案 → pending-edits → approve/reject → ?lang=en 译文详情 → admin PATCH
使旧译文失效回退 → owner/admin delete`；两条同基准提案的 HTTP 并发审核
（一人 200、一人 409）；非空 `markImage` 不落点、`null`/空串/空白接受且幂等重放不被重放载荷
影响，并在核心层直接断言拒绝（不限 handler）。每个用例只清理自己的 UUID 临时库。

结果：SQLx CLI 0.9.0 校验通过；`cargo sqlx prepare --check` 通过；`SQLX_OFFLINE=true
cargo check --all-targets` 成功；`cargo fmt --all -- --check` 通过；`cargo clippy
--all-targets -- -D warnings` 零警告；`cargo test` **143** 个测试全部通过、0 失败 0 跳过：
41 单元 + 28 认证 + 9 基础集成 + **7 点位 HTTP 接入（新增）** + 17 公开读取 + 17 写入事务 +
16 媒体存储 + 8 媒体业务（本工作树已含已验收媒体模块，故总数高于写入核心单项的 57）。
只新增 `tests/markers_http.rs`，未改动既有写入/读取/认证/媒体测试。

未完成（明确不在本次范围，交温晓合并验收）：`POST /api/markers/{id}/image` 及
AdminMarkerController 的 4 条媒体路由、头像 3 路由由主分支另做；本次未临时 mock 它们。

温晓第一轮审查返工（2026-09-14，同一工作树，未提交）：

1. **JSON 请求体读取边界**：认证继续 64 KiB；点位创建、普通 PATCH、管理员 PATCH 改用全局
   8 MiB，`description`（PG `text`）不再被认证的小请求上限顺带收紧。`web::JsonBody` 与
   新增 `web::MarkerJsonBody` 共用唯一有界读取实现 `read_json_body`，未复制解析代码。
   非 JSON 媒体类型 415 纯文本、解析失败 400 纯文本；超限 413 统一
   `ApiResponse{code:413,message:"上传文件过大，请选择 5MB 以内的图片",data:null}`；其它底层
   读取失败沿错误源链区分，只有真正 `http_body_util::LengthLimitError` 才判超限，否则 400
   纯文本。为此把已在传递依赖中的 `http-body-util = 0.1.5` 提升为直接依赖（仅为识别该错误）。
   注：全局 `RequestBodyLimitLayer` 对带 `Content-Length` 的超限请求会先返回其自带 413，
   该全局包装由主分支阶段 2 统一处理，合并后复核；提取器层的统一 413 覆盖无
   `Content-Length` 与 64 KiB 认证边界。新增真实 Router 断言：>64 KiB 且 <8 MiB 的合法
   `description` 在创建/普通 PATCH/管理员 PATCH 均成功、非法 JSON 400、非 JSON 类型 415、
   >8 MiB 413 统一文案。
2. **编辑提案 DTO 字段**：以 Java `pendingEditProposals` 为准，客户端响应为 **18 字段**；
   内部行含 `baseMarkerVersion` 属第 19 个内部字段，**不**泄露给客户端。测试直接断言
   `pending-edits` 响应字段集合恰为 18 个，`baseMarkerVersion` 经数据库断言仅用于审核语义。
   温晓初始指令中的“19 字段”为计数错误，不为凑数新增字段。
3. **markImage 核心规则**：`create_marker` 首次完整校验处覆盖 `null`/空串/空白（归一为
   `null`）与非空恶意 URL 拒绝，HTTP 与服务层各验一次；非空请求不落点（HTTP 断言
   `me/created` 为空并核对数据库无该标题行），已有 `clientRequestId` 幂等重放即使重传非空
   `markImage` 仍先返回旧点位，按已确认重放优先语义。

返工后复跑完整门禁：SQLx CLI 0.9.0 校验、`cargo sqlx prepare --check`、`SQLX_OFFLINE=true
cargo check --all-targets`、`cargo fmt --all -- --check`、`cargo clippy --all-targets -D warnings`
全部通过；`cargo test` **144** 个测试通过、0 失败 0 跳过（41 单元 + 28 认证 + 9 基础 +
**8 点位 HTTP（新增 1）** + 17 公开读取 + 17 写入事务 + 16 媒体存储 + 8 媒体业务）。

### 阶段 3：点位写入/收藏/审核 HTTP 与主工作树整合（2026-09-14，主工作树 `refactor/rust-backend`）

温晓把写入核心 `d1aa643` 与 18 条 HTTP `c5dc2bf` cherry-pick 到主工作树后，冲突与适配留在
主工作树完成（本改动**不** `add`/`commit`/`continue`/`push`，待温晓检查后收尾）。范围仅
`backend-rust/` 与 `docs/rust-migration/`；未改 Java/前端/服务器/恢复库/真实 uploads/备份。

冲突解决与整合要点：

- **Cargo**：保留阶段 2 的 `tokio-util`（`io`，`ReaderStream` 流式响应）与已有的
  `http-body-util = 0.1.5`（识别 `LengthLimitError`）；`Cargo.lock` 保留 `futures-util`
  （读取失败 400 测试用 dev-dependency），去掉重复的 `http-body-util` 声明。
  `cargo sqlx prepare` 正常生成离线元数据。
- **`web.rs`**：丢弃重复的 JSON 解析实现，认证 64 KiB（`web::JsonBody`）与点位写 8 MiB
  （`web::MarkerJsonBody`）共用唯一 `read_json_body`；非 JSON 媒体类型 415、底层非超限读取
  失败 400（不误报 413）、反序列化失败 400。超限只认真正的 `http_body_util::LengthLimitError`，
  JSON 与 multipart 复用唯一的 `web::is_length_limit_error`；413 统一走
  `multipart::payload_too_large_response`（同一文案/响应）。保留头像 `stream_image`。
- **`app.rs`**：保留阶段 2 的 `ImageStore`/`MediaService`、`Config.media_max_concurrency`、
  `AppState::new -> Result<Self, AppError>`（`main` 用 `?`）与全局 `RequestBodyLimit` +
  `DefaultBodyLimit`、CORS 最外层与 `normalize_payload_too_large` 统一 413。新增
  `MarkerWriteService`，read/write/media 三个服务**共用同一个 `MarkerCache`**（同一命名空间），
  不为三者建不一致缓存。
- **`markers/http.rs`**：保留 `OptionalUser` 真实身份（管理员/属主可见私有待审，匿名仅公开
  已审核，`404` 空体），`json_marker`/`json_markers`/`with_vary` 以 `pub(super)` 供
  `write_http` 复用，未退回匿名 `None`。18 条写路由、`markImage` 首次空值限制、普通 PATCH
  只建提案、`VerifiedAdmin` 审核等均保留。
- **测试**：`tests/markers_http.rs` 的 `Env` 新增自有 `TempDir` 上传根并持有到整个 `Env`
  生命周期，绝不用默认真实 `uploads/`，也不在构造后立即 drop 再交给 router。另一个独立
  工作树负责剩余 5 条图片 HTTP，本任务不重复这些路由。

验证记录（2026-09-14，本机，仅回环合成服务；与图片 HTTP 工作树并行，`RUST_TEST_THREADS=2`）：

```
powershell -NoProfile -File backend-rust/scripts/check-rust.ps1   # 前置设置 RUST_TEST_THREADS=2
```

结果：SQLx CLI 0.9.0 校验通过；合成开发库迁移成功；
`cargo sqlx prepare --check -- --all-targets` 通过（`.sqlx` 正常生成）；
`SQLX_OFFLINE=true cargo check --all-targets` 成功；`cargo fmt --all -- --check` 通过；
`cargo clippy --all-targets -- -D warnings` 零警告；`cargo test` **154** 个测试通过、
0 失败 0 跳过（42 单元 + 28 认证 + 9 基础集成 + 8 点位 HTTP + 17 公开读取 + 17 写入事务 +
16 媒体存储 + 8 媒体业务 + 9 媒体 HTTP）。仅清理各自用例的 UUID 临时库，未枚举或 drop
其它数据库。

阶段 3 的**最终完成状态**仍由温晓验收后更新：`POST /api/markers/{id}/image` 与
AdminMarkerController 的 4 条媒体路由由另一独立工作树接入，本层不宣称 43 接口全部完成。

### 补齐：请求日志的请求 ID、span 与响应关联头（2026-09-14，主工作树）

小范围补齐 `docs/rust-backend-plan.md` 第 6 节「日志包含请求 ID、路由、耗时、状态」中缺失的
请求 ID。仅改 `backend-rust/src/app.rs`、`backend-rust/tests/media_http.rs` 与本文件/README；
未接入最后 5 条图片路由，未改其它功能，未 commit/push。

- `app.rs::log_requests` 为每个请求由**服务端**生成新的 UUID 请求 ID，放入 `tracing` span
  （字段 `request_id`/`method`/`route`），用 `tracing::Instrument` 让 handler 与下游受控日志
  都落在该 span 内；完成事件记录状态与耗时。**不**记录原始 URI/query、Cookie 或请求体，
  也**不**信任/回显客户端传入的 `X-Request-ID`。
- 日志层移到最外层（包住 CORS）后，普通成功、404 fallback 与全局 body limit 413 都得到
  请求 ID 与完成日志；`MatchedPath` 缺失时用固定占位 `<unmatched>`，不记录真实 URI。
  CORS 仍包住所有错误来源，故允许来源的错误响应都带跨域头；`build_cors` 增加
  `expose_headers([x-request-id])`，允许来源可在浏览器读取关联头。每个响应统一附
  `X-Request-ID`。
- 未引入新 crate（复用已有 `uuid`/`tracing`），未加入追踪平台或通用框架；未破坏已验收的
  Source/Origin、`RequestBodyLimit`+`DefaultBodyLimit`、统一 413 与媒体流式响应。
- 新增集成用例 `tests/media_http.rs::responses_carry_server_generated_request_id`：成功、404、
  413 各自返回合法且互不相同的 `X-Request-ID`，客户端伪造 ID 不被照搬，允许来源可通过
  `Access-Control-Expose-Headers` 读取该头；复用既有 `TestEnv`（临时上传根，不写真实 uploads）。

验证（2026-09-14，本机，仅回环合成服务；与图片 HTTP 工作树并行，`RUST_TEST_THREADS=2`）：
SQLx CLI 0.9.0 校验通过；`cargo sqlx prepare --check -- --all-targets` 通过；
`SQLX_OFFLINE=true cargo check --all-targets` 成功；`cargo fmt --all -- --check` 通过；
`cargo clippy --all-targets -- -D warnings` 零警告；`cargo test` **155** 个测试通过、
0 失败 0 跳过（42 单元 + 28 认证 + 9 基础集成 + 8 点位 HTTP + 17 公开读取 + 17 写入事务 +
16 媒体存储 + 8 媒体业务 + 10 媒体 HTTP，其中媒体 HTTP 新增 1 条）。

### 阶段 3：点位图片 HTTP 与主工作树最终集成（2026-09-14，主工作树 `refactor/rust-backend`）

温晓把图片 HTTP `6deb394` cherry-pick 到主工作树，4 处冲突的最终集成由本工作树完成（**不**
`add`/`commit`/`continue`/`push`，待温晓验收提交）。范围仅 `backend-rust/` 与
`docs/rust-migration/`；未改 Java/前端/服务器/恢复库/真实 uploads/备份。

冲突解决与整合要点：

- **`markers/http.rs`**：`json_marker` 保持 `pub(crate)`（供 `routes::admin_markers` 复用），
  `json_markers`/`with_vary` 保持 `pub(super)`（供 `write_http` 复用）；保留 `OptionalUser`
  真实身份与新增 `POST /api/markers/{id}/image`，18 条写接口仍全部挂载。
- **`markers/service.rs`**：同时保留写核心的 `localize(Vec<MarkerRow>, lang)` 与图片模块的
  `localize_row(row, lang)`，二者共用原有 `localize_rows` 批量本地化，译文加载/回退规则只有
  一份，无重复 SQL 或规则。
- **`tests/media_http.rs`**：合并两侧测试，保留请求 ID 新测试与图片 HTTP 的 7 项测试；沿用
  图片侧 `TestEnv`（独立 `TempDir` 上传根 + `ADMIN_SECOND_PASSWORD_HASH` 二次验证哈希），
  未删除任何测试来过门禁。
- **`README`**：整理为 **43 个既有契约模板全部挂载**（`/uploads` 两个具体路由合计
  UploadController 的 1 个模板；`/health/live`、`/health/ready` 两个探针另列），保留认证/写入/
  媒体/请求 ID 与错误边界；更新顶部及 `app.rs`、`check-rust.ps1` 顶部滞后的阶段 1/2 注释。

必须保留的已验收设计均在位：`AppState::new -> Result`，read/write/media 共用同一 `MarkerCache`；
64 KiB 认证 JSON / 8 MiB 点位 JSON；全局 8 MiB 与每文件 5 MiB、`LengthLimit` 源链识别、统一 413/CORS；
最外层服务端 UUID 请求 ID（忽略客户端值，响应 `X-Request-ID`）；图片流式读取与权限；脚本严格目标
保护；所有权/审核锁与版本冲突；首次新建非空 `markImage` 拒绝。

验证记录（2026-09-14，本机，仅回环合成服务，`RUST_TEST_THREADS=4`）：

```
powershell -NoProfile -File backend-rust/scripts/check-rust.ps1
```

结果：SQLx CLI 0.9.0 校验通过；合成开发库迁移成功；
`cargo sqlx prepare --check -- --all-targets` 通过；`SQLX_OFFLINE=true cargo check --all-targets`
成功；`cargo fmt --all -- --check` 通过；`cargo clippy --all-targets -- -D warnings` 零警告；
`cargo test` **162** 个测试通过、0 失败 0 跳过（42 单元 + 28 认证 + 9 基础集成 + 8 点位 HTTP +
17 公开读取 + 17 写入事务 + 16 媒体存储 + 8 媒体业务 + 17 媒体 HTTP）。仅清理各自用例的 UUID
临时库，未枚举或删除其它数据库。阶段 3 最终接受状态由温晓收尾。

### 阶段 4：已有库基线接管与只读预检（2026-09-14，`work/rust-adoption-20260914`）

在阶段 3 交付 `bbca95f` 的隔离工作树上实现显式基线接管入口。范围仅 `backend-rust/` 与
`docs/rust-migration/`；未改 `migrations/0001_baseline.sql` 任何字节，未新增迁移，未访问服务
器/`lycoris-restore-review`/备份/真实数据，未 commit/push。只连接回环合成 PG 55432 / Redis 56379，
每个用例自建 UUID 临时库。

设计与边界：

- **CLI**：`src/cli.rs` 显式解析 `--migrate`、`--check-baseline`、`--adopt-baseline`，三者互斥；
  未知参数或多余位置参数直接报错退出，绝不静默进入服务；无参数仍为普通启动。`--help` 打印用法。
- **普通启动**仍只调用 `verify_applied` 只读校验。`--migrate` 保留 SQLx 迁移，并新增守卫
  `needs_adoption`：当基线业务表已存在而基线尚未登记时返回 `ExistingSchemaNeedsAdoption`，
  提示改用接管，不以初始建表强行作用于已有库。
- **结构期望**以代码定义（`src/baseline/expected.rs`）逐项对应已审查基线：6 张表 80 列的类型/
  长度/空值/默认值/identity、主键/唯一/外键约束与名称、identity 序列定义与归属、PostGIS、
  `current_schema()=public` 且 `search_path` 含 public，以及 SQLx `_sqlx_migrations` 的列格式。
  另核对对象 `relkind`（只接受普通表，拒绝视图/物化视图/外部表/分区表/序列）、列不可为生成列
  （`attgenerated`）、约束 `convalidated`/`condeferrable` 及 PK/唯一约束索引有效且唯一。
  `check_baseline`/`adopt` 只读系统目录核对，**不在目标库执行基线 DDL 来比较**。缺列/多列/错类型/
  错长度/错默认值/改 identity/生成列/缺唯一或外键/未验证或可延迟约束/缺序列/缺扩展/schema 非
  public/额外 p·u·f 约束/索引不可用均按对象名与属性报告；额外无关表（如运维表）允许，不检查
  额外非唯一性能索引。
- **PG 目录归一**：NOT NULL 以 `information_schema.is_nullable` 判定，不把 PG 18 新增的 `pg_constraint`
  NOT NULL（contype `n`）计入约束集合；时间列以 `datetime_precision=6` 比较，归一
  `timestamp with time zone` 与 `timestamp(6) with time zone` 的文本差异。
- **接管原子性（温晓第一轮验收返工）**：`src/baseline/adopt.rs` 从池中 `detach` 出**独占
  `PgConnection`**（不把 session state 交回池），用 SQLx 自己的 `Migrate::lock`（与 `--migrate`
  同一把数据库名 CRC 生成的 `pg_advisory_lock`）串行化，先保存并设置短 `lock_timeout`（默认 5s）。
  随后在**单个事务**内：确认六对象存在且为普通表 → 按固定名称顺序 `LOCK TABLE … IN SHARE MODE`
  （阻断外部 DDL 与写入，锁等待同样受 `lock_timeout` 约束，超时 `LockUnavailable` 明确退出）→
  只读核对结构/计数 → `ensure_migrations_table` → `dirty_version`/`list_applied_migrations` 校验
  失败/未知/校验和 → 基线未登记时用 SQLx `skip` 只插入**真实基线校验和**（已核对 `skip` 源码为
  单条 `INSERT`，不自行开事务或 savepoint，故直接参与本事务）。结构、历史建表与登记同事务提交，
  任一步失败整体回滚，不留下新历史表或半条记录；已登记且一致则幂等确认。任务取消/超时 drop
  future 会关闭独占连接、释放会话 advisory lock，不把锁带回池；正常路径恢复原 `lock_timeout`
  后主动 `close`。任何不匹配历史（失败、未知、校验和、历史表格式）均拒绝且不改写。只登记基线
  版本（当前 1），未来迁移（如阶段 5 的 0002）保持未登记，需显式 `--migrate` 升级；接管明确仅
  适用于原始基线，未知结构或未知迁移不会被静默接受。
- **只读预检**：`--check-baseline` 在单个 `REPEATABLE READ READ ONLY` 快照内核对结构/历史/计数，
  不调用 `ensure_migrations_table`，不创建 `_sqlx_migrations`；缺表时返回含 `MissingTable` 的
  可读结构报告，计数安全归零而非报数据库错误。额外聚合发布决策计数：重复有效用户名组数、重复
  规范化邮箱组数、不合法经纬度行数，并单独识别 NaN 与 Infinity。只输出计数与对象名/属性，不输出
  身份值或行值，不自动加唯一索引、不合并账号。
- **运行前提（仅记录，不实现线上操作）**：接管应在备份完成后、业务写入冻结或明确切换窗口内执行；
  接管在短窗口内以 SHARE 锁阻断业务表写入，但仍应在可回退窗口内进行，并在接管后用
  `--check-baseline` 留档；生产切换、数据导出/恢复与冻结窗口操作不在本工作树实现。

验证记录（2026-09-14，本机，仅回环合成服务，`RUST_TEST_THREADS=2`）：

```
powershell -NoProfile -Command "$env:RUST_TEST_THREADS='2'; & backend-rust/scripts/check-rust.ps1"
```

结果：SQLx CLI 0.9.0 校验通过；合成开发库迁移成功；`cargo sqlx prepare --check -- --all-targets`
通过；`SQLX_OFFLINE=true cargo check --all-targets` 成功；`cargo fmt --all -- --check` 通过；
`cargo clippy --all-targets -- -D warnings` 零警告；第一轮返工的 `cargo test` **189** 个测试通过、0 失败 0 跳过
（46 单元 + 28 认证 + 9 基础集成 + 23 基线接管 + 8 点位 HTTP + 17 公开读取 + 17 写入事务 +
16 媒体存储 + 8 媒体业务 + 17 媒体 HTTP）。新增 4 个 CLI 单元测试与 `tests/baseline_adoption.rs`
的 25 项真实 PG 集成：非空 Java 形状库接管后旧行/序列不变且新插入 ID 延续、正确库重复接管幂等、
空库/缺列/错类型/错默认值/缺唯一/缺外键/改 identity/多列/缺表/同名视图/生成列/未验证或可延迟
约束逐项拒绝、错误校验和/未知/失败历史拒绝且无改写、并发接管单一历史记录、迁移锁超时与业务表
被独占锁时 `LockUnavailable` 且不部分登记、SHARE 锁确实阻断写入与 DDL、登记插入被触发器拒绝
后事务回滚不留半条记录、**新建历史表在登记失败时随事务回滚且业务行/序列不变**、取消已获迁移锁
的接管后另一连接可重新获锁且连接池可用、只读预检在 `REPEATABLE READ READ ONLY` 快照内不建历史
表并报告重复账号组与 NaN/Infinity 计数、**结构不兼容时计数标记为未执行而非以 0 冒充**、缺表返回
可读报告、`--migrate` 对已有业务表拒绝并指向接管、额外运维表不阻止接管、自定义迁移集合证明不
登记未来迁移、CLI 三个命令与未知/互斥参数退出码。现有 162 项行为保持不变；每个用例只清理自己
的 UUID 临时库，未枚举或删除其它数据库。

温晓第二轮收尾（同工作树，未提交）：

- `MigrationError::Execute` 的 `Display` 改为固定摘要“迁移执行失败”，保留 `#[from]`/`#[source]`
  供程序取用，不再经 main 日志内联 SQLx 驱动报错；接管结束的 unlock/close 失败日志也只给固定
  摘要，不格式化 driver 错误。
- “已登记基线”日志移到事务 `commit` 成功之后，避免提交失败却先报告完成。
- 新增 `check_baseline_marks_counts_unavailable_on_incompatible_columns`：列缺失/类型不符时先
  返回结构 diff；`BaselineReport` 增加 `counts_available`，未真正执行计数时明确标记，0 仅占位。
- 新增 `new_history_table_rolls_back_when_registration_fails`：无历史表 + 不含基线版本的自定义
  Migrator，在 `ensure_migrations_table` 之后确定性失败，断言 `_sqlx_migrations` 不存在且业务
  行/序列不变。

### 阶段 4：Linux 发布基础（2026-09-14，工作树 `work/rust-release-20260914`，起点 `d780e58`）

本改动实现阶段 4 第 1 项：可复现的 Linux release 容器与可实际执行的 Linux 验收入口。范围仅
`backend-rust/` 与 `docs/rust-migration/`；未改 Java/前端/服务器/生产备份/真实 uploads，未
`add`/`commit`/`push`。未操作 `lycoris-restore-review`、roboparty 或恢复库；Docker 仅操作
`lycoris-rust-release*` 前缀的项目、容器、网络与卷。

新增/修改：

- `backend-rust/Dockerfile`：四阶段 `source`/`builder`/`test`/`runtime`。builder 固定
  `rust:1.98.1-slim-trixie` + `SQLX_OFFLINE=true` + `cargo build --release --locked --bin` +
  `CARGO_BUILD_JOBS=2`；runtime 基于 `debian:trixie-slim`，`USER 10001:10001`，只复制 release
  二进制与系统 CA；`[profile.release] strip = true`，不启用 `panic=abort`、不设 `target-cpu=native`。
- `backend-rust/.dockerignore`：排除 `uploads/`、`.env`、`target/`、备份与仓库元数据。
- `backend-rust/src/healthcheck.rs`（新）：`--healthcheck [path]` 标准库 HTTP 探针。**只取首个 `LF`
  之前**的状态行（要求状态行完整结束），版本严格 `HTTP/1.0|HTTP/1.1` + 3 位状态码，2xx 才通过；
  状态行之后的二进制响应体不参与 UTF-8 解析；连接、写、读共用同一 3s deadline（写超时取剩余时间）；
  可选路径拒绝空白/控制符与超长并补前导 `/`；非法 `SERVER_PORT` 直接失败、不静默回落；含 9 项纯本地 TCP 单测。
- `backend-rust/src/main.rs` / `src/lib.rs`：在装配配置前处理 `--healthcheck`，保持独立、不侵入迁移。
- `backend-rust/scripts/run-linux-tests.sh`（新）：容器内 Linux 测试运行器，顺序
  `cargo fmt --all -- --check` → `SQLX_OFFLINE=true cargo check --all-targets --locked` →
  `cargo clippy --all-targets --locked -- -D warnings` → `cargo test --locked`。**固定合成 fixture 安全
  边界**：监听 `127.0.0.1:55432/:56379`、上游 `host.docker.internal:55432/:56379`、测试 URL 固定回环，
  任何其它 host/port/query/监听/URL 覆写在**任何网络访问与 DDL 之前**失败；`RUST_TEST_THREADS`/
  `CARGO_BUILD_JOBS` 只接受 1 或 2（未设置默认 2，拒绝 0/非法/超出）；`--check-config` 只做校验。
- `backend-rust/scripts/tcp-forward.rs`（新）：仅标准库 TCP 回环转发器（`rustc -O` 编译，无 apt）。
  转发器**自身强制**回环监听与固定上游（`host.docker.internal` 的 55432/56379，端口须一致）。
- `backend-rust/scripts/test-runner-guards.sh`（新）：边界小测试，用 `--check-config` 与非法转发器
  配置证明非法上游/监听/并发在任何网络或 DDL 前失败。
- `backend-rust/compose.release.yml`（新）：本地演练，`read_only`、`tmpfs /tmp`、`cap_drop ALL`、
  `no-new-privileges`、上传命名卷、回环端口 `127.0.0.1:18091`；仅复用合成 PG55432/Redis56379。
  test 服务挂载本项目专用增量缓存卷 `lycoris-rust-release-test-target` 与
  `lycoris-rust-release-test-cargo-registry`（不与其它工作树共享 target/registry）。
- `backend-rust/scripts/verify-release-linux.py`（新）：宿主侧运行验证。执行任何 compose/`--migrate`
  前先校验目标只指向合成 fixture（无 query/fragment/覆写）；负向前确认镜像与依赖就绪并要求失败原因
  匹配上传目录不可写；默认只 `down` 保留卷，`--remove-test-volumes` 才删精确自有卷；错误脱敏；
  可写 JSON 证据。

镜像 digest（温晓经官方 registry Bearer manifest 核对；Dockerfile/compose 默认 `tag@digest`，
受限网络用同 digest 镜像站覆盖）：

| 镜像 | 官方 manifest digest | linux/amd64 |
| --- | --- | --- |
| `rust:1.98.1-slim-trixie` | `sha256:ce84a5edd80c5f91e05c5533b1e53eb1da54028f33734dc06aa6b49fa190462d` | `sha256:a2de23e559fd8afd260d22beb00f3987073ea0dcc2ba2646cccdaeda6a62a095` |
| `debian:trixie-slim` | `sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132` | `sha256:abc9cb88a5587630d7f915f47b23b0668fe250fbfc6457aa4d52b534c1bbf73f` |

来源：官方 registry 公共 manifest 经 SHA256 核对；BuildKit 在受限网络下对镜像站直接 HEAD 会
回 401（不代表不存在），本次实际构建以本地已按 digest 缓存的镜像完成，未使用旧镜像冒充。

早期构建与测试（2026-09-14 第一轮，Windows Docker Desktop，Linux 容器；仅回环合成服务；
旧记录，已被下方“整合后最终发布验收”取代，保留作历史）：

```
docker compose -f backend-rust/compose.release.yml build app test
docker compose -f backend-rust/compose.release.yml run --rm test
docker compose -f backend-rust/compose.release.yml run --rm --entrypoint bash test \
  /app/scripts/test-runner-guards.sh
python backend-rust/scripts/verify-release-linux.py --build --test-count 171 \
  --evidence docs/rust-migration/release-linux-evidence.json
```

结果：

- release 构建：`cargo build --release --locked` 成功（首轮约 5m34s，`CARGO_BUILD_JOBS=2`）；
  runtime 镜像 `Config.User=10001:10001`、ENTRYPOINT 为二进制、`HEALTHCHECK` 为 `--healthcheck`。
  本轮 app 镜像 `sha256:5d2fcb91a50a17e1b92337e154eb188fbd49ec684b4c06a3452805cd68cfc893`，
  release 二进制 `sha256:6b31407c7424deaaa7d416b91e703cbd9ef81e024a73df03743ae5463cd7da1d`。
- 运行器边界 guard：`test-runner-guards.sh` 15 项全部通过（非法上游/带 query/其它端口/非回环监听/
  测试 URL 覆写、线程 0/3/abc、非法 `CARGO_BUILD_JOBS`、转发器三类非法配置，均在网络/DDL 前失败）。
- Linux 全量测试：**171** 项通过、0 失败 0 跳过（**51** 单元含 **9** 项健康检查 + 28 认证 +
  9 基础集成 + 8 点位 HTTP + 17 公开读取 + 17 写入事务 + 16 媒体存储 + 8 媒体业务 + 17 媒体 HTTP），
  `RUST_TEST_THREADS=2`；`cargo fmt`、离线 `cargo check --all-targets`、`cargo clippy -D warnings` 均通过。
  复跑验证增量缓存：第二次 `cargo check`/`clippy`/`test` 分别 0.40s/0.25s/0.38s（无重编译）。
  记录一次复跑偶发失败并定位（2026-09-14）：第二次全量中
  `migrate_cli_applies_baseline_to_empty_database` 失败，断言位于 `tests/integration.rs:275`
  且只打印子进程 **stderr**；而 `lycoris-backend` 的 tracing 默认写 **stdout**，故错误正文未显示。
  定位证据：用已构建的 release 二进制对 5 个全新合成库直接执行 `--migrate`，**5/5 退出码 0**，
  日志均为 `配置加载完成` → `迁移完成`（每个约 0.8s）；SQLx 0.9.0 的 Postgres migrator 加锁为
  `SELECT pg_advisory_lock($1)`（源码注释明确“不会返回直到获得锁”），且锁 id 由**当前数据库名**
  CRC 生成（`sqlx-postgres-0.9.0/src/migrate.rs`），因此跨库并发不会互斥、锁等待只会阻塞而不会
  快速失败。这些证据不能确定该次非零退出的根因，也不足以排除产品缺陷。失败时另一工作树
  `rehearsal-*` 栈正在运行，集成套件耗时 30.28s（正常约 5s），资源或连接争用是待验证的解释。
  宿主物理内存约 16 GiB、Docker VM 配额 8 GiB，合成 PG 限额 1 GiB。5 次直连未复现，第三次
  全量 171/171 通过。整合验收将串行跑完整门禁，并补齐失败时子进程 stdout/stderr 诊断。
- 运行验证（`scripts/verify-release-linux.py --build --test-count 171 --evidence …`）：目标校验通过；
  容器 `healthy`；`/health/ready` 与 `/api/markers/public` 探针通过；`uid=10001 gid=10001`；
  只读根不可写、上传卷可写；`stop`（SIGTERM）后退出码 0；重启后停机前写入的上传文件仍可读；
  负向（只读根且 `UPLOAD_DIR` 不可创建）退出码 1，原因匹配 `无法准备上传根目录`。
  JSON 证据：`docs/rust-migration/release-linux-evidence.json`。
- runtime 镜像内容核对：无 `/app`、无 `target/`、无 `.env`，`/var/lib/lycoris/uploads` 属主为
  `lycoris:lycoris`（10001:10001）。

温晓独立复跑：第三轮 Python 边界测试 10/10 通过，随后运行发布验收工具，无重建、无人工填写
测试计数；健康探针、非 root/只读根、持久卷写入及重启保留、SIGTERM 0、不可写目录负向原因均
通过。独立 JSON 保存在本地任务 `work/stage4-release-independent.json`，阶段最终归档时收录。

#### 整合后最终发布验收（2026-09-14；发布基础 / 运行参数 / 入口 CLI 整合后）

```
docker compose -f backend-rust/compose.release.yml build app negative test
docker compose -f backend-rust/compose.release.yml run --rm test
python backend-rust/scripts/verify-release-linux.py \
  --evidence docs/rust-migration/release-linux-evidence.json --test-count 216
```

- Linux 全量：**216** 项通过、0 失败 0 跳过（61 单元含 9 项健康检查 + 28 认证 + 28 基线与 CLI +
  5 数据库运行参数 + 11 基础集成 + 8 点位 HTTP + 17 公开读取 + 17 写入事务 + 16 媒体存储 +
  8 媒体业务 + 17 媒体 HTTP）；`cargo fmt`、离线 `cargo check --all-targets`、
  `cargo clippy -D warnings` 均通过；`RUST_TEST_THREADS=2`/`CARGO_BUILD_JOBS=2`，单次串行，无重跑掩盖。
- 最终 app 镜像 `sha256:51776d6b…`（linux/amd64），release 二进制 `sha256:1be6aa15…`；稳定本机标签由
  标准命令添加：`docker tag lycoris-rust-release-app:local lycoris-rust-stage4:local`。
- 运行验收：guard、`--migrate`（仅合成 `lycoris_rust`）、只读根/cap_drop ALL/no-new-privileges/
  tmpfs、非 root、`--healthcheck`（ready 与 public read）、上传卷写读与重启持久、SIGTERM 退出 0、
  负向退出 1 且原因 `无法准备上传根目录` 均通过；默认保留上传/测试缓存卷。
- 边界：以上仅为本地 Linux 合成环境验收，**不代表阶段 4 全部完成或生产已部署**；真实前后端流程、
  性能测量、切换/回退与生产切流另行记录。

剩余项/边界：

- Linux 侧仅执行离线 SQLx 编译与全部 `cargo test`；SQLx CLI 0.9.0 的**在线**元数据
  `cargo sqlx prepare --check` 仍由 Windows `check-rust.ps1` 门禁补充。
- `compose.release.yml` 为本地演练，不是正式生产配置；生产卷授权、TMPDIR、密钥与迁移策略另定。
- 已有库接管、PG 大版本升级、性能测量属阶段 4 其它子项，不在本记录范围。

### 阶段 4 发布入口整合验收

发布基础与基线接管合并后，命令行由同一解析器分发；健康检查不再通过扫描参数绕过互斥检查。
苏瑶完成 `--healthcheck [path]`、重复/冲突/多余参数测试，并为迁移 CLI 失败增加退出码及
stdout/stderr 诊断。无数据库配置时帮助和探针均按各自模式工作。苏瑶实测：57 项单元、9 项基础
集成、28 项基线接管（含新增 3 项二进制命令测试）通过，fmt/clippy/离线 check 通过。
温晓独立复跑 6 项 CLI 单元及 2 项二进制健康检查用例通过；该轮未重复整套门禁，待运行参数整合。

## 备注

### 阶段 5 最终发布（2026-09-14）

版本锁定与阶段 4 相同。整合 `0002_spatial`、空间查询和 SQLx 元数据后，以相同 Linux 构建流程
生成 `lycoris-rust-stage5:local`，imageId
`sha256:d074e39c56769dd4fb5878d14592183552de9d7567b490f22b5a5b1179dc4664`，
binary SHA-256 `ea8deb49f67552ffd944821863435bf74884a68dab43e5a9b3f6926fea61c417`。
阶段 4 稳定标签 `lycoris-rust-stage4:local` 与镜像保持原值。

Windows 在线 SQLx `prepare --check`、fmt、离线 check、Clippy 通过；Linux 单次全套
**223 项通过，0 失败、0 跳过**，新增空间查询 5 项和迁移 2 项。非 root、只读根、受控临时目录、
上传卷、健康检查、SIGTERM 0 和不可写目录负向均通过；温晓独立真实 TCP 64/64、43/43 接口模板
通过。原始运行证据为 [stage5-release-linux-evidence.json](stage5-release-linux-evidence.json)，
完整验收与范围见 [阶段 5 记录](stage5-spatial.md)。工具与文档的后续提交没有修改产品二进制。

### 较早的阶段 4 检查记录

第二轮收尾后新增 2 项，测试集合共 191 项；该轮按改动范围复跑基线接管 25 项和基础迁移 9 项，
并通过 fmt/clippy，没有把未重跑的完整集合记为一次全量通过。温晓独立复跑相同 34 项全部通过，
另对最新合成 PG17.11 来源库和 PG18.6 升级库执行 `--check-baseline`，两者均通过且未创建迁移历史。

`lycoris-restore-review` 容器属温晓的私有恢复验收环境，不在本次范围。本阶段仅新建并操作 `lycoris-rust-postgres`、`lycoris-rust-redis`。
