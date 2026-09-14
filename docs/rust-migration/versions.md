# 版本基线与数据来源

记录时间：2026-09-14（Asia/Shanghai）。以下区分「候选」与「已运行/已安装」：
候选仅为查证结果，未编译、未运行；已运行表示本机隔离环境实际启动并通过检查。

## 工具链与宿主

| 项目 | 版本 | 状态 | 说明 |
| --- | --- | --- | --- |
| Rust toolchain | 1.98.1 | 已安装 | 温晓通过官方 rustup 安装，含 rustfmt、Clippy；后续用精确 toolchain，不改用户默认 |
| Docker Desktop | 29.3.1 | 已安装 | 仅作宿主测试工具，不是本轮部署目标 |

来源：`rustup show`、官方 rust-lang.org 元数据、本机 Docker Desktop。Rust 版本尚未用于编译任何后端源码（本阶段不创建应用源码）。

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

未完成项（不声称阶段 3 完成）：点位图片上传 `POST /api/markers/{id}/image`、管理员图片提案
提交/审批与 `cleanup-missing-images` 的 HTTP 路由尚未挂载，`MediaService` 仅为核心准备；
点位写入/编辑/审核路由属阶段 3 另案。本改动未 commit/push，由温晓验收。

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

## 备注

`lycoris-restore-review` 容器属温晓的私有恢复验收环境，不在本次范围。本阶段仅新建并操作 `lycoris-rust-postgres`、`lycoris-rust-redis`。
