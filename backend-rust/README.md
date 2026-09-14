# backend-rust

Lycoris Rust 后端采用 Axum + SQLx + PostgreSQL + Redis。阶段 0 至 3 已通过本地验收，
实现全部 **43 个既有 API 契约模板**：公开点位、认证与用户、头像、点位写入、收藏、译文与
图片提案审核、受控资源读取。`/uploads` 模板拆为两个明确目录路由，健康探针另列。

完整检查 **191 项通过**（阶段 3 为 162 项，阶段 4 新增 25 项基线接管真实 PG 集成与 4 项 CLI
单元测试），独立真实 TCP 验收 **64/64**、覆盖 **43/43** 个接口模板。阶段 4 已实现已有库
`--check-baseline`/`--adopt-baseline` 基线接管；Linux 验证、性能测量与生产切换仍在阶段 4 内进行。
详细证据与差异见 [执行记录](../docs/rust-migration/execution.md)。生产仍由 `backend/` 的
Spring Boot 服务承担。

设计依据：`docs/rust-migration/auth-design.md`、`docs/rust-migration/api-contract.md`。
本轮保留 Cookie + 账号 + 密码 + 管理员二次验证体验，最终认证重设计另案。

## 目录

| 路径 | 用途 |
| --- | --- |
| `Cargo.toml` / `Cargo.lock` | 单一 package（lib + bin，Edition 2024）；锁定版本见 lock |
| `rust-toolchain.toml` | 精确固定 Rust `1.98.1`（含 rustfmt、Clippy） |
| `src/lib.rs` | 库根，`#![forbid(unsafe_code)]` |
| `src/main.rs` | 可执行入口：配置、PG 池、Redis、Router、`--migrate` |
| `src/app.rs` | `AppState` / Router / 中间件装配（全局 8 MiB 上限、超时、服务端请求 ID + 访问日志、CORS） |
| `src/config.rs` | 环境变量配置，非法值报可读错误且不回显连接串 |
| `src/error.rs` | 四类响应体与错误类型（不统一包裹） |
| `src/modules/markers/` | 点位读取与写入：`model`（行/DTO）、`repository`（`sql/*.sql` + `query_file_as!`）、`localization`（语言/哈希/纯函数）、`cache`（Redis ID 缓存）、`service`（读取/本地化）、`http`（公开读取薄 handler）、`write`/`write_model`（已验收写入事务）、`write_http`（写入/收藏/审核薄 handler） |
| `src/media/` | 媒体核心与业务：`storage.rs`（存储/读取）、`model.rs`（行/DTO）、`repository.rs`（固定 SQL）、`service.rs`（`MediaService`）、`sql/*.sql`（头像/提案/清理固定语句） |
| `src/multipart.rs` | multipart 读取辅助（单文件逐块限额、流式丢弃未知字段）与**显式形状**的错误映射：头像用 `ApiResponse`，阶段 3 点位图片业务错误用中文纯文本（全局 413 始终 `ApiResponse`） |
| `src/web.rs` | JSON 提取器（认证 64 KiB / 点位写 8 MiB，共用唯一有界读取实现）、Cookie 读写、流式图片响应辅助 |
| `src/session.rs` | 类型化 Redis 会话（创建/读取续期/删除/二次验证/版本推进） |
| `src/password.rs` | 受并发许可保护的 BCrypt 与历史明文兼容 |
| `src/users.rs` | 用户数据访问（SQLx 编译期宏，用户值全部 bind） |
| `queries/*.sql` | 固定的命名查询；`.sqlx/` 为 `cargo sqlx prepare` 生成的离线元数据 |
| `src/auth.rs` | `OptionalUser` / `CurrentUser` / `AdminUser` / `VerifiedAdmin` 提取器 |
| `src/origin.rs` | 写请求来源校验中间件 |
| `src/ratelimit.rs` | 注册限流（Redis 原子 INCR + TTL） |
| `src/routes/` | HTTP 处理器：`auth`、`admin`（账号）、`admin_markers`（阶段 3 图片提案/清理）、`avatar`（3 个头像路由）、`uploads`（受控读取） |
| `src/migrate.rs` | 内嵌迁移、`--migrate` 执行、已有库建表守卫与启动只读校验 |
| `src/baseline/` | 已有库基线预检与接管：`expected`（已审查基线的结构期望）、`inspect`（只读目录核对/计数/历史读取）、`adopt`（`--check-baseline`/`--adopt-baseline`） |
| `src/cli.rs` | 命令行参数解析（`--migrate`/`--check-baseline`/`--adopt-baseline` 互斥，拒绝未知参数） |
| `migrations/0001_baseline.sql` | 从 `docs/rust-migration/schema-baseline.sql` 精确派生 |
| `.sqlx/` | SQLx 离线元数据，`SQLX_OFFLINE=true` 时无需数据库即可编译 |
| `tests/integration.rs` | 基础工程真实 PG / Redis 集成测试（临时建库并清理） |
| `tests/baseline_adoption.rs` | 已有库基线接管/只读预检真实 PG 集成测试（Java 形状库、结构拒绝、历史拒绝、并发、锁超时、CLI） |
| `tests/markers_read.rs` | 公开点位读取真实 PG / Redis 集成测试 |
| `tests/markers_http.rs` | 点位写入/收藏/审核 HTTP 真实 PG / Redis 集成测试（真实 Router + 登录 Cookie + 权限矩阵） |
| `tests/media.rs` | 媒体核心集成测试（合成图与真实临时目录，无需 PG/Redis） |
| `tests/media_business.rs` | 媒体业务真实 PG / Redis / 临时文件集成测试（头像、访问矩阵、提案、清理） |
| `tests/media_http.rs` | 头像 3 路由、受控 `/uploads`、私有点位 detail、阶段 3 点位图片上传与管理员图片提案/清理的真实 PG / Redis / 临时文件 HTTP 集成测试 |
| `tests/auth_integration.rs` | 认证/用户真实 PG / Redis 集成测试 |
| `tests/common/mod.rs` | 集成测试共享工具（临时库、回环校验、请求辅助） |
| `scripts/check-rust.ps1` | 迁移合成开发库、校验离线元数据、离线构建并跑 fmt / clippy / test |
| `compose.test.yml` | 隔离测试依赖：PostgreSQL 18.6 + PostGIS 3.6.4、Redis 8.10.1 |
| `scripts/check-services.py` | 启动并校验上述两个容器及精确版本（仅标准库） |

## 已实现路由（43 个既有契约模板全部挂载；`/health/live`、`/health/ready` 探针另列）

| 方法 | 路径 | 认证 |
| --- | --- | --- |
| POST | `/api/login` | 匿名（写来源校验） |
| POST | `/api/register` | 匿名（写来源校验 + 限流） |
| GET | `/api/me` | 登录 |
| PATCH | `/api/me` | 登录 |
| GET | `/api/me/avatar` | 登录（`CurrentUser`） |
| POST | `/api/me/avatar` | 登录（`CurrentUser` + 写来源校验 + multipart） |
| GET | `/api/users/{publicId}/avatar` | 匿名 |
| POST | `/api/me/password` | 登录 |
| POST | `/api/logout` | 登录 |
| POST | `/api/admin/verify` | 管理员 |
| GET | `/api/admin/users` | 管理员 + 二次验证 |
| POST | `/api/admin/users/{id}/reset-password` | 管理员 + 二次验证 |
| DELETE | `/api/admin/users/{id}` | 管理员 + 二次验证 |
| POST | `/api/admin/users/{id}/restore` | 管理员 + 二次验证 |
| GET | `/uploads/avatars/{filename}` | 匿名（不加载会话） |
| GET | `/uploads/markers/{filename}` | 匿名/属主/管理员/提案作者（资源级） |
| GET | `/api/markers/public`、`/search`、`/nearby`、`/viewport`、`/{id}` | 公开读；`/{id}` 接 `OptionalUser` 构真实 Viewer |
| POST | `/api/markers/{id}/image` | 登录（`CurrentUser` + 写来源校验 + multipart；只建 PENDING 提案） |
| GET | `/api/admin/markers/pending-images` | 管理员 + 二次验证 |
| POST | `/api/admin/markers/image-proposals/{id}/approve` | 管理员 + 二次验证 |
| POST | `/api/admin/markers/image-proposals/{id}/reject` | 管理员 + 二次验证 |
| POST | `/api/admin/markers/cleanup-missing-images` | 管理员 + 二次验证 |

响应形状按契约分别保留：安全入口 401 固定 `{"message":"Spring Security Error"}`；
已认证但角色不足的 403 为 Spring Boot 默认错误 JSON
`{timestamp,status,error,path}`（真实 Java 行为，非空体）；管理员二次验证 403 仍为中文纯文本；
管理员成功为普通 JSON；Auth/头像接口为 `ApiResponse`（失败 `data:null`）；阶段 3 点位图片上传
成功为本地化普通 JSON（带 `Vary`），业务错误 400/404/503 为中文纯文本、413 保持 `ApiResponse`、
保存类 500 为 `上传失败` 文本；管理员图片接口成功为普通 JSON/空体，业务错误为中文纯文本。
**不做全局统一包裹。**

请求体上限与 413：

- **全局 8 MiB**：tower-http `RequestBodyLimitLayer` 对所有接口（含不读 body 的 `GET /health/*`）
  按 `Content-Length` 提前 413，未知长度的流式 body 由 `Limited` 在读取时抛 `LengthLimitError`；
  `DefaultBodyLimit::max(8 MiB)` 同时覆盖 Axum 默认 2 MiB 的 extractor 限制。两者产生的 413
  统一为 `ApiResponse{code:413,message:"上传文件过大，请选择 5MB 以内的图片",data:null}`。
- **JSON 提取器**：认证/资料接口保持 64 KiB 上限；只有真正的 `LengthLimitError` 返回结构化 413，
  复用统一文案 `上传文件过大，请选择 5MB 以内的图片`；截断/网络读取失败返回 400 `请求体读取失败`。
  超限分类沿整条 `source()` 链识别 `LengthLimitError`，不依赖错误字符串。
- **multipart 读取**：逐块累计 ≤5 MiB、不依赖 `Content-Length`、读到结束；重复/缺/空 `400`，
  超限 `413`（同上形状）。
- **CORS 包住所有错误来源**：限流/标准化后的 413 与其它响应都由统一 CORS 层补齐
  `Access-Control-Allow-Origin`/`Access-Control-Allow-Credentials` 与 `Vary: Origin`；非白名单
  Origin 不发 `allow-origin`。允许来源还通过 `Access-Control-Expose-Headers` 暴露
  `X-Request-ID`，供浏览器读取关联头。
- **请求日志与请求 ID**：访问日志中间件为最外层（包住 CORS），每个请求由**服务端**生成新的
  UUID 请求 ID，放入 tracing span，使 handler 与下游受控日志都落在同一 span；完成事件记录
  请求 ID、方法、匹配路由模板、状态与耗时。普通成功、404 fallback 与全局 body limit 413
  都有请求 ID 与完成日志；`MatchedPath` 缺失时用固定占位 `<unmatched>`，**绝不**记录原始
  URI/query、Cookie 或请求体，也**不**信任/回显客户端 `X-Request-ID`。每个响应统一附
  `X-Request-ID`。


## 点位写入/收藏/审核（18，阶段 3）

非图片点位路由（图像 5 条由另一改动接入），身份只从当前数据库账号构造 `Actor`，
成功 `MarkerRow`/`Vec<MarkerRow>` 统一经 `MarkerService::localize`（23 字段 + 语言 `Vary`），
`pending-edits` 为普通 JSON（18 字段）。

| 方法 | 路径 | 认证 |
| --- | --- | --- |
| POST | `/api/markers` | 登录 |
| PATCH / DELETE | `/api/markers/{id}` | 登录 |
| POST / DELETE | `/api/markers/{id}/favorite` | 登录 |
| GET | `/api/markers/me/favorites`、`/me/created`、`/me/favorites/details` | 登录 |
| GET | `/api/markers/all` | 管理员（不要求二次验证） |
| GET | `/api/admin/markers/pending`、`/pending-edits`、`/all` | 管理员 + 二次验证 |
| POST | `/api/admin/markers/{id}/approve`、`/reject` | 管理员 + 二次验证 |
| PATCH / DELETE | `/api/admin/markers/{id}` | 管理员 + 二次验证 |
| POST | `/api/admin/markers/edit-proposals/{id}/approve`、`/reject` | 管理员 + 二次验证 |

**JSON 请求体读取边界**：认证/用户请求沿用 64 KiB（`web::JsonBody`）；点位创建、普通
PATCH 与管理员 PATCH 使用全局 8 MiB（`web::MarkerJsonBody`），因为 `description` 在 PG 为
`text` 且 Java 无 64 KiB 限制。两条路径共用同一有界读取实现，不复制解析代码；行为：

- 非 JSON 媒体类型（`application/jsonp` 等）→ 415 中文纯文本；
- 超过各自上限 → 413 统一 `ApiResponse` `{code:413,message:"上传文件过大，请选择 5MB 以内的图片",data:null}`；
- 其它底层读取失败 → 400 中文纯文本（沿错误源链识别真正的 `http_body_util::LengthLimitError`，
  不把读取失败统一假称超限）；
- JSON 反序列化失败 → 400 中文纯文本。

> 全局 `RequestBodyLimitLayer`（8 MiB）在 `Content-Length` 已表明超限时会先于 handler 返回
> 其自带 413；该全局 413 由主分支阶段 2 的 `normalize_payload_too_large` 统一为同一
> `ApiResponse` 形状。整合后 JSON 提取器与 multipart 共用唯一的 `web::is_length_limit_error`
> 与 `multipart::payload_too_large_response`（同一超限文案/响应），提取器层再覆盖无
> `Content-Length`（分块/未知长度）及 64 KiB 认证边界，无重复实现。

新建点位 `markImage` 只接受 `null`/空白（归一为 `null`），非空一律 400
`markImage 只能为空，请通过图片上传提交`；检查在写入事务核心的首次完整校验处，
`clientRequestId` 幂等重放仍先返回原点位。

## 公开点位读取（匿名）

公开点位读取（匿名，成功为普通 JSON，无 `code/message/data` 包装；错误为中文纯文本）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/markers/public` | `is_public=true` 且 `review_status='APPROVED'` 的列表，不筛 `is_active` |
| GET | `/api/markers/search?q=` | 合并原文/类别/经纬度文本、有效译文与可解析坐标（容差 `0.00015`）命中并去重；缺失 `q` 为 400，仅显式空串/空白返回 `[]` |
| GET | `/api/markers/nearby?lat=&lng=&radius=&category=` | 包围盒 + Haversine（6 371 000 m），半径默认 `1000`（夹取 `1..50000`），类别默认 `accessible_toilet`，按距离升序 |
| GET | `/api/markers/viewport?minLat=&maxLat=&minLng=&maxLng=&categories=` | 视口内公开点位；`categories` 为逗号分隔白名单，空表示不过滤 |
| GET | `/api/markers/{id}` | 详情：接 `OptionalUser`，按当前数据库身份构真实 `Viewer`；属主/管理员可见私有待审，其他匿名 `404` 空体 |

- 响应字段与 Java `MapMarker` 一致（camelCase，23 项），`isActive` 读取时按
  `APP_AVAILABILITY_ZONE`（默认 `Asia/Shanghai`）实时计算，类别读取时归一，均不回写、不推进 `version`。
- 语言优先级：显式 `lang` > 非空 `Accept-Language`（不支持或非法直接 `zh`，不回退
  `X-App-Language`）> `X-App-Language` > `zh`；成功响应带
  `Vary: Accept-Language, X-App-Language`。
- 资源级可见性边界集中在 `model::can_view(row, Option<&Viewer>)`；`GET /api/markers/{id}`
  按数据库当前身份构造 `Viewer`（`publicId`/`role`/`deleted`），其余四个公开读接口保持匿名、
  不加载会话，也不伪造身份。

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

## 受控媒体业务（头像与阶段 3 点位图片均已接 HTTP）

`MediaService`（`src/media/service.rs`）构造只依赖 `PgPool` + `ImageStore` +
`MarkerCache`；**身份由调用方以可信 `Viewer` / 用户名 / 用户 ID 传入**，本层不解析会话、
不信任请求字段，只做资源级授权与一致性校验，并复用 `markers::model::can_view`。

可供 HTTP 层调用的方法（✅ 已挂载路由）：

| 方法 | 对应接口 | 状态 | 要点 |
| --- | --- | --- | --- |
| `avatar_url_by_public_id(public_id)` | `GET /api/users/{publicId}/avatar` | ✅ | 非删除用户且存储值为合法 `/uploads/avatars/*` 才返回 URL，否则 `None`（404） |
| `avatar_url_by_user_id(user_id)` | `GET /api/me/avatar` | ✅ | 同上 |
| `upload_avatar(user_id, expected_row_version, caller_public_id, bytes)` | `POST /api/me/avatar` | ✅ | 保存后以 `id + deleted=false + row_version` 条件更新 `avatar_url` 与 `row_version`，**不覆盖资料其他列**；返回 `Updated`/`NotFound`/`VersionConflict` |
| `open_uploads(directory, filename, viewer)` | `GET /uploads/avatars|markers/{filename}` | ✅ | 授权后返回流式 `OpenedImage`，不整张读入内存；非法/不存在/不可见一律 404 |
| `submit_marker_image(id, viewer, username, public_id, bytes)` | `POST /api/markers/{id}/image` | ✅ | 可见性检查在解码前；落盘后事务内重锁点位复检，插入 `PENDING` 提案，点位不变，返回原 `MarkerRow` |
| `list_pending_images(viewer)` | `GET /api/admin/markers/pending-images` | ✅ | 8 字段、`createdAt DESC` |
| `approve_image_proposal(id, viewer, reviewer)` / `reject_image_proposal(...)` | 管理员图片审批 | ✅ | 一次性、同事务 |
| `cleanup_missing_images(viewer)` | `POST /api/admin/markers/cleanup-missing-images` | ✅ | `{checked,cleared,message}` |

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

## 构建、运行与迁移

```powershell
# 从仓库根目录启动依赖容器（首次或重启后）
docker compose -f backend-rust/compose.test.yml up -d
python backend-rust/scripts/check-services.py

# 在 crate 目录运行 Cargo，让 rustup 读取这里固定的工具链
Set-Location backend-rust
$env:SQLX_OFFLINE = "true"
cargo build --locked
```

后续 Cargo 命令均在 `backend-rust/` 内运行；仅传 `--manifest-path` 不会让 rustup 从目标
manifest 的目录选择工具链。固定查询位于 `queries/` 与各模块的 `sql/`，离线元数据在 `.sqlx/`。
`SQLX_OFFLINE=true` 构建不依赖数据库 schema；修改固定 SQL 后，在已迁移的合成库重新生成：

```powershell
# 需要已迁移的合成库（DATABASE_URL 指向 lycoris_rust）
Remove-Item Env:SQLX_OFFLINE -ErrorAction SilentlyContinue
cargo sqlx prepare -- --all-targets
```

运行只从环境变量读取配置，`DATABASE_URL` 与 `REDIS_URL` 无默认值。例如（PowerShell）：

```powershell
$env:DATABASE_URL = "postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust"
$env:REDIS_URL    = "redis://127.0.0.1:56379"
$env:SQLX_OFFLINE = "true"
cargo run --locked
```

普通启动只校验迁移已应用；空库需显式 `cargo run -- --migrate`。健康检查
`/health/live`、`/health/ready` 行为与阶段 1 相同。已有 Java 库（有业务表、无
`_sqlx_migrations`）不得用 `--migrate` 重复建表：先 `--check-baseline` 只读预检，再
`--adopt-baseline` 核对接管并登记原始基线真实校验和；阶段 5 新增迁移后再显式 `--migrate`。
三个操作参数互斥，未知参数直接失败，不会误启动服务。

| 命令 | 行为 |
| --- | --- |
| 无参数 | 普通启动：`verify_applied` 只读校验，不执行 DDL |
| `--migrate` | 对空库执行 SQLx 迁移；业务表已存在但基线未登记时拒绝并提示接管 |
| `--check-baseline` | 单个 `REPEATABLE READ READ ONLY` 快照内核对 6 张业务表结构、PostGIS/schema、SQLx 历史与发布决策计数；不创建 `_sqlx_migrations` |
| `--adopt-baseline` | 独占连接 + SQLx 迁移锁 + 单事务内按固定顺序 `LOCK … IN SHARE MODE` 六表，核对结构/历史后登记真实基线校验和；不执行基线 DDL、不改业务数据，失败整体回滚，取消即释放锁 |

## 配置项

除 `DATABASE_URL` / `REDIS_URL` 外均有安全默认：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` / `REDIS_URL` | 必填 | 仅校验格式，不打印 |
| `SERVER_HOST` / `SERVER_PORT` | `127.0.0.1` / `18081` | HTTP 监听 |
| `UPLOAD_DIR` | `uploads` | 上传根目录；启动时创建并 canonicalize（`--migrate` 不初始化） |
| `MEDIA_MAX_CONCURRENCY` | `1` | 图片 CPU 处理并发许可数，必须为正值；无许可立即返回 503 |
| `CORS_ALLOWED_ORIGINS` | 空 | 逗号分隔的凭据白名单；每项须为 `http`/`https` 源，拒绝 `*`、`null`、路径、查询、片段与用户名密码；空表示不放行跨域 |
| `WRITE_ALLOWED_ORIGINS` | 回落到 CORS 白名单 | 写请求 Origin 白名单（含同源站点也需显式列入） |
| `TRUSTED_PROXIES` | 空 | 可信代理 IP 列表；仅这些连接才读取 `X-Forwarded-For` |
| `DB_MAX_CONNECTIONS` | `10` | 连接池上限，必须为正值 |
| `DB_ACQUIRE_TIMEOUT_SECONDS` | `30` | 取连接超时 |
| `DB_MAX_LIFETIME_SECONDS` / `DB_IDLE_TIMEOUT_SECONDS` | `1800` / `600` | 连接生命周期 |
| `REQUEST_TIMEOUT_SECONDS` | `30` | 请求超时；请求体总上限固定 8 MiB |
| `APP_AVAILABILITY_ZONE` | `Asia/Shanghai` | 读取时计算 `isActive` 的时区，须为合法 IANA 名称 |
| `MARKER_CACHE_REDIS_ENABLED` | `true` | 是否启用查询缓存；关闭时直接回源 PG |
| `MARKER_CACHE_NAMESPACE` | `lycoris:rust:marker` | 缓存命名空间；`nearby` 12s / `viewport` 10s，只缓存 ID |
| `SESSION_COOKIE_NAME` | `LYCORIS_SESSION` | 必须是 RFC 6265 token；并行验收可改为独立名（如 `LYCORIS_RUST_SESSION`） |
| `SESSION_COOKIE_SECURE` / `SESSION_COOKIE_DOMAIN` / `SESSION_COOKIE_SAME_SITE` | `false` / 空 / `lax` | Cookie 属性；domain 拒绝控制字符与分隔符 |
| `SESSION_COOKIE_MAX_AGE_SECONDS` / `SESSION_TTL_SECONDS` | `2592000`（30 天） | Cookie 与会话 TTL（上限 10 年） |
| `SECOND_FACTOR_TTL_SECONDS` | `1800`（30 分钟） | 管理员二次验证有效期（上限 1 天） |
| `SESSION_NAMESPACE` | `lycoris:rust:session:v1` | Redis 会话命名空间（非空，与 Java `lycoris:session` 隔离） |
| `RATE_LIMIT_NAMESPACE` | `lycoris:rust:ratelimit:v1` | 注册限流命名空间（非空） |
| `REDIS_COMMAND_TIMEOUT_SECONDS` | `2` | 单条 Redis 命令超时（≤10s）；卡住时受保护操作返回 503 |
| `REGISTER_RATE_LIMIT_MAX` / `REGISTER_RATE_LIMIT_WINDOW_SECONDS` | `5` / `600` | 注册限流 |
| `BCRYPT_COST` | `10` | BCrypt 工作因子（测试用 4） |
| `ADMIN_SECOND_FACTOR_ENABLED` | `true` | 管理接口是否要求二次验证 |
| `ADMIN_SECOND_PASSWORD_HASH` | 空 | 二级密码 BCrypt 哈希；非 bcrypt 前缀启动即拒绝 |
| `ADMIN_DEFAULT_USER_PASSWORD` | `Lycoris123!` | 管理员重置密码的默认值（README 建议显式配置） |

Redis 缓存独立于 Java 的 `cache:marker:*` 命名空间，只存 ID 与缓存版本；缓存 key 中的
经纬度按 `f64::to_bits` 精确保留请求值。命中后仍回 PG 校验当前 `is_public+APPROVED` 并读取
最新内容；每条 Redis 命令 500ms 超时，故障、超时或坏 JSON 一律回源，不会排队到全局 HTTP 超时。
失效通过永不过期的 generation key 原子 `INCR` 切换命名空间（每次必然变化），不做
`FLUSHALL` / `KEYS` 扫描；提交后失效函数 `MarkerCache::invalidate` 供阶段 3 写接口调用，
禁用缓存时不访问 Redis。

> 生产部署请显式设置 `ADMIN_SECOND_PASSWORD_HASH` 与 `ADMIN_DEFAULT_USER_PASSWORD`。
> 与 Java 并行验收时，请为 Rust 实例设置独立 Cookie 名与命名空间，例如：
> `SESSION_COOKIE_NAME=LYCORIS_RUST_SESSION`、`SESSION_NAMESPACE=lycoris:rust:session:v1`；
> 正式默认仍为 `LYCORIS_SESSION`（可配置 Secure/Domain/SameSite=Lax/30d/HttpOnly/path=/）。

## 会话与密码边界

- 会话标识为两份 UUID v4 十六进制串（64 ASCII），Redis key 为标识的 SHA-256；
  Cookie 不承载身份。普通读取只取字段并延续 TTL，不轮换、不回写整份身份。
- 字段级更新全部在 Lua 中校验 key 存在与 `userId`/`sessionVersion`/观测角色一致；
  退出删除 key，旧请求的更新不会隐式创建 key，因此不会复活已退出的会话。
- 每个请求从 PG 重新加载账号并检查 `deleted`/`sessionVersion`/当前角色；权限只看数据库，
  会话中的角色不授予权限。
- 改密使用**短期转换标记**：写 PG 前先在 Redis 当前会话标记随机 nonce 与 60s 有界 pending
  （Redis 不可用则不写 PG，已有转换返回 409）；PG 提交后以同一 nonce 原子推进 sessionVersion、
  清 secondAt 与 pending；PG 明确冲突按 nonce 清 pending，结果不确定时让 pending 自行过期。
- 版本失配时**不无条件删除**：存在有效 pending 时这是正常转换窗口，短暂有界重读，仍未结束则
  503（绝不 401 或删除当前会话）；无 pending 才按读取快照 CAS 失效（key 存在、身份一致、
  且无效 pending 才删，检查与删除原子）。CAS 输给并发则重读，不会把普通并发请求变成虚假 401。
  真正陈旧的旧设备仍 401；退出由 logout 无条件删除，且退出后任何推进都不得复活会话。
- 角色变化用 CAS 同步观测角色并清除二次验证；Redis 错误返回 503，不忽略后继续授权；
  CAS 输给并发同步或 logout 时重读（退出即匿名），并把本次返回的二次验证时间清空。
  `VerifiedAdmin` 要求 elapsed 落在 `0..=TTL`，未来时间同样拒绝。
- 改密/重置/删除/恢复在 PG 事务内推进 `sessionVersion` 与 `rowVersion`；改密保留当前会话，
  其他会话失效。PG 提交后 Redis 失败不会谎称回滚（改密成功后清 Cookie 并提示重新登录）。
- 登录与注册都携带请求旧标识并原子轮换一次。logout 的 Redis 删除失败返回 503、不声称退出成功、
  不清 Cookie（否则 Redis 恢复后旧 token 仍可用）。
- BCrypt 默认 cost 10，`spawn_blocking` 持有许可直至任务真正结束；超过 72 字节先拒绝，
  历史明文仅在存储值无 BCrypt/`{}` 前缀时比较，成功后条件升级；不记录密码、哈希或标识。
  `Identity`/`UserRow` 的 Debug 已脱敏，含密码的请求 DTO 不派生 Debug。
- 注册在单一事务级 advisory lock 下重新检查用户名与规范化邮箱（历史库允许重复，本轮
  不加唯一索引、不自动清理账号）。密码哈希在持锁前完成。

## 测试

`tests/integration.rs`、`tests/markers_read.rs`、`tests/auth_integration.rs` 与
`tests/media_http.rs` 使用标准 Rust 测试与 `tower::ServiceExt::oneshot`（认证用例另有真实
HTTP 观察），不启动常驻外部 HTTP 服务器。每个用例从测试管理员连接创建 UUID 命名的临时库、
应用迁移、构造 Router 并断言；无论成功失败都会删除自己的临时库。服务不可用时测试直接失败，
不做静默跳过。只允许连接回环地址上的合成测试服务；需要上传根的基础测试各自使用
`tempfile::TempDir` 并保持生命周期，不写真实 `uploads/`，也不遗留全局临时目录。

`tests/auth_integration.rs` 覆盖 11 条认证/用户路由与关键边界：Java 合成 BCrypt 向量、
历史明文升级与哈希字面量拒绝、重复历史账号不授权、登录后 Cookie 稳定、失败登录保留会话、
**旧快照 CAS 不能删除已推进的新版本**、**改密 pending 窗口内 /me 为 503/推进后 200（绝不 401）**、
改密转换状态（begin/AlreadyPending/409/cancel/退出后不复活/过期 pending 不阻止失效）、
退出/二次验证 CAS 竞争、注册轮换旧会话、重置/删除/恢复会话失效、角色变化清二次、
**角色同步 CAS 竞争**、二次验证过期与未来时间拒绝、**角色不足 403 为 Boot 默认 JSON（含 path/status/error 与可解析 timestamp）**、
并发注册唯一性、限流与**坏/受限 Redis 的 503（含 logout DEL 失败不声称成功）**、
可信代理与 IP 伪造、写来源校验（same-site 仍校验 Referer、非法 FetchMetadata 拒绝）、
原生 App 无浏览器头放行、资料 null/空串、管理员分页/搜索/软删除形状、JSON 媒体类型与 413。

`tests/media_http.rs` 覆盖头像 3 路由、受控 `/uploads`、私有点位 detail 与阶段 3 的 5 条图片
路由：Cookie 登录后属主/管理员可见私有待审、匿名与他人 404；头像完整上传 → `/api/me/avatar` →
公共 ID 头像 → `/uploads/avatars/*` 全链路（MIME、`Cache-Control`、`nosniff`、`Content-Length`、
7 字段 `UserResponse`）；无图/已删/非法引用 404；未登录 401 与写来源拒绝；multipart 覆盖
缺 `file`/空文件/重复 `file`/无效图/超 5 MiB/整个请求超 8 MiB（含无 `Content-Length` 尾随
未知字段与已知 `Content-Length` 提前拒绝）均为契约形状 413，>2 MiB 且 <5 MiB 合法输入通过
（证明 Axum 默认 2 MiB 已被 8 MiB 覆盖）；`/uploads/markers` 的匿名/属主/管理员/他人访问矩阵；
avatars 与匿名 markers 读取在 Redis 不可用时仍可读（不加载会话）。阶段 3 另覆盖：`POST
/api/markers/{id}/image` 成功并按 `lang` 本地化、只建 `PENDING` 提案且不改 `mark_image`、
匿名/他人看不到待审文件而属主/管理员/有权限提案者可见、非法/超限沿头像已验证 helper 且点位接口
413 形状；4 条管理路由的管理员与二次验证矩阵（匿名 401 固定 JSON、普通用户 403 Boot JSON、
未二次 403 文本），审批返回本地化 `MarkerDto`、重复/提案缺失/关联点位缺失错误，驳回后与关联
点位删除后的图片权限维持媒体核心，两条审批 HTTP 并发只有一个成功，清理只取消确实缺失的引用
且不删文件。另含：**已允许 Origin 的已知 `Content-Length` 超限 413 与流式 multipart 超限 413
都带 `Access-Control-Allow-Origin`/`Credentials` 与 `Vary`，非白名单 Origin 不发 allow-origin**；
**不读 body 的 `GET /health/live` 带超限 `Content-Length` 仍 413**；JSON 提取器超限为结构化
`{"code":413,"message":"上传文件过大，请选择 5MB 以内的图片"}`、读取中途出错为 400
`请求体读取失败`；**成功、404 fallback 与全局 body limit 413 都带合法且互不相同的服务端
`X-Request-ID`（客户端伪造的 ID 不被照搬），且允许来源可通过 `Access-Control-Expose-Headers`
读取该头**。

每个用例使用 UUID 命名临时库与随机 Redis 命名空间，不 `FLUSHALL`、不 `KEYS`，
只连接回环地址上的合成测试服务；失败不做静默跳过。

```powershell
# 在 backend-rust 目录一步完成：迁移合成库、校验 .sqlx、离线构建、fmt / clippy / test
pwsh ./scripts/check-rust.ps1

# 或在 backend-rust 目录直接运行（合成服务已启动并迁移）
$env:SQLX_OFFLINE = "true"
$env:RUST_TEST_THREADS = "4"
cargo test --locked
```

可用 `TEST_DATABASE_URL` / `TEST_REDIS_URL` 覆盖测试地址，但脚本在**执行任何 `database create`
或 `migrate` 之前**先校验：

- scheme：PostgreSQL 仅 `postgres`/`postgresql`，Redis 仅 `redis`/`rediss`；
- 拒绝任何 query 或 fragment（SQLx 的 `host`/`hostaddr`/`dbname` 覆盖参数在这里被直接拒绝），
  并拒绝数据库路径中的 `%`/`\` 等编码或非法字节；
- 主机只接受 `127.0.0.1`/`::1`/`localhost`（或 `IPAddress.TryParse` 后静态
  `IPAddress.IsLoopback` 为真），按字符串前缀“`127.`”授权被移除；`127.example.invalid`
  之类外网 DNS 名会被拒绝；
- 迁移目标库名只允许完整 `lycoris_rust` 或 `^lycoris_test_[A-Za-z0-9_]+$`；`restore_review`/
  `contract_review` 等父级/持有库被拒绝。

错误信息不回显连接串或密码。`.sqlx` 离线元数据由 `cargo sqlx prepare`（SQLx CLI 0.9.0）生成
并由脚本校验；`SQLX_OFFLINE=true` 时无需数据库即可编译。脚本在未显式设置 `RUST_TEST_THREADS`
时默认 4，避免 1 GB 测试 PG 在并行建库时 OOM；显式正整数会覆盖该默认值。请勿在多个工作树
同时运行整套门禁，避免共享测试 PG OOM。正常 UUID 临时子库由各用例自行创建与清理，脚本不按
前缀枚举或批量删除。

## 连接与数据目录

| 组件 | 地址 | 凭据 |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:55432` | 用户 `lycoris` / 密码 `lycoris_local_test` / 库 `lycoris_rust` |
| Redis | `127.0.0.1:56379` | 无密码 |

测试用户为超级用户，集成测试可创建并删除临时数据库。持久卷为
`lycoris-rust-postgres-data`、`lycoris-rust-redis-data`。容器名固定
`lycoris-rust-postgres`、`lycoris-rust-redis`，端口仅绑定回环地址。

## 迁移边界（重要）

- `migrations/0001_baseline.sql` 只用于**空库初始化**，与
  [../docs/rust-migration/schema-baseline.sql](../docs/rust-migration/schema-baseline.sql)
  逐字一致（6 张表、无数据）；本轮未新增任何迁移或唯一索引。
- 普通启动只做只读校验，确认所需迁移已应用且校验和一致，**不会自动执行 DDL**；
  空库需在 `backend-rust/` 内显式运行 `cargo run --locked -- --migrate`。
- **禁止把初始建表重复用于已有库**。已有库（有业务表、无 `_sqlx_migrations`）使用
  `--check-baseline` 只读预检后 `--adopt-baseline` 核对接管：接管使用 SQLx 同一把迁移锁，
  只登记原始基线真实校验和，不执行基线 DDL、不改业务行/ID/序列值/业务结构；结构或历史不匹配
  一律拒绝，失败不留伪完成历史。结构期望由已审查基线生成的 `src/baseline/expected.rs` 维护，
  接管只在目标库读取系统目录比较，不在目标库重放基线 DDL。阶段 5 新增迁移后仍用 `--migrate` 升级。
- 接管运行前提（仅记录，不实现线上操作）：应在备份完成、写入冻结或明确切换窗口内执行；
  发布决策计数（重复有效用户名/规范化邮箱组、不合法经纬度与 NaN/Infinity 行数）只输出聚合计数，
  不输出身份值，不自动加唯一索引或合并账号。

## 边界与后续

- **43 个既有契约模板全部挂载**：阶段 1/2 的 **19** 条（5 公开读 + 9 AuthController +
  4 AdminUserController + 1 AdminAuthController）、阶段 3 的 **18** 条点位写入/收藏/审核非图片
  路由与 **5** 条图片路由，以及受控 `/uploads/{directory}/{filename}` 契约 1 条（由 Rust 拆为
  `avatars`/`markers` 两条显式路由）；`/health/live`、`/health/ready` 两个探针另列。
- `OptionalUser` 提取器用于私有点位 detail 与 `markers` 图片读取，按数据库当前身份构造真实
  `Viewer`；`avatars` 读取不加载会话。图片上传只建 `PENDING` 提案，审批/清理复用
  `MediaService` 事务、授权与缓存失效。
- 阶段 3 已由温晓完成本地验收，发布演练继续按阶段 4 执行。
- 固定查询使用 SQLx 编译期宏（`queries/*.sql` + `.sqlx` 离线元数据），用户值全部 bind；
  仅临时测试库名等真正动态 SQL 使用运行期 `AssertSqlSafe`。`.sqlx` 已在本工作树生成并校验。
- 不包含应用容器，不接入生产，不保存真实数据；不操作 `lycoris-restore-review` 容器。
- 认证最终形态（CSRF、多因素等）另案重设计，本轮不引入 JWT/OAuth。
