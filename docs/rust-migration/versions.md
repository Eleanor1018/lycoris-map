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
tower-sessions 0.15.0 经温晓评估后**未采用**：其通用记录保存默认整份覆写，不提供本项目
所需的字段级原子条件更新；改用范围有限的类型化 Redis 会话模块（见 `auth-design.md`）。
后续仍待候选：image 0.25.10 等按业务需要逐个加入。

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

未完成项：头像 3 路由、点位模块（另一任务，合并后接入 `OptionalUser`）；媒体流式存储由另一
media 任务负责。本轮未 commit/push。`.sqlx` 已生成但未提交，合并后由温晓统一 `prepare`。


## 备注

`lycoris-restore-review` 容器属温晓的私有恢复验收环境，不在本次范围。本阶段仅新建并操作 `lycoris-rust-postgres`、`lycoris-rust-redis`。
