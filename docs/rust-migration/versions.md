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

后续阶段候选（未编译，暂不引入）：tower-sessions 0.15.0、bcrypt 0.19.3、image 0.25.10、chrono-tz、sha2 等按业务需要逐个加入。本轮认证不降级 `tower-sessions`，其具体适配设计由温晓在下一阶段确定。

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


## 备注

`lycoris-restore-review` 容器属温晓的私有恢复验收环境，不在本次范围。本阶段仅新建并操作 `lycoris-rust-postgres`、`lycoris-rust-redis`。
