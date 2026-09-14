# Lycoris 现有 HTTP API 契约盘点（阶段 0）

- 基线提交：`8c60383`（分支 `refactor/rust-backend`）
- 盘点对象：`backend/src/main/java/com/lycoris` 现有 Java 源码，未运行任何接口
- 计数口径：按真实 HTTP 处理方法计数（`@GetMapping` / `@PostMapping` / `@PatchMapping` / `@DeleteMapping`），类级 `@RequestMapping` 只作为路径前缀，不计为接口
- 接口总数：**43**（AuthController 9 + MarkerController 15 + AdminMarkerController 13 + AdminUserController 4 + AdminAuthController 1 + UploadController 1）
- 性质：初版为**源码契约盘点**；后续运行确认单列在第 7 节，不能把源码分支直接当作运行时已覆盖的行为。
- 认证基线：本轮延续现有 Cookie + Session 体验作为阶段 2 基线；`JWT` / `OAuth` 等未引入，认证重设计另列待办

## 1. 全局约定

### 1.1 会话与 Cookie

- Cookie 名默认 `LYCORIS_SESSION`，可通过 `SESSION_COOKIE_NAME` 覆盖；路径 `/`，`HttpOnly=true`，`SameSite=Lax`，`Secure=false`（默认，生产由环境变量决定），`Max-Age=30d`，`Domain` 默认空。参见 `SessionCookieConfig` 与 `application.yml`。
- 服务端会话超时默认 `30d`。Spring Session 命名空间默认 `lycoris:session`，`store-type` 默认 `none`（即默认非 Redis；启用 Redis 需显式配置）。
- 登录与注册成功都会轮换一次会话 ID（`request.changeSessionId()`），之后普通请求不再轮换；登录/注册会清空 `adminSecondVerified` / `adminSecondVerifiedAt`。
- 会话中保存：`userId`、`username`、`email`、`role`、`sessionVersion`（登录/注册时），以及管理员二次验证状态 `adminSecondVerified`、`adminSecondVerifiedAt`。
- `SessionAuthFilter` 每个请求都清空再重建认证：若用户不存在、`deleted=true`、或会话 `sessionVersion` 与数据库 `User.sessionVersion` 不一致，则直接 `session.invalidate()`（后续受保护请求返回 401）。角色变化时清空二级验证状态。
- 修改密码、重置密码、软删除、恢复用户都会自增 `sessionVersion`，使旧会话失效。

### 1.2 认证级别定义

- **匿名**：SecurityConfig `permitAll`，无需登录。
- **登录**：需要有效会话（`authenticated`）。
- **管理员**：需要 `ROLE_ADMIN`（SessionAuthFilter 依据数据库当前角色重建权限，不信任会话缓存角色）。
- **管理员+二次验证**：在管理员基础上，`admin.second-factor-enabled=true`（默认）时还要求 `adminSecondVerified=true` 且未超过 30 分钟（`adminSecondVerifiedAt` 为毫秒时间戳）。注意 `/api/markers/all` 只要求管理员，**不**要求二次验证。

### 1.3 响应体与错误体格式（四类，需分别保留）

1. **认证入口拦截（SecurityConfig authenticationEntryPoint）**：HTTP `401`，`Content-Type: application/json; charset=UTF-8`，体固定为 `{"message":"Spring Security Error"}`。所有被 Spring Security 拦截的未认证请求都用这个形状，与业务 `ApiResponse` 不同。已认证但角色不足（如非管理员访问 `/api/admin/**`）由 Spring Boot 默认错误分派处理，返回 **403 JSON**：`{"timestamp":"...ISO-8601...","status":403,"error":"Forbidden","path":"<请求 path>"}`（**不是空体**；此项已由真实 Java 运行验证）。管理员二次验证失败的 `403` 仍是中文纯文本，不受此形状影响。
2. **`ApiResponse` JSON**：形状为 `{"code":<int>,"message":"...","data":<值或null>}`，成功为 `{"code":0,"message":"ok","data":...}`。使用者**仅为 AuthController** 的全部 JSON 处理器（登录/注册/me/资料/改密/退出）与 `GlobalExceptionHandler`（409、413），不是“认证/用户相关接口”的统称。`code` 与 HTTP 状态码不总一致（登录 401/`code 4001`、注册 400/`code 4002` 等）。
3. **纯文本 `String` 响应体（非 JSON）**：MarkerController、AdminMarkerController、AdminAuthController、AdminUserController、UploadController 的错误体，以及点位/提案操作成功时的空体；二次验证失败体也是中文纯文本（如 `需要二级密码`）。**注意**：字符串响应经 `StringHttpMessageConverter` 输出，其 charset 行为未在本次源码盘点中运行确认，属待验证项，不应假定与 `ApiResponse` 的 UTF-8 完全一致。
4. **普通 JSON（非 `ApiResponse`）**：AdminUserController 的成功体（`{"message":...}`、分页 `{"page","size","totalPages","totalElements","items"}`）、AdminMarkerController 的 `pending-edits`/`pending-images` 列表与 `cleanup-missing-images` 结果 `{"checked","cleared","message"}`，均为普通 Map/List JSON，没有 `code/message/data` 包装。

> 全局并发/上传异常（`GlobalExceptionHandler`）属于第 2 类：`OptimisticLockingFailureException` / `OptimisticLockException` → `409 ApiResponse{code:409,"数据已更新，请刷新后重试"}`；`MaxUploadSizeExceededException` → `413 ApiResponse{code:413,"上传文件过大，请选择 5MB 以内的图片"}`。

> **Rust 新增运行边界（阶段 4，详见 `stages-4-5-design.md` 与 `README`）**：服务连接上的 SQL 语句超时（SQLSTATE `57014`）与锁等待超时（SQLSTATE `55P03`）按各接口**既有错误形状**受控映射为 **503 `服务暂时不可用`**（Auth 普通 JSON、点位写/读中文纯文本、媒体 `ApiResponse`/文本），不再落入 500；失败事务整体回滚且不自动重试，PG 提交后的缓存/清理成功语义不变。未知数据库错误仍为 500。该 503 属 Rust 运行参数边界，不是 Java 已有行为。

### 1.4 语言与本地化

- 支持语言仅 `zh` / `en`。`MarkerLanguage.normalize`：先 trim、转小写、把 `_` 换成 `-`，之后仅当值为 `en` 或以 `en-` 开头时归一为 `en`，值为 `zh` 或以 `zh-` 开头时归一为 `zh`，其它或空一律回退 `zh`（**不是**任意 `en*`/`zh*`）。
- 读取：`MarkerLocalizationAdvice`（`ResponseBodyAdvice`）对所有 `MapMarker` 单对象/列表响应做本地化，并在响应加 `Vary: Accept-Language, X-App-Language`。语言优先级：
  1. 显式查询参数 `lang`（只要参数存在就采用，经 `normalize`；空串也会落到 `zh`）；
  2. 否则走 `fromHeaders`：若 `Accept-Language` **存在且非空白**，解析它并取权重 > 0 的首个受支持语言；若解析抛异常则直接 `zh`；若其中没有任何受支持语言也直接 `zh`——**这两种情况都不再回退 `X-App-Language`**；
  3. 仅当 `Accept-Language` 缺失或空白时，才取 `normalize(X-App-Language)`（缺失即 `zh`）。
- 写入：`MarkerCreateRequest.language` / `MarkerUpdateRequest.language` 非 null 时优先（经 `normalize`）；为 null 时调用同一 `fromHeaders`；无请求上下文则 `zh`。因此写入语言同样遵循 `Accept-Language`（存在时）→ 否则 `X-App-Language` → `zh` 的顺序。
- 译文仅在 `markerId+language` 命中、语言为 `en`/`zh`、且 `sourceHash` 与当前原文一致时 `contentLanguage` 才等于目标语言；否则回退原文并以 `contentLanguage` 标识实际语言。原文哈希为 `[规范化语言, title或"", description或""]` 紧凑 UTF-8 JSON 的 SHA-256（非 ASCII 不转义、控制字符小写 `\uXXXX`）。
- 读操作只对副本本地化，不回写数据库、不推进版本。

### 1.5 默认参数、排序与分页

- `GET /api/markers/nearby`：`radius` 默认 `1000`，服务端夹取到 `1..50000`；`category` 默认 `accessible_toilet`；结果按球面距离升序。
- `GET /api/admin/users`：`page` 默认 `0`（负数归 0），`size` 默认 `10`（夹取到 `1..100`），排序固定 `id DESC`。
- 待审列表：点位 `PENDING` 按 `updatedAt DESC`；编辑/图片提案 `PENDING` 按 `createdAt DESC`。
- `GET /api/markers/public`、`/viewport`、`/search` 的顺序为 JPQL/派生查询默认顺序（未显式指定），不构成稳定排序契约。

### 1.6 资源级可见性（`MarkerAccess`）

- `isPublic(marker)`：`isPublic == true` 且 `reviewStatus == "APPROVED"`。
- `canView(marker, viewer)`：
  - viewer 非空且未删除，且为 `ADMIN` → true；
  - viewer 的 `publicId` 等于 marker 的 `userPublicId` → true；
  - 否则等于 `isPublic(marker)`。
- 因此私有/未审核点位对非属主返回 **404**（不是 403），以免暴露存在性。

### 1.7 幂等与并发

- 创建点位：`clientRequestId`（trim，空串视为 null，最长 64）与 `user_public_id` 组成唯一约束 `uk_map_markers_user_client_request`。重复提交命中已存在记录时直接返回该点位；并发唯一冲突回查后返回既有记录。**注意**：返回 200 而非 201，也不区分首次与重放。
- 收藏：唯一约束 `uq_marker_fav_user_marker`；POST 收藏前先 `exists`，已收藏再次提交仍 200，删除未收藏项也 200（幂等）。
- 点位编辑走乐观锁（`@Version`）。审核编辑提案时校验 `baseMarkerVersion`；缺失或不等于当前 `marker.version` → **409**。同一提案重复审核：状态非 `PENDING` → **400 该提案已处理**；并发审核由 JPA 乐观锁回滚，输家整体回滚（GlobalExceptionHandler 落 409）。
- 原文编辑与译文编辑共用点位版本，以便并发冲突整体回滚。

### 1.8 上传与文件

- Servlet 层：`max-file-size=5MB`，`max-request-size=8MB`；超限 → 413（见 1.3）。
- `ImageUploadService`：上限 5MB，解码像素上限 25,000,000，边长 1..10000，允许 `JPEG/JPG/PNG/GIF/WEBP`。解码后重编码：有 alpha 存 `png`，否则存 `jpg`；文件名 `prefix-<uuid>.<ext>`；目录仅允许 `markers` / `avatars`。
- 头像上传保存到 `avatars`，点位图片提案保存到 `markers`，均返回 `/uploads/<dir>/<file>` URL。

## 2. 接口清单

### 2.1 AuthController（`@RequestMapping("/api")`，9 个）

| # | 方法 | 路径 | 认证 | 处理器 |
|---|------|------|------|--------|
| 1 | POST | `/api/login` | 匿名 | `login` |
| 2 | POST | `/api/register` | 匿名 | `register` |
| 3 | GET | `/api/me` | 登录 | `me` |
| 4 | GET | `/api/me/avatar` | 登录 | `meAvatar` |
| 5 | GET | `/api/users/{publicId}/avatar` | 匿名 | `userAvatarByPublicId` |
| 6 | PATCH | `/api/me` | 登录 | `updateMe` |
| 7 | POST | `/api/me/avatar` | 登录 | `uploadAvatar` |
| 8 | POST | `/api/me/password` | 登录 | `changePassword` |
| 9 | POST | `/api/logout` | 登录 | `logout` |

1. **POST /api/login**（匿名）
   - 请求 JSON：`{"username": "...", "password": "..."}`。`username` 字段同时接受用户名或邮箱：含 `@` 时按邮箱（小写）查未删除用户，否则按用户名精确查。
   - 成功 200：`ApiResponse{code:0,message:"ok",data:UserResponse}`（`publicId,username,nickname,email,avatarUrl,pronouns,signature`）；轮换会话 ID、设置会话属性、清空二级验证。
   - 失败 401：`{"code":4001,"message":"Invalid username or password","data":null}`（HTTP 401 但 body code 为 4001）。
   - 兼容分支：存量非 BCrypt 哈希（不以 `$2a$/$2b$/$2y$` 开头且不以 `{` 开头）按明文比较，成功后升级为 BCrypt；形如哈希的值绝不回退明文比较。
2. **POST /api/register**（匿名）
   - 请求 JSON：`{"username","nickname","email","password","website"}`。
   - 蜜罐：`website` 非空 → 400 `{"code":4004,"message":"注册请求无效"}`。
   - 限流：按客户端 IP（`X-Forwarded-For` 第一段，否则 remoteAddr），默认 5 次 / 600 秒，超限 → 429 `{"code":429,"message":"请求过于频繁，请稍后再试"}`。
   - 校验：`username` 非空、`email` 非空、`password` 长度 ≥ 4、用户名与邮箱唯一；不满足或重复 → 400 `{"code":4002,"message":"Username or email already exists"}`。
   - 成功 200：`ApiResponse{code:0,data:UserResponse}`，并直接登录（轮换会话 ID、写会话）。
3. **GET /api/me**（登录）
   - 无会话或用户不存在 → 401 `{"code":401,"message":"未登录"}`（用户不存在时同时清理会话属性）。
   - 成功 200：`ApiResponse{code:0,data:UserResponse}`。
4. **GET /api/me/avatar**（登录）
   - 未登录/用户不存在 → 401 空体。
   - 成功：头像字节流，按扩展名给 `image/jpeg|png|webp|gif`，`Cache-Control: public, max-age=600`。仅接受 `avatarUrl` 以 `/uploads/avatars/` 开头的值；路径穿越 → 400；文件缺失/非法 → 404。
5. **GET /api/users/{publicId}/avatar**（匿名）
   - `publicId` 非法或用户不存在/已删除 → 404 空体；否则同上返回头像字节。
6. **PATCH /api/me**（登录）
   - 请求 JSON：`{"nickname","pronouns","signature"}`，只处理非 null 字段；各字段 trim，`nickname` 空白回退为 `username`，`pronouns`/`signature` 空白置 null。
   - 未登录 → 401 `{"code":401,"message":"未登录"}`；用户不存在 → 404 `{"code":404,"message":"用户不存在"}`。
   - 成功 200：`ApiResponse{code:0,data:UserResponse}`。
7. **POST /api/me/avatar**（登录，multipart/form-data，参数 `file`）
   - 未登录 → 401 `{"code":401,"message":"未登录"}`；空文件 → 400 `{"code":400,"message":"文件为空"}`；非法图片 → 400（消息来自 `ImageUploadService`）；其它异常 → 500 `{"code":500,"message":"上传失败"}`；用户不存在 → 404。
   - 成功 200：`ApiResponse{code:0,data:UserResponse}`（含新 `avatarUrl`）。
8. **POST /api/me/password**（登录）
   - 请求 JSON：`{"oldPassword","newPassword"}`；缺任一 → 400 `{"code":400,"message":"缺少参数"}`。
   - 原密码错误或新密码长度 < 4 → 400 `{"code":400,"message":"原密码错误或新密码不合法"}`。
   - 成功 200：`ApiResponse{code:0,message:"ok",data:null}`；更新当前会话的 `sessionVersion`，清空二级验证。用户不存在 → 404。
9. **POST /api/logout**（登录）
   - `session.invalidate()`；成功 200 `ApiResponse{code:0,data:null}`。因 `anyRequest().authenticated()`，未登录时由 Security 返回 401。

### 2.2 MarkerController（`@RequestMapping("/api/markers")`，15 个）

| # | 方法 | 路径 | 认证 | 处理器 |
|---|------|------|------|--------|
| 10 | GET | `/api/markers/{id}` | 匿名（资源级 404） | `detail` |
| 11 | POST | `/api/markers` | 登录 | `create` |
| 12 | GET | `/api/markers/public` | 匿名 | `listPublicActive` |
| 13 | GET | `/api/markers/search` | 匿名 | `searchPublic` |
| 14 | GET | `/api/markers/nearby` | 匿名 | `nearbyPublic` |
| 15 | GET | `/api/markers/viewport` | 匿名 | `listByViewport` |
| 16 | GET | `/api/markers/all` | 管理员 | `listAll` |
| 17 | POST | `/api/markers/{id}/image` | 登录 | `uploadMarkerImage` |
| 18 | PATCH | `/api/markers/{id}` | 登录 | `updateMarker` |
| 19 | DELETE | `/api/markers/{id}` | 登录 | `deleteMarker` |
| 20 | POST | `/api/markers/{id}/favorite` | 登录 | `favorite` |
| 21 | DELETE | `/api/markers/{id}/favorite` | 登录 | `unfavorite` |
| 22 | GET | `/api/markers/me/favorites` | 登录 | `myFavorites` |
| 23 | GET | `/api/markers/me/created` | 登录 | `myCreatedMarkers` |
| 24 | GET | `/api/markers/me/favorites/details` | 登录 | `myFavoriteMarkers` |

- SecurityConfig 对 `GET /api/markers/{纯数字}` 放行（匿名），可见性由控制器 `MarkerAccess.canView` 判定，不可见返回 404。
10. **GET /api/markers/{id}**：`id` 为 Long 路径参数（安全放行仅匹配数字）。不可见 → 404 空体；可见 → 200 `MapMarker`（经本地化 Advice）。成功体为实体字段（见第 3 节）。
11. **POST /api/markers**（登录）：请求 `MarkerCreateRequest`。无会话 → 401 文本 `请先登录`；`lat/lng/category/title` 任一为 null → 400 文本 `缺少必要字段`。`category` 归一：`safe_place`/`dangerous_place` → `self_definition`，其余仅接受 `accessible_toilet/friendly_clinic/baby_room/self_definition`，否则 400 文本列出支持项；`clientRequestId` 超 64 → 400。创建后 `reviewStatus="PENDING"`、`isPublic` 默认 true、`isActive` 默认 true、`sourceLanguage` 按写入语言规则、`username/userPublicId` 取自会话。成功 200 返回新实体（非 201）。`DataIntegrityViolation` 且带 `clientRequestId` → 回查并返回已有点位。
    - **安全兼容收紧（2026-09-14）**：新建点位的 `markImage` 只接受 `null` 或空白串（空白归一为 `null`）；任何非空值返回 400 文本 `markImage 只能为空，请通过图片上传提交`。Java DTO 注释本已限定“先允许传空字符串或不传”，Web 新建草稿为空串、移动端提交 `null`；旧实现接受任意 URL 会让调用者伪造自己的点位引用，从而取得他人私有图片的读取权。收紧点在事务核心的首次完整校验处，因此不能从其它入口绕过；命中 `clientRequestId` 的幂等重放仍先返回原点位、不改动历史引用。
12. **GET /api/markers/public**：返回 `isPublic=true` 且 `APPROVED` 的列表（200）。
13. **GET /api/markers/search**：参数 `q`。空白 → `[]`。合并三类命中并去重：原文 `title/description/category/lat/lng` 模糊匹配、译文 `title/description` 模糊匹配（且译文哈希有效），以及 `q` 能被解析为坐标时 `lat/lng` 容差 `0.00015` 附近匹配；结果经本地化。成功 200 列表。
14. **GET /api/markers/nearby**：参数 `lat`、`lng`、`radius`（默认 1000）、`category`（默认 `accessible_toilet`）。
    - 缺 `lat/lng` → 400 文本 `缺少 lat/lng 参数`；越界 → 400 文本 `lat/lng 不合法`；`category` 不支持 → 400 文本；成功 200 列表，按距离升序，半径夹取 `1..50000`。
    - Redis 缓存 key `cache:marker:nearby:v1:...`，默认 TTL 12s；命中后仍按数据库当前可见性过滤。数据库未启用 PostGIS 的错误 → 500 文本 `数据库未启用 PostGIS，请先执行：CREATE EXTENSION postgis;`。
15. **GET /api/markers/viewport**：参数 `minLat,maxLat,minLng,maxLng` 必填，`categories`（逗号分隔，可空）。缺边界 → 400 `缺少视口边界参数`；`minLat>maxLat`/`minLng>maxLng` → 400 `边界参数不合法`；超出经纬度范围 → 400 `边界超出合法经纬度范围`。成功 200 列表，缓存前缀 `cache:marker:viewport:v1:`，默认 TTL 10s。
16. **GET /api/markers/all**（管理员）：返回全部点位，成功 200 列表。**不要求二次验证**。
17. **POST /api/markers/{id}/image**（登录，multipart，参数 `file`）：无会话 → 401 文本 `请先登录`；空文件 → 400 `文件为空`；点位不可见 → 404 `点位不存在`；创建 `MarkerImageProposal`（`PENDING`）后成功 200 返回原 marker；非法图片 400；其它 500 `上传失败`。
18. **PATCH /api/markers/{id}**（登录）：请求 `MarkerUpdateRequest`。无会话 → 401；点位不可见 → 404。不直接改点位，而是创建 `MarkerEditProposal`（`PENDING`），记录 `baseMarkerVersion = marker.version`、提案后的 category/title/description/language/isPublic/isActive/openTime 与 `proposerIsOwner`。开始/结束开放时间只填一个 → 400 `请同时填写开始和结束时间，或都留空`；目标语言无有效译文且未同时提供标题与描述 → 400 文本。成功 200 返回未修改的 marker。
19. **DELETE /api/markers/{id}**（登录）：无会话 → 401；点位不存在 → 404 `点位不存在`；非属主 → **403** `无权限`（区别于其它 404）；属主成功：先删该点位收藏再删点位，200 空体。
20. **POST /api/markers/{id}/favorite**（登录）：无会话 → 401；不可见 → 404 `点位不存在`；未收藏则新增；幂等成功 200 空体。
21. **DELETE /api/markers/{id}/favorite**（登录）：无会话 → 401；删除该用户对该点位的收藏（不存在也成功）；200 空体。
22. **GET /api/markers/me/favorites**（登录）：无会话 → 401；返回可查看的收藏点位 **ID 列表**（`List<Long>`），不可见项被过滤。
23. **GET /api/markers/me/created**（登录）：无会话 → 401；返回该用户 `userPublicId` 创建的点位列表（含私有点位，未按可见性过滤）。
24. **GET /api/markers/me/favorites/details**（登录）：无会话 → 401；返回可查看的收藏点位完整对象列表；无收藏返回 `[]`。

### 2.3 AdminMarkerController（`@RequestMapping("/api/admin/markers")`，13 个）

除另行标注外，均为**管理员+二次验证**（默认启用）。二次验证不通过 → 403 文本 `需要二级密码`；超过 30 分钟 → 403 文本 `二级密码已过期，请重新验证`（并清除状态）。

| # | 方法 | 路径 | 处理器 |
|---|------|------|--------|
| 25 | GET | `/api/admin/markers/pending` | `pendingList` |
| 26 | POST | `/api/admin/markers/{id}/approve` | `approve` |
| 27 | GET | `/api/admin/markers/pending-edits` | `pendingEditProposals` |
| 28 | POST | `/api/admin/markers/edit-proposals/{id}/approve` | `approveEditProposal` |
| 29 | POST | `/api/admin/markers/edit-proposals/{id}/reject` | `rejectEditProposal` |
| 30 | POST | `/api/admin/markers/{id}/reject` | `reject` |
| 31 | GET | `/api/admin/markers/pending-images` | `pendingImages` |
| 32 | POST | `/api/admin/markers/image-proposals/{id}/approve` | `approveImageProposal` |
| 33 | POST | `/api/admin/markers/image-proposals/{id}/reject` | `rejectImageProposal` |
| 34 | GET | `/api/admin/markers/all` | `listAll` |
| 35 | PATCH | `/api/admin/markers/{id}` | `adminUpdate` |
| 36 | DELETE | `/api/admin/markers/{id}` | `adminDelete` |
| 37 | POST | `/api/admin/markers/cleanup-missing-images` | `cleanupMissingImages` |

25. **GET /pending**：返回 `reviewStatus=PENDING` 点位，按 `updatedAt DESC`。
26. **POST /{id}/approve**：设 `reviewStatus="APPROVED"` 并保存；不存在 → 404 文本 `点位不存在`。
27. **GET /pending-edits**：返回 `PENDING` 编辑提案（`createdAt DESC`），字段：`id,markerId,markerTitle,lat,lng,category,title,description,language,isPublic,isActive,openTimeStart,openTimeEnd,proposerUsername,proposerPublicId,proposerIsOwner,status,createdAt`。
28. **POST /edit-proposals/{id}/approve**：提案不存在 → 404 `编辑提案不存在`；状态非 `PENDING` → 400 `该提案已处理`；关联点位不存在 → 404 `关联点位不存在`；`baseMarkerVersion` 缺失或 ≠ 当前 `marker.version` → **409** `点位已更新或提案缺少版本信息，请按最新内容重新提交后审核`；否则在**同一事务**内更新点位（category/isPublic/isActive/openTime、`reviewStatus=APPROVED`、lastEditedBy 系列）、写入译文，提案置 `APPROVED` 并记录 `reviewedBy/reviewedAt`；成功 200 返回更新后的 marker。
29. **POST /edit-proposals/{id}/reject**：404/400 同上；置 `REJECTED`，记录审核人/时间，成功 200 空体。
30. **POST /{id}/reject**：设点位 `reviewStatus="REJECTED"`；404 `点位不存在`。
31. **GET /pending-images**：`PENDING` 图片提案（`createdAt DESC`），字段：`id,markerId,markerTitle,proposerUsername,proposerPublicId,imageUrl,status,createdAt`。
32. **POST /image-proposals/{id}/approve**：提案 404 `图片提案不存在`；非 PENDING → 400 `该提案已处理`；关联点位 404 `关联点位不存在`；否则 `marker.markImage = proposal.imageUrl` 后保存，提案置 `APPROVED`；成功 200 返回 marker。
33. **POST /image-proposals/{id}/reject**：同上；提案置 `REJECTED`，成功 200 空体。
34. **GET /all**：返回全部点位。
35. **PATCH /{id}**：管理员直接改点位（不生成提案）。按请求非 null 字段改 category/isPublic/isActive/openTime，`resolveEditText` 处理本地化文本，`reviewStatus="APPROVED"`，保存并返回；不存在 → 404。
36. **DELETE /{id}**：删除点位（会级联删译文与收藏，见服务层）；404 `点位不存在`；成功 200 空体。
37. **POST /cleanup-missing-images**：扫描所有点位 `markImage` 以 `/uploads/markers/` 开头但文件不存在的记录，置空 `markImage`；成功 200 JSON `{"checked":<int>,"cleared":<int>,"message":"失效图片链接清理完成"}`。

### 2.4 AdminUserController（`@RequestMapping("/api/admin/users")`，4 个）

均需**管理员+二次验证**（默认），失败同 2.3。

| # | 方法 | 路径 | 处理器 |
|---|------|------|--------|
| 38 | GET | `/api/admin/users` | `listUsers` |
| 39 | POST | `/api/admin/users/{id}/reset-password` | `resetPassword` |
| 40 | DELETE | `/api/admin/users/{id}` | `deleteUser` |
| 41 | POST | `/api/admin/users/{id}/restore` | `restoreUser` |

38. **GET**：参数 `page`（默认 0，负值归 0）、`size`（默认 10，夹取 1..100）、`q`（可选，模糊匹配用户名/昵称/邮箱，大小写不敏感）。按 `id DESC` 分页。成功 200 JSON：`{"page","size","totalPages","totalElements","items":[{"id","publicId","username","nickname","email","avatarUrl","pronouns","signature","role","deleted","deletedAt"}]}`（`publicId` 为字符串或 null）。
39. **POST /{id}/reset-password**：用户不存在 → 404 文本 `用户不存在`；已删除 → 400 文本 `已删除用户不能重置密码`；否则重置为配置 `admin.default-user-password`（默认 `Lycoris123!`），自增 `sessionVersion`；成功 200 JSON `{"message":"密码已重置为默认密码","username":"..."}`。
40. **DELETE /{id}**：删除自己（会话 `userId == id`）→ 400 文本 `不能删除当前登录管理员账号`；未找到未删除用户 → 404 `用户不存在`；否则**软删除**（`deleted=true`、`deletedAt`、自增 `sessionVersion`）；成功 200 JSON `{"message":"用户已删除"}`。
41. **POST /{id}/restore**：不存在 → 404 `用户不存在`；未被删除 → 400 文本 `该用户未被删除`；否则恢复并自增 `sessionVersion`；成功 200 JSON `{"message":"用户已恢复"}`。

### 2.5 AdminAuthController（`@RequestMapping("/api/admin")`，1 个）

42. **POST /api/admin/verify**（管理员）
    - 请求 JSON：`{"passcode":"..."}`。
    - `admin.second-password-hash` 未配置 → 403 文本 `未配置二级密码`；`passcode` 空 → 400 文本 `缺少二级密码`；不匹配 → 403 文本 `二级密码错误`。
    - 成功 200 空体，设置 `adminSecondVerified=true`、`adminSecondVerifiedAt=当前毫秒`。有效期 30 分钟。

### 2.6 UploadController（无类级前缀，1 个）

43. **GET /uploads/{directory}/{filename}**（目录 `avatars` 匿名；`markers` 需可见性）
    - `directory` 仅允许 `avatars`/`markers`，`filename` 匹配 `[A-Za-z0-9_.-]+`，扩展名仅 `jpg/jpeg/png/gif/webp`，否则 404。
    - `markers`：`canReadMarkerImage` 判定。先看是否存在 `markImage` 等于该 URL 且对当前 viewer 可见的点位，有则可读；否则 viewer 为 null 时不可读。再对每个 `imageUrl` 等于该 URL 的图片提案判断：**要求关联点位存在**（`markers.findById(proposal.markerId)` 命中），且满足其一——viewer 为管理员，或 viewer 的 `publicId` 等于该点位属主 `userPublicId`，或 viewer 的 `publicId` 等于提案 `proposerPublicId` 且该点位对 viewer 可见。**提案状态不参与判断**（源码没有 `status=PENDING` 条件，历史或已审核提案同样适用）。不满足则 404（私有图片不可读）。
    - `avatars`：无额外权限检查。
    - 路径穿越、非普通文件、缺失 → 404。成功：对应图片 MIME，`X-Content-Type-Options: nosniff`，`Cache-Control: no-store`。

## 3. MapMarker 成功响应字段

`id, version, lat, lng, category(归一后), title, description, sourceLanguage, contentLanguage(本地化时), isPublic, username, userPublicId, clientRequestId, isActive(按 Asia/Shanghai 开放时间实时计算), openTimeStart, openTimeEnd, reviewStatus, lastEditedBy, lastEditedByPublicId, lastEditedByOwner, markImage, createdAt, updatedAt`。

- 读取时对副本计算 `isActive`，不回写、不推进 `version`。
- `category` 读取时归一：不在支持集合的旧值 → `self_definition`。

## 4. 私有图片 404、审核冲突 409 与幂等要点汇总

- **私有图片 404**：`GET /uploads/markers/*` 对非授权者一律 404（不泄露存在性）；`GET /api/markers/{id}` 对不可见点位 404。
- **审核版本冲突 409**：编辑提案审核时 `baseMarkerVersion` 缺失或不等于当前点位版本 → 409 `点位已更新或提案缺少版本信息，请按最新内容重新提交后审核`；并发乐观锁失败经全局处理 → 409 `数据已更新，请刷新后重试`。
- **幂等**：创建点位 `clientRequestId` + 唯一约束；收藏 `POST/DELETE` 幂等。
- **上传限制**：请求 5MB / 8MB，业务 5MB、2500 万像素、边长 ≤ 10000。
- **新建点位图片引用收紧**：`POST /api/markers` 的 `markImage` 非空即 400（`markImage 只能为空，请通过图片上传提交`）；图片统一经上传提案 + 审核写入，避免伪造引用读取他人私有图片。幂等重放仍返回原点位。

## 5. 待办：认证后续重设计（不在本次实现）

- 现有 Cookie + Spring Session（Java 序列化）+ BCrypt 仅为兼容基线。Rust 侧不要直接读取 Java 序列化会话；正式切换建议让用户重新登录一次，使用独立会话命名空间与 Cookie 名做并行验证。
- 需专项明确：会话/凭据最终形态、CSRF 策略、并发会话读改写保护、二次验证是否升级为真正的多因素、密码格式迁移与回退兼容。
- 本次不引入 `JWT` / `OAuth`，不把过渡方案写死为永久契约。

## 6. 覆盖性与计数自检

- 计数命令：对 `backend/src/main/java/com/lycoris/controller` 下 `@GetMapping/@PostMapping/@PatchMapping/@DeleteMapping` 逐方法统计（类级 `@RequestMapping` 不计）。
- 结果：AuthController 9、MarkerController 15、AdminMarkerController 13、AdminUserController 4、AdminAuthController 1、UploadController 1，合计 **43**。
- 本盘点不包含任何运行测试结论；所有状态码、错误体与默认值均来自源码阅读，运行期 charset、异常包装顺序等仍需阶段 1/2 的真实请求验证。

## 7. 后续 HTTP 运行确认

2026-09-14，温晓在隔离 PostgreSQL 18.6 / Redis 8.10.1 上运行旧 Java 3.5.9，使用合成账号和点位检查：

- 点位成功对象包含本文件第 3 节列出的 **23 个字段**。JSON Content-Type 为 `application/json`；自定义点位错误文本为 `text/plain;charset=UTF-8`。
- 缺失 nearby 的必需 `lat/lng` 参数时，Spring 参数提取先于控制器运行，返回 HTTP 400 的框架 JSON（含 timestamp/status/error/path）；控制器内“缺少 lat/lng 参数”文本分支没有被该请求走到。Rust 保持 400 并给出明确文本错误，不复制 Spring 的时间戳错误页。此项属于参数解析错误表现差异，成功数据及业务授权状态继续对齐。
- `GET /api/me` 在正确连接隔离 Redis 时返回 401 `{"message":"Spring Security Error"}`。最初只用于恢复库公开读取的 Java 进程没有配置正确 Redis 地址，该环境下的认证错误不能作为兼容样本。
- `Accept-Language: en;garbage`、`en;q=0.5;extra=1`、`en--x`、`en_` 均回退 zh；重复区间 `en;q=0,zh;q=0.5,en;q=1` 也返回 zh（首个同名区间生效），不能按最大重复权重选择 en。
- 空点位列表的 Java Advice 没有加语言 Vary；Rust 对空列表也保留语言 Vary，这是不改变响应数据的缓存声明补全。


## 阶段 5 附近查询的实现与兼容边界

上文保留原 Java 契约的盘点记录。Rust 阶段 5 保持 `/api/markers/nearby` 的请求参数、1～50000 米半径夹取、类别与可见性、本地化及 DTO；距离仍按半径 6371000 米的 Haversine 公式最终筛选，按距离与 ID 排序。内部改为 PostGIS geography/GiST 保守候选与有限越界历史坐标的兼容分支，缓存键版本改为 `nearby:v2`。视口查询保持原实现。

两项有意的行为修复单独记录：历史 NaN/Infinity 坐标不进入附近结果，避免旧查询三角函数异常使整个请求失败；旧经度包围盒在未跨极点的高纬度场景可能漏点，新查询按产品球面距离包含这些点。正常有限数据的旧、新查询 ID 与顺序在三种合成规模中一致；异常修复不表述为旧、新行为完全相同。测试和具体边界见 [空间查询验收](stage5-spatial.md)。

增量 `0002_spatial.sql` 由旧经纬度列生成 STORED geography，并增加空间与异常坐标索引。SQLx 接管旧库只登记原始 0001；显式 `--migrate` 执行 0002 后再启动新版。Java 应用回退保留生成列和索引；旧阶段 4 Rust 不认识 0002，会拒绝未知迁移，不作为此结构的应用回退版本。数据库结构回退需要单独的完整迁移方案，不能删除生成列却保留“0002 已应用”的历史记录。
