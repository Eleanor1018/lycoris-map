# backend-rust

Lycoris Rust 后端（Axum + SQLx）工作目录。当前处于**阶段 1：骨架与公开读接口**：
可编译运行的 lib + bin、配置、健康检查、迁移基线、集成测试，以及**公开点位读取**
（`/api/markers/public`、`/search`、`/nearby`、`/viewport`、`/{id}`，含本地化与
Redis 查询缓存）均已就绪；写入与认证接口尚未实现，也不接管生产流量。生产仍由
`backend/` 的 Spring Boot 服务承担。

## 目录

| 路径 | 用途 |
| --- | --- |
| `Cargo.toml` / `Cargo.lock` | 单一 package（lib + bin，Edition 2024）；锁定版本见 lock |
| `rust-toolchain.toml` | 精确固定 Rust `1.98.1`（含 rustfmt、Clippy） |
| `src/lib.rs` | 库根，`#![forbid(unsafe_code)]` |
| `src/main.rs` | 可执行入口：配置、PG 池、Redis、Router、`--migrate` |
| `src/app.rs` | `AppState` / Router、`/health/live`、`/health/ready`、中间件 |
| `src/config.rs` | 环境变量配置，非法值报可读错误且不回显连接串 |
| `src/error.rs` | 四类响应体与错误类型（不统一包裹） |
| `src/migrate.rs` | 内嵌迁移、`--migrate` 执行与启动只读校验 |
| `src/modules/markers/` | 公开点位读取：`model`（行/DTO）、`repository`（`sql/*.sql` + `query_file_as!`）、`localization`（语言/哈希/纯函数）、`cache`（Redis ID 缓存）、`service`、`http`（薄 handler） |
| `migrations/0001_baseline.sql` | 从 `docs/rust-migration/schema-baseline.sql` 精确派生 |
| `.sqlx/` | SQLx 离线元数据，`SQLX_OFFLINE=true` 时无需数据库即可编译 |
| `tests/integration.rs` | 基础工程真实 PG / Redis 集成测试（临时建库并清理） |
| `tests/markers_read.rs` | 公开点位读取真实 PG / Redis 集成测试 |
| `tests/common/mod.rs` | 集成测试共享工具（临时库、回环校验、请求辅助） |
| `scripts/check-rust.ps1` | 迁移合成开发库、校验离线元数据、离线构建并跑 fmt / clippy / test |
| `compose.test.yml` | 隔离测试依赖：PostgreSQL 18.6 + PostGIS 3.6.4、Redis 8.10.1 |
| `scripts/check-services.py` | 启动并校验上述两个容器及精确版本（仅标准库） |

## 构建与运行

```powershell
# 依赖容器（首次或重启后）
docker compose -f backend-rust/compose.test.yml up -d
python backend-rust/scripts/check-services.py

# 构建
cargo build --manifest-path backend-rust/Cargo.toml
```

运行只从环境变量读取配置，`DATABASE_URL` 与 `REDIS_URL` 无默认值，避免误连非测试环境。
例如（PowerShell，仅当前会话）：

```powershell
$env:DATABASE_URL = "postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust"
$env:REDIS_URL    = "redis://127.0.0.1:56379"
cargo run --manifest-path backend-rust/Cargo.toml
```

默认监听 `127.0.0.1:18081`。健康检查：

- `GET /health/live`：进程存活，恒 `200`。
- `GET /health/ready`：并发检查 PG（`SELECT 1`）与 Redis（`PING`），每项 2 秒超时；
  任一失败或超时返回 `503`（不会被全局请求超时截断为 408）。

公开点位读取（匿名，成功为普通 JSON，无 `code/message/data` 包装；错误为中文纯文本）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/markers/public` | `is_public=true` 且 `review_status='APPROVED'` 的列表，不筛 `is_active` |
| GET | `/api/markers/search?q=` | 合并原文/类别/经纬度文本、有效译文与可解析坐标（容差 `0.00015`）命中并去重；缺失 `q` 为 400，仅显式空串/空白返回 `[]` |
| GET | `/api/markers/nearby?lat=&lng=&radius=&category=` | 包围盒 + Haversine（6 371 000 m），半径默认 `1000`（夹取 `1..50000`），类别默认 `accessible_toilet`，按距离升序 |
| GET | `/api/markers/viewport?minLat=&maxLat=&minLng=&maxLng=&categories=` | 视口内公开点位；`categories` 为逗号分隔白名单，空表示不过滤 |
| GET | `/api/markers/{id}` | 详情；本阶段匿名只返回 `is_public+APPROVED`，否则 `404` 空体 |

- 响应字段与 Java `MapMarker` 一致（camelCase，23 项），`isActive` 读取时按
  `APP_AVAILABILITY_ZONE`（默认 `Asia/Shanghai`）实时计算，类别读取时归一，均不回写、不推进 `version`。
- 语言优先级：显式 `lang` > 非空 `Accept-Language`（不支持或非法直接 `zh`，不回退
  `X-App-Language`）> `X-App-Language` > `zh`；成功响应带
  `Vary: Accept-Language, X-App-Language`。
- 资源级可见性边界集中在 `model::can_view(row, Option<&Viewer>)`；本阶段所有接口以
  `None` 调用，**不引入伪身份**，下一阶段接 `OptionalViewer`。

配置项（除前两项外均有安全默认）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 必填 | PostgreSQL 连接串，仅校验格式，不打印 |
| `REDIS_URL` | 必填 | Redis 连接串，仅校验格式，不打印 |
| `SERVER_HOST` / `SERVER_PORT` | `127.0.0.1` / `18081` | HTTP 监听 |
| `UPLOAD_DIR` | `uploads` | 上传目录（后续图片业务使用） |
| `CORS_ALLOWED_ORIGINS` | 空 | 逗号分隔的凭据白名单；每项须为 `http`/`https` 源，拒绝 `*`、`null`、路径、查询、片段与用户名密码；空表示不放行跨域 |
| `DB_MAX_CONNECTIONS` | `10` | 连接池上限，必须为正值 |
| `DB_ACQUIRE_TIMEOUT_SECONDS` | `30` | 取连接超时 |
| `DB_MAX_LIFETIME_SECONDS` / `DB_IDLE_TIMEOUT_SECONDS` | `1800` / `600` | 连接生命周期 |
| `REQUEST_TIMEOUT_SECONDS` | `30` | 请求超时；请求体总上限固定 8 MiB |
| `APP_AVAILABILITY_ZONE` | `Asia/Shanghai` | 读取时计算 `isActive` 的时区，须为合法 IANA 名称 |
| `MARKER_CACHE_REDIS_ENABLED` | `true` | 是否启用查询缓存；关闭时直接回源 PG |
| `MARKER_CACHE_NAMESPACE` | `lycoris:rust:marker` | 缓存命名空间；`nearby` 12s / `viewport` 10s，只缓存 ID |

Redis 缓存独立于 Java 的 `cache:marker:*` 命名空间，只存 ID 与缓存版本；缓存 key 中的
经纬度按 `f64::to_bits` 精确保留请求值。命中后仍回 PG 校验当前 `is_public+APPROVED` 并读取
最新内容；每条 Redis 命令 500ms 超时，故障、超时或坏 JSON 一律回源，不会排队到全局 HTTP 超时。
失效通过永不过期的 generation key 原子 `INCR` 切换命名空间（每次必然变化），不做
`FLUSHALL` / `KEYS` 扫描；提交后失效函数 `MarkerCache::invalidate` 供阶段 3 写接口调用，
禁用缓存时不访问 Redis。

访问日志只记录路由模板、方法、状态与耗时（`lycoris_backend::http`），不记录带查询串的完整 URI；
启动日志只记录“配置已加载”与监听地址，不打印连接串。`Config` 不派生 `Debug`。

## 迁移边界（重要）

- `migrations/0001_baseline.sql` 只用于**空库初始化**，与
  [../docs/rust-migration/schema-baseline.sql](../docs/rust-migration/schema-baseline.sql)
  逐字一致（6 张表、无数据）。
- 普通启动只调用只读校验，确认所需迁移已应用且校验和一致；**不会自动执行 DDL**。
- 空库需显式运行：

  ```powershell
  cargo run --manifest-path backend-rust/Cargo.toml -- --migrate
  ```

- **禁止把初始建表重复用于已有库**。已有生产库的接管尚未自动化，将在后续阶段专项设计并
  验证（对照恢复库、逐表校验、回退演练）；本轮不得对已有库执行 `0001_baseline.sql`。

## 测试

`tests/integration.rs` 与 `tests/markers_read.rs` 使用标准 Rust 测试与
`tower::ServiceExt::oneshot`，不启动外部 HTTP 服务器。每个用例从测试管理员连接创建
UUID 命名的临时库、应用迁移、构造 Router 并断言；无论成功失败都会删除自己的临时库。
服务不可用时测试直接失败，不做静默跳过。只允许连接回环地址上的合成测试服务。

```powershell
# 一步完成：迁移合成开发库、校验 .sqlx 离线元数据、SQLX_OFFLINE 构建、fmt / clippy / test
pwsh backend-rust/scripts/check-rust.ps1

# 或直接运行（默认指向下方合成测试服务）
cargo test --manifest-path backend-rust/Cargo.toml
```

可用 `TEST_DATABASE_URL` / `TEST_REDIS_URL` 覆盖测试地址，但必须指向回环地址。
`.sqlx` 离线元数据由 `cargo sqlx prepare`（SQLx CLI 0.9.0）生成并由脚本校验；
`SQLX_OFFLINE=true` 时无需数据库即可编译。

## 连接与数据目录

| 组件 | 地址 | 凭据 |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:55432` | 用户 `lycoris` / 密码 `lycoris_local_test` / 库 `lycoris_rust` |
| Redis | `127.0.0.1:56379` | 无密码 |

测试用户为超级用户，集成测试可创建并删除临时数据库。持久卷为
`lycoris-rust-postgres-data`、`lycoris-rust-redis-data`。容器名固定
`lycoris-rust-postgres`、`lycoris-rust-redis`，端口仅绑定回环地址。

## 边界

- 不包含应用容器，不接入生产，不保存真实数据；只使用合成测试服务。
- 不操作 `lycoris-restore-review` 容器（温晓的私有恢复验收环境）。
- 认证暂留既有语义，`tower-sessions` 不降级，适配设计由温晓在后续阶段确定。
- 本阶段只交付公开点位读取；写接口、认证与 `OptionalViewer` 未实现，`isActive` 读取
  计算不回写数据库、不推进 `version`。
