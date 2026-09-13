# backend-rust

Lycoris Rust 后端（Axum + SQLx）工作目录。当前处于**阶段 1：骨架与公开读接口**：
可编译运行的 lib + bin、配置、健康检查、迁移基线、集成测试，以及**公开点位读取**
（`/api/markers/public`、`/search`、`/nearby`、`/viewport`、`/{id}`，含本地化与
Redis 查询缓存）均已就绪。媒体侧另有**未挂载路由**的 `MediaService`（头像条件更新、
受控 `/uploads` 读取、图片提案提交/审批、失效图片清理，见下文），依赖可信身份由未来
HTTP 层传入，因此暂不接线 HTTP。写入路由、认证接口与 `OptionalViewer` 尚未接通，也不
接管生产流量；生产仍由 `backend/` 的 Spring Boot 服务承担。

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
| `src/media/` | 媒体核心与业务：`storage.rs`（存储/读取）、`model.rs`（行/DTO）、`repository.rs`（固定 SQL）、`service.rs`（`MediaService`）、`sql/*.sql`（头像/提案/清理固定语句） |
| `src/migrate.rs` | 内嵌迁移、`--migrate` 执行与启动只读校验 |
| `src/modules/markers/` | 公开点位读取：`model`（行/DTO）、`repository`（`sql/*.sql` + `query_file_as!`）、`localization`（语言/哈希/纯函数）、`cache`（Redis ID 缓存）、`service`、`http`（薄 handler） |
| `migrations/0001_baseline.sql` | 从 `docs/rust-migration/schema-baseline.sql` 精确派生 |
| `.sqlx/` | SQLx 离线元数据，`SQLX_OFFLINE=true` 时无需数据库即可编译 |
| `tests/integration.rs` | 基础工程真实 PG / Redis 集成测试（临时建库并清理） |
| `tests/markers_read.rs` | 公开点位读取真实 PG / Redis 集成测试 |
| `tests/media.rs` | 媒体核心集成测试（合成图与真实临时目录，无需 PG/Redis） |
| `tests/media_business.rs` | 媒体业务真实 PG / Redis / 临时文件集成测试（头像、访问矩阵、提案、清理） |
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

## 媒体核心（阶段 2 / 3 共用）

`src/media` 提供 `ImageStore`（构造时接收显式 `root` 与并发上限）、`StoredImage`
（目录 / 文件名 / URL）、`ImageBytes` 与 `MediaError`。它只处理磁盘媒体本身，
**不含 HTTP 路由与身份/权限判断**：`markers` 图片的可见性与 `avatars` 的授权由上层
接口决定。主要接口：

| 接口 | 行为 |
| --- | --- |
| `ImageStore::new(root, max_concurrent)` | 创建并 canonicalize `root`；默认并发 `1`（`with_default_concurrency`） |
| `save(directory, prefix, bytes)` | 校验真实格式与尺寸后重编码落盘，返回 `StoredImage`；无许可返回 `MediaError::Busy`（上层映射 503） |
| `open(directory, filename)` | 校验路径后打开文件，返回 `OpenedImage{file,content_type,len}`；HTTP 应据此流式发送（如 `ReaderStream`），不整张读入内存 |
| `read(directory, filename)` | 带 `MAX_READ_BYTES` 上限的便利方法/测试辅助，返回字节与 MIME；**不是 HTTP 必须方式** |
| `exists(directory, filename)` | 校验路径后检查 `root` 内普通文件是否存在 |
| `remove_new(&StoredImage)` | 仅删除“上层确认无引用”的单个新孤立文件，幂等，不递归扫描 |

边界与约束：

- 上传压缩字节至多 5 MiB；只认真实 JPEG/PNG/GIF/WebP（按魔数，不信扩展名或
  `Content-Type`）。先读头部尺寸（宽高 `1..=10000`、像素乘积 `<= 25_000_000`），
  再限制解码内存到 128 MiB 量级并只解首帧，解码后复核尺寸。
- 有 alpha 重编码为 PNG，否则为 JPEG（质量 75）；不复制 EXIF 等源元数据。
- 文件名固定为 `prefix-UUID.ext`，`prefix` 由服务端提供并再次校验（ASCII 字母数字与
  `-`）；URL 为 `/uploads/{directory}/{filename}`。目录白名单仅 `avatars`/`markers`。
- 目录/文件名不合法返回 `InvalidDirectory`/`InvalidName`；canonical 路径必须落在
  canonical `root` 内，最终项必须是普通文件，符号链接/reparse 跳出按不存在处理。
- 图片 CPU 处理在阻塞任务中执行，许可移动到任务内并持有到结束，请求超时不会提前
  释放许可；无许可立即繁忙，输入不入无界队列。`max_concurrent` 必须大于 0。
- 读取：`open` 不套用上传的 5 MiB 限制，历史大图（含 PNG 重编码结果）仍可展示；
  `read` 的上限按实际读取字节数判定，文件在检查后增长也无法绕过。
- 落盘：数据 `sync_all` 后用 `persist_noclobber` 落到最终名（不覆盖同名），Unix 上再
  尽力 `sync` 父目录；完成落盘后才返回 URL 供业务引用。
- **权限**：`root`（`UPLOAD_DIR`）必须由服务运行用户独占写权限，其他本地用户不可写，
  以免放入可执行内容或替换目录。核心不引入 `unsafe`。

## 受控媒体业务（阶段 2 头像 / 阶段 3 图片）

`MediaService`（`src/media/service.rs`）构造只依赖 `PgPool` + `ImageStore` +
`MarkerCache`；**身份由调用方以可信 `Viewer` / 用户名 / 用户 ID 传入**，本层不解析会话、
不信任请求字段，只做资源级授权与一致性校验，并复用 `markers::model::can_view`。

可供后续 HTTP 接入的方法：

| 方法 | 对应接口 | 要点 |
| --- | --- | --- |
| `avatar_url_by_public_id(public_id)` | `GET /api/users/{publicId}/avatar` | 非删除用户且存储值为合法 `/uploads/avatars/*` 才返回 URL，否则 `None`（404） |
| `avatar_url_by_user_id(user_id)` | `GET /api/me/avatar` | 同上 |
| `upload_avatar(user_id, expected_row_version, caller_public_id, bytes)` | `POST /api/me/avatar` | 保存后以 `id + deleted=false + row_version` 条件更新 `avatar_url` 与 `row_version`，**不覆盖资料其他列**；返回 `Updated`/`NotFound`/`VersionConflict` |
| `open_uploads(directory, filename, viewer)` | `GET /uploads/{directory}/{filename}` | 授权后返回流式 `OpenedImage`，不整张读入内存；非法/不存在/不可见一律 404 |
| `submit_marker_image(id, viewer, username, public_id, bytes)` | `POST /api/markers/{id}/image` | 可见性检查在解码前；落盘后事务内重锁点位复检，插入 `PENDING` 提案，点位不变，返回原 `MarkerRow` |
| `list_pending_images(viewer)` | `GET /api/admin/markers/pending-images` | 8 字段、`createdAt DESC` |
| `approve_image_proposal(id, viewer, reviewer)` / `reject_image_proposal(...)` | 管理员图片审批 | 一次性、同事务 |
| `cleanup_missing_images(viewer)` | `POST /api/admin/markers/cleanup-missing-images` | `{checked,cleared,message}` |

- 错误类型 `MediaServiceError` 提供 `status()` 与 `message()`（如 `图片提案不存在`、
  `关联点位不存在`、`该提案已处理`），HTTP 层据此选择响应形状；管理员与二次验证由 HTTP
  层负责，本层只校验管理员角色。文件过大有显式 `PayloadTooLarge` 分支：`status()` 为 413、
  `message()` 为 `上传文件过大，请选择 5MB 以内的图片`、`is_payload_too_large()` 为真，HTTP
  用枚举/方法分支而非字符串匹配。解码失败等输入问题是 400，编码失败是 500。
- 日志只记录受控信息：数据库错误记录 `context` + SQLSTATE/约束名，Redis 记录 `error_kind`，
  I/O 记录 `io_kind`；不输出底层完整错误、参数、图片 URL 或用户字段。
- `/uploads` 授权：`avatars` 匿名可读；`markers` 先看直接引用点位是否 `can_view`，否则
  要求 viewer 存在且图片提案 `INNER JOIN` 仍存在的点位，再满足管理员 / 点位属主 /
  （提案作者且可见）。**提案状态不参与判断**；已删除 viewer 只能与匿名同权（不得凭旧
  ADMIN/属主/提案作者身份读取私有图片）；关联点位被删除后历史提案不授权任何人（含管理员）。
- 审批在同一事务内锁提案（`PENDING`）→ 锁并更新点位 `mark_image` 与 `version` → 写提案
  状态/审核人/时间后提交；图片提案没有基准版本列，不伪造 base version。提交成功后以
  500ms 超时尽力失效点位缓存，Redis 故障或超时只记录受控日志，不反转已提交结果。
- 清理只检查 `/uploads/markers/` 引用：存在的普通文件保留；缺失或非普通文件才以
  `id/version/mark_image` 同时匹配条件清空并 `version++`，因此并发换上的新图不会被旧
  检查清掉；非法路径拒绝访问、权限/临时 I/O 异常保守保留 URL；**不删除任何文件**，也不
  扫描整个上传目录。每个引用独立事务、提交后立即失效缓存，因此循环中途失败时已提交的
  清理保留且已失效缓存，未提交部分不生效，**不假称全量回滚**。
- 文件生命周期：落盘成功才允许写数据库引用；数据库写入失败或结果不确定时保留本次新建
  的孤立文件，且**不自动删除旧头像文件**（Java 本就保留）。跨 DB+FS 的原子性不在本轮
  承诺内；待有引用审计后再设计孤立文件清理。

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
- 本阶段只交付公开点位读取；写路由、认证与 `OptionalViewer` 未实现，`isActive` 读取
  计算不回写数据库、不推进 `version`。
- 媒体核心与 `MediaService` 业务已就绪但尚未挂载路由：`/uploads/*`、头像与图片提案的
  HTTP 授权、二次验证、缓存头与响应形状由后续接口实现；核心不宣称已完成 HTTP 接线。
