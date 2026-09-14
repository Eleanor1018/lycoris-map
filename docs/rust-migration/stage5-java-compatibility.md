# 阶段 5：原 Java JAR 空间兼容验收（实际执行记录）

日期：2026-09-14。苏瑶实现、测试与返工，温晓审查验收。仅本地合成 `rehearsal-pg1711`；
保留原 Java JAR 和阶段 5 Rust 镜像，不涉及生产与私有恢复环境。

## 产物标识

- 最终 Rust 镜像：`lycoris-rust-stage5:local`
  imageId `sha256:d074e39c56769dd4fb5878d14592183552de9d7567b490f22b5a5b1179dc4664`
  （binary SHA256 `ea8deb49f67552ffd944821863435bf74884a68dab43e5a9b3f6926fea61c417`）。
- 阶段 4 stable tag `51776d6b…` 保留；含 0002 的库不再用旧 stage4 Rust 启动。
- 原 Java JAR：`C:/Users/Nora/lycoris/backend/target/demo-1.0.3.jar`
  SHA256 `3fc8d8f4f01ad4d97cd07a2b2b134e97ad3fb1f278453b5daa3101d9242c8b7a`（运行容器内 `/app/app.jar` 实测一致）；Java 镜像仍既有 Temurin JRE。

## 0002 迁移证据

- `_sqlx_migrations` versions=[1,2]，success 均 true，checksum 与原文 SHA-384 精确相等：
  - 0001 `8dbe74b7a0ec1ba8a6ffe28bfefadebfb39ac223b4522fcfd90de50a4feb8bbb8421341390ac0fce84527989739c3391`
  - 0002 `d1262eb9356b1e99b788ddea741a191d84aa30d567b0ec106d32dcc3e3a7a236ba9d1caceede93a4bfdd30a205a35cd5`
- `map_markers.location` 为 STORED generated，类型精确 `geography(Point,4326)`。
- 两索引（完整 indexdef 见 `stage5-reports/stage5-verify-0002-2.json`）：
  `idx_map_markers_location_gist`（GiST，partial：public + APPROVED + `location IS NOT NULL`）与
  `idx_map_markers_legacy_null`（partial：public + APPROVED + `location IS NULL`）。
- 迁移前后六表业务指纹（显式业务列，排除新 `location`）与序列、媒体 sha256 **完全相等**。

## 执行步骤与代次

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 1 configure | `verify-spatial-java.py configure --rust-image lycoris-rust-stage5:local --rust-image-id sha256:d074e39c… --java-jar … --jar-sha256 3fc8d8f4…` | 实际 inspect imageID/JAR SHA 匹配后写受控 .env |
| 2 baseline | `baseline --label stage5-pre-spatial-20260914` | 唯一快照（含 5005/新用户/en/图片/Web 签名与收藏）+ 业务指纹 + 媒体清单；冻结进入维护窗口 |
| migrate | `migrate` | 已核对不可变 imageID + `--pull never` 对 up 库 `--migrate` 应用 0002（不 adopt 0001） |
| 3 verify-0002 | `verify-0002 --expect-checksum 1=… --expect-checksum 2=… --expect-index-name idx_map_markers_location_gist --expect-index-name idx_map_markers_legacy_null` | 通过 |
| 4 switch | `check-rehearsal.py switch --to rust --generation 21 --db pg18 --cache on` | 入口→Rust stage5；旧 Cookie 重放 `[401×6]` |
| 4 verify | `verify-data --backend rust --expect-generation 21` | 阶段4 Rust 新用户改密登录、zh/en、媒体、收藏均可用 |
| 5 switch | `switch --to java --generation 22 --db pg18 --cache on` | 入口→Java；旧 Cookie `[401×7]` |
| 5 verify | `verify-data --backend java --expect-generation 22` | `ddl-auto=validate`、运行 JAR SHA 一致、阶段4 数据媒体仍可用 |
| 5 CRUD | `java-crud` | 新建+审批+匿名公开查询；`location::geometry` 的 ST_X/ST_Y/SRID 与 HTTP lat/lng 严格一致；PATCH title/category/isPublic 后生成列保持、nearby 按类别可见；仅本轮点位审批 200 后删除，HTTP 404 + SQL 0 + nearby 排除 |
| 6 switch | `switch --to rust --generation 23 --db pg18 --cache on` | 入口→Rust stage5；旧 Cookie `[401×8]` |
| 6 finalize | `finalize --expect-generation 23` | 真实验证新密码登录/zh+en/媒体/收藏；nearby 发现 Java 保留点位 5007 |

- Java CRUD 保留点位：**id 5007**，最终 `category=friendly_clinic`、`isPublic=true`、
  `lat/lng=31.2401/121.4901`，`location` SRID 4326 且 ST_X/ST_Y 与 HTTP 一致。
- 原 marker **5005** 存在；Web 合成用户2（按 `users.public_id` 实查）签名严格
  `Rust stage 4 Web review`，收藏 **369** 存在。
- 最终状态：入口 **Rust stage5 g23**，PG18 `lycoris_rehearsal_up`，cache on，Java 已停止。
- 未恢复旧基线覆盖 Java 新增行。

温晓独立核对 12 份成功步骤报告与 3 份保留的失败报告，重新通过实际入口读取 5005 的精确
zh/en 标题、Java 新增 5007 与类别附近结果、头像和图片字节 SHA-256；并直接查询合成 PG18
确认 5008 已删除、5007 空间坐标为 `121.4901/31.2401/SRID4326`、用户2签名保留。全部通过。
实际容器核对为唯一 Rust 后端、g23、缓存开启、上述最终镜像。独立记录位于本地验收归档
`stage5-java-independent.json`，验证脚本 `review-stage5-java.py` 同时归档。

## 失败与返工（保留原始报告，不修改）

- `stage5-migrate.json`：缺少 `REDIS_URL` 导致 `--migrate` 失败（工具补传 `-e REDIS_URL`，值由父进程 env）。
- `stage5-migrate-2.json`：同一原因重试仍失败前记录（诊断输出）；`stage5-migrate-3.json` 成功。
- `stage5-verify-0002.json`：`attgenerated || '|'` 操作符歧义 SQL 失败；修 `attgenerated::text` 后
  `stage5-verify-0002-2.json` 成功。
- `stage5-finalize.json` / `-2.json`：finalize 两次（第二次附 `--compat-out/--reports-out`）。

## 边界声明

- 坐标的 **HTTP 编辑未测**：原 Java `MarkerUpdateRequest` 无 lat/lng 字段，未伪造通过；
  `location` 自动派生由 C 的真实 SQL 回归覆盖。
- 未重跑阶段4性能/全 Rust/客户端；未运行 cargo/Android/build；其他 Docker 项目保持原状，非整机独占，不代表生产。
- 未使用生产/SSH；未触碰 55433/私有恢复；未 reseed、未覆盖通过报告。

## 机器可读结果与原始报告

- `docs/rust-migration/stage5-java-compatibility.json`（脱敏；含 label、迁移前后业务指纹/序列/媒体、
  Java CRUD 响应与保留 ID、Web 用户2、最终 image/generation、失败报告路径）。
- `docs/rust-migration/stage5-reports/`：`stage5-configure*`、`stage5-baseline`、`stage5-migrate*`、
  `stage5-verify-0002*`、`stage5-verify-data-rust`、`stage5-verify-data-java`、`stage5-java-crud`、
  `stage5-finalize*`（含失败记录），以及真实切换的 `switch-rust-g21`、`switch-java-g22`、
  `switch-rust-g23`。重复 compatibility JSON 保留在本地原始报告，仓库正文使用唯一 canonical 文件。
