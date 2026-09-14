# Database migrations

## 2026-09-06 中英文点位

双语后端上线记录（2026-09-06）：SSH 已恢复，新后端与首批英文译文已部署到生产。当时网页和手机的新界面尚未发布；本记录不表示后续性能改动已部署。首批译文由当前协作任务直接翻译；未接入外部翻译 API、GitHub Actions 或定期自动翻译。下文保留迁移和后续操作说明。

### 生产执行记录（2026-09-06）

- 已创建并验证 `pg_dump` 备份，生产按顺序执行版本迁移、语言迁移，随后部署新后端。
- 已导入 359 条公开且 `APPROVED` 点位的英文译文，结果为 `saved=359`、`changed_or_protected=0`。全库 382 条原文的校验摘要前后一致；5 条私有点位与 18 条 `REJECTED` 点位不在本批导入范围。
- 本次在隔离 PostgreSQL 17 数据库副本及正式接口逐条核对 359 条中英文列表，并抽查详情语言选择、双语搜索、viewport/nearby 和匿名访问权限；缺译回退及私有详情限制在隔离副本验证。此验证独立于下文此前的单元及 PostgreSQL 16 测试。
- 新源站 HTTPS 经代理访问返回 HTTP 200；外部 Cloudflare 域名入口仍待核对。此状态不表示网页或手机新界面已发布。

### 迁移与索引

在 `backend-old/` 目录操作，先将数据库备份到仓库外的受控目录，再执行 [2026-09-06-marker-translations.sql](2026-09-06-marker-translations.sql)。连接使用当前环境的 PostgreSQL `PG*` 设置；不要将密码、备份或点位导出文件提交到仓库。将下面的 `<private-directory>` 替换为仓库外的绝对路径。

```sh
pg_dump --format=custom --file="<private-directory>/before-marker-translations.dump"
psql -X -v ON_ERROR_STOP=1 -f deploy/migrations/2026-09-06-marker-translations.sql
```

新后端仍依赖前一版的会话及乐观锁字段；尚未应用的环境应先执行 [2026-09-05-bugfix-versions.sql](2026-09-05-bugfix-versions.sql)。双语迁移只新增列、表和约束，保留原有标题、描述及点位 ID。即使启用 Hibernate 自动更新，也应执行正式迁移，以建立明确的唯一约束和删除级联外键。

| 类型 | 内容 | 执行要求 |
| --- | --- | --- |
| 必选 | `map_marker_translations` 主键及 `uk_map_marker_translation_language UNIQUE (marker_id, language)` | 双语迁移一并创建；唯一约束对应的索引用于按点位和语言定位译文，并保证导入 upsert 的唯一性。 |
| 可选 | 标题、描述的 `pg_trgm` GIN 索引 | 先根据实际搜索的 `EXPLAIN ANALYZE` 结果决定，脚本见 [2026-09-06-marker-search-indexes.optional.sql](2026-09-06-marker-search-indexes.optional.sql)。 |

可选脚本需要相应的扩展及建索引权限，使用 `CREATE INDEX CONCURRENTLY`，必须在事务之外执行，不要添加 `-1` / `--single-transaction`：

```sh
psql -X -v ON_ERROR_STOP=1 -f deploy/migrations/2026-09-06-marker-search-indexes.optional.sql
```

### 数据与语言规则

`map_markers.title`、`description` 保留创建时语言的原文；新增 `source_language`（JSON 字段 `sourceLanguage`）取 `zh` 或 `en`，旧行默认 `zh`。创建后源语言固定。同源语言的编辑修改原文，另一语言的编辑写入译文表。坐标、图片、可见性、审核状态和点位版本共用同一条主表记录。

`map_marker_translations` 保存 `marker_id`、`language`、`title`、`description`、`source_hash`、`origin` 和 `updated_at`，每个 `(marker_id, language)` 只有一行。删除点位时外键会级联删除译文。`marker_edit_proposals.language` 记录提案的文本语言，历史提案默认 `zh`；原有 `base_marker_version` 冲突规则继续生效。人工异语编辑与审批会推进共享点位版本，防止并发审批覆盖已有结果。

| 场景 | 语言选择 |
| --- | --- |
| GET 返回文本 | `?lang=` 优先；未提供时读取 `Accept-Language` 的有效偏好；该头缺失或为空时使用 `X-App-Language`。 |
| 新增或修改文本 | JSON `language` 优先；缺失时使用上述请求头规则；查询参数 `lang` 不决定投稿语言。 |
| 兼容与回退 | 支持 `zh`、`en`，地区标签如 `zh-Hant`、`en-US` 归并为对应语言。无语言信息或不支持的显式语言默认 `zh`。仅使用系统语言的客户端应发送实际语言头。 |

旧客户端无需增加字段即可继续使用；未提供语言字段或请求头时默认中文。返回 `sourceLanguage` 表示原文语言，`contentLanguage` 表示本次 `title`、`description` 实际采用的语言。目标语言等于源语言时返回原文；目标译文不存在或失效时也回退原文，不强行把原文标记为目标语言。

纯元数据修改保留原文和源语言。跨语言 PATCH 省略部分文本时，会从该目标语言的有效译文补全；没有有效译文时必须同时提供标题和描述（描述可为 `""`），否则返回 HTTP 400。这样不会把原文混入另一语言的提案。

### 译文有效性与人工保护

`source_hash` 是以下紧凑 JSON 数组的 UTF-8 字节 SHA-256，小写十六进制输出：

```text
[规范化后的 sourceLanguage, title 或空字符串, description 或空字符串]
```

只将 `null` 文本规范为空字符串，不 trim 文本、不进行 Unicode 规范化；非 ASCII 字符直接编码为 UTF-8，控制字符使用标准 JSON 转义及小写十六进制。Python 对应 `json.dumps(values, ensure_ascii=False, separators=(',', ':'))`。Java 与离线工具已有跨语言及 Unicode 哈希向量测试。

只有目标语言不同于源语言且 `source_hash` 与当前原文匹配，译文才参与显示和搜索。原文改变会立即使旧译文失效，旧行保留供修订；修改类别、权限等元数据不会改变此哈希。双语搜索仍只返回可公开读取的已批准点位；Redis 保留原文，HTTP 输出阶段对副本选取语言。

人工投稿审核及管理员异语编辑写入 `origin=MANUAL`。离线工具导入写入 `origin=MACHINE`，会跳过所有现有 `MANUAL` 行，包括因原文变化而失效的人工译文。这些人工译文应走人工修订流程。工具在写入时锁定并重新检查原文字段、审核及可见性，并在 SQL 冲突更新条件中保护 `MANUAL`；源变化或受保护的记录计入 `changed_or_protected`，需要重新导出或人工处理。

离线导出、填写、校验和导入步骤见 [scripts/README.md](../../scripts/README.md)。导入前也应创建数据库备份。

### 此前本地验证记录

上线前，Java 67 项测试已通过；离线工具 19 项纯 Python 测试及 7 项隔离 PostgreSQL 16 测试已通过。该组 PostgreSQL 测试涵盖迁移重复执行、保留原文、正常与重复导入、源变化跳过、人工保护、权限重核及删除级联；测试容器已清理。本次真实数据库副本与正式接口验证另见上方生产执行记录。

从 `backend-old/` 可运行：

```sh
./mvnw test
python -B -m unittest discover -s scripts -p test_translate_markers.py -v
```

Windows 使用 `mvnw.cmd test`。Python 默认运行 19 项并跳过 7 项需要显式隔离 PostgreSQL 容器的测试，启用方式见 [脚本文档](../../scripts/README.md#验证)。

## 2026-09-05 bug fixes

`2026-09-05-bugfix-versions.sql` adds the session and optimistic concurrency columns without deleting existing data. The current application uses `spring.jpa.hibernate.ddl-auto=update`; the same column definitions are present on the entities. Deployments that disable automatic schema updates should apply this SQL before starting the new backend. Do not run the older backend concurrently with the new one: it does not maintain the version fields.

After this release, existing sessions without a session version need to log in again. Password reset, account deletion and restoration revoke older sessions. A password change keeps the device making the change logged in and revokes its other sessions.

Existing edit proposals have no trustworthy baseline version. They remain available in the review queue, but approval returns HTTP 409 and asks for a new submission. New proposals record the marker version, so later approvals cannot silently overwrite intervening changes.

Uploads are now served through `UploadController`. Keep `/uploads/` routed to the backend; do not add a public Nginx alias or object-store ACL that bypasses marker permissions. Newly uploaded JPEG, PNG, GIF and WebP images are decoded and re-encoded as JPEG/PNG. Existing supported image files remain readable subject to current permissions; no uploaded files are deleted by this migration.

WebP decoding uses [TwelveMonkeys ImageIO](https://github.com/haraldk/TwelveMonkeys), pinned in `pom.xml`. H2 is a test-only dependency used for the review-concurrency regression tests; the production database remains PostgreSQL.
