# 阶段 4：发布/回退演练与公平性能工具（实现与实测记录）

日期：2026-09-14。起点 `d780e58`。苏瑶实现、测试；温晓设计、验收。**第一轮审核后的返工记录见下。**
本轮只新增/修改 `backend-rust/rehearsal/`、`backend-rust/scripts/check-rehearsal.py`、
`backend-rust/scripts/benchmark-http.py`、`backend-rust/.gitignore` 与本文档；**未改动任何
应用 Rust/Java 源码、Dockerfile 或 `--check-baseline/--adopt-baseline` 入口**。

## 第一轮审核返工与实测（2026-09-14）

### 1) 新 PG17.11 + PostGIS 3.6.4 fixture

- 新增 `rehearsal/Dockerfile.pg17`：固定
  `postgres:17.11-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0`
  与 PGDG `postgresql-17-postgis-3=3.6.4+dfsg-2.pgdg12+1`（含 `-scripts`）。可经
  `PG17_REHEARSAL_BASE`/`PG17_POSTGIS_PKG_VERSION` 覆写为同 digest 可信镜像源。
- `pg17-init/10-postgis-only.sql` 只 `CREATE EXTENSION postgis`，不默认 topology/tiger。
- `compose.rehearsal.yml` 的 `pg17` 服务改为本地构建（`pull_policy: build`），
  **不再使用旧 17.5/3.5 镜像**，因此去掉了为旧 fixture 引入的扩展排除逻辑。
- 实测（`docker exec lycoris-rust-rehearsal-pg17`）：
  `17.11 (Debian 17.11-1.pgdg12+2)`、PostGIS `3.6.4`、
  扩展仅 `plpgsql,postgis`（无 topology/tiger/geocoder）。

### 2) `\restrict`/`\unrestrict` 实测支持，原样恢复

- 实测 PG17.11 psql 执行 `\restrict`/`\unrestrict` 脚本返回 `1`（支持）。
- `db-rollback` 改为**原样**使用 PG18 `pg_dump` 普通 SQL + PG17 psql 恢复：
  `--recreate` 实跑结果 `restoreMode=raw`、六表指纹与序列一致。
- 仅在原样恢复失败且显式 `--strip-restrict-metacommands` 时才做一次受控删除并记录
  sha256 证据；**默认不删安全元命令**。上一轮 17.5 的 `topology.useslargeids` 失败保留为
  旧 fixture 记录，不作为最终环境。

### 3) Java 真实 JAR 在 PG17 / PG18 / 回退库的读写与 validate

- Jar：`C:/Users/Nora/lycoris/backend/target/demo-1.0.3.jar`，
  `sizeBytes=70301331`、`sha256=3fc8d8f4f01ad4d97cd07a2b2b134e97ad3fb1f278453b5daa3101d9242c8b7a`
  （`render` 记录；只读挂载，非 root 运行）。
- 实测步骤与结果：
  1. `switch --to java --db pg17 --generation 1` → `ddl-auto=validate` 通过，
     `probe` health/me(401)/nearby(200) 正常；
  2. `flow --phase java-baseline`（Java 在 PG17）：登录、建点、编辑提案、管理员二次验证、
     审核、收藏全部 200 且标题核验通过；
  3. `upgrade --recreate`：含 Java 新增写入的最新状态导出 PG17→PG18，指纹一致；
  4. `switch --to java --db pg18 --generation 2` + `flow --phase java-pg18`：
     读回 PG17 阶段点位、再新写入并审核，ID 序列推进；
  5. `db-rollback --recreate`：PG18 最新状态恢复到新 PG17 `_back`，指纹一致；
  6. `switch --to java --db back --generation 3` + `flow --phase java-pg18`：
     Java 在回退库上 validate、读回新增数据并再次写入成功。
- 期间修正：Spring CORS 对非白名单 `Origin` 直接 403 — 演练 Web Origin 明确为
  `http://localhost:5198,http://127.0.0.1:5198`，HTTP 客户端改用白名单 Origin。
- 期间修正：二级密码 BCrypt 哈希含 `$`，Compose 会插值破坏；改用 `env_file: secrets.env`
  （值 `$`→`$$`），并在 `switch` 启动后比对容器内哈希与原值一致。
- 期间修正：`seed --recreate` 旧代码用 `to_regclass(...) IS NOT NULL` 与字符串 `"true"`
  比较，psql 实际输出 `t`，导致未重建；改为 `(...)::int` 判 `1`。

### 4) 审核关注点的代码修正

- `common.psql`：**始终** `-f -` 经 stdin 执行，SQL 不进 argv；`docker exec` 不自动传
  `PGPASSWORD`，改为容器内 local socket（`local all all trust`），不伪装已传口令。
- `database_exists`：先校验库名在 guard `ALLOWED_DATABASES`；维护 SQL 仅限固定库名与
  PG17/PG18 演练容器（`_assert_maintenance_container`）。
- Java compose：`command: sh -c "exec java -jar /app/app.jar"`、`SERVER_SSL_ENABLED=false`、
  `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=10`、`APP_UPLOAD_DIR=/app/uploads`（与 Java 现有
  配置一致）、2CPU/512MiB、非 root、与 Rust 共用受控上传目录。
- HTTP 错误不把响应体（可能含身份）写入报告；`_expect` 只记录状态码。
- 入口脚本 `sys.dont_write_bytecode = True`；`backend-rust/.gitignore` 忽略
  `__pycache__/`、`*.pyc`。

## 第二轮审核返工（2026-09-14，最新 PG17/Java 之上）

按温晓第二轮工具审查逐项修复，并按“小函数/独立模块”拆分为
`switching.py`（切换/冻结/代次/Cookie）、`db_rehearsal.py`（大版本回退）、
`bench_core.py`（性能核心）；`check-rehearsal.py` / `benchmark-http.py` 只做 CLI 编排。

1. **Sampler 线程名**：`_stop` → `_stop_event`，不遮蔽 `threading.Thread` 内部方法；新增
   真实 `start()`/`stop_collect()` 测试（`tests/test_tools.py`）。本机 Python 无 `_stop`
   方法，未在本机复现原 TypeError，但已按兼容目标修正。
2. **worker 异常与有界负载**：每 worker 独立 `WorkerStats`，主线程合并并收集致命异常；
   upload 登录失败记为 `fatalErrors` 不再静默 return；网络超时/连接失败计为 `networkErrors`；
   真实请求 deadline + `request_timeout`，主线程等所有线程结束并报告卡住线程；
   非 idle 零成功即失败；`validate_load_args` 限定 warmup∈[0,120]、duration∈[1,600]、
   concurrency∈[1,32]、repeats∈[1,5]、request_timeout∈[0.5,60] 且必须有限。
3. **延迟/吞吐/采样**：成功与错误延迟分开记录，`p50/p95` 只取成功延迟；记录实际测量
   起止与秒数，吞吐按实际窗口计算（含请求尾部与 join）；采样合并为**一次 docker exec**
   取 memory.current/cpu.stat usage_usec/VmRSS，并记录 `sampleCostMs`（不假装绝对基准）。
4. **配置实测**：`--assert-single-backend` 默认开启：非目标直连端口必须关闭、目标端口开放、
   入口 `entry.conf` 确实指向目标。`verify_target_config` inspect 受测容器 imageId/imageTag/
   user/limits 与**白名单 env**（`BCRYPT_COST`、`DB_MAX_CONNECTIONS`/Hikari 池、
   `MARKER_CACHE_REDIS_ENABLED` 等，绝不 dump 整个 env），断言 2CPU/512MiB、成本 10、池 10、
   实际缓存开关；记录 `gitDirty` 与工具源码 sha256，避免未提交实现冒充发布产物；
   报告记录 `datasetGrowth`（表/媒体增长），提示配对轮需重置或用增长比较。
5. **切换顺序**：`freeze_entry`（全 503 维护）→ 停 java/rust 并核验已停 → 启动目标 →
   直连 readiness（`/api/me` 401）→ `nginx -t` 激活并**有界等待入口恢复**→ 探测；
   任一步失败保留维护态、记录已完成步骤，不宣称成功。`generation` 正整数严格递增并写
   `generations.json`，拒绝复用。旧 Cookie 用**真实登录采集 + 切换后重放**断言 401，
   不靠命名空间字符串推断。
6. **db-rollback**：dump/fingerprint 前先冻结并停止两个写者，失败即中止；导出 PG18 最新
   dump（保留新增数据，来源库不删除）；记录 `containsTransactionTimeout`/`containsRestrict`
   与 `restoreMode`；PG17.11 原样恢复；媒体 sha256 前后一致才通过。
7. **probe**：校验 `/api/me` 匿名 401 与 nearby 200 + JSON 数组基本形状；`/health/rehearsal`
   仅 Nginx 静态，不代表应用就绪。
8. **adopt**：`docker run -e DATABASE_URL`（不带值）由父进程环境经 subprocess env 传入，
   秘密不进 docker argv；日志不打印秘密。

### 第二轮实测（真实 Java + 上述逻辑）

| 项 | 结果 |
| --- | --- |
| `check-rehearsal.py self-test` | 13 tests, 0 failures/errors |
| `benchmark-http.py --self-test` | guard 15/15 + 负载边界 4/4 |
| switch java g1（pg17） | OK（冻结→停→启动→就绪→激活→探测） |
| flow java-baseline | OK |
| upgrade --recreate | 指纹一致 |
| switch java g2（pg18）旧 Cookie 重放 | 旧 g1 Cookie 重放 **401** |
| flow java-pg18 | OK |
| switch java g4（pg18）旧 Cookie 重放 | 旧 g3 Cookie 重放 **401** |
| generation 复用（请求 2/2、5/5） | 拒绝并留失败报告，入口未被改动 |
| db-rollback --recreate | `restoreMode=raw`，媒体稳定、指纹一致，入口保持维护态 |
| switch java g5（back）+ flow java-pg18 | 回退库 validate/读写 OK |
| `benchmark-http.py --backend java --scenario read --quick` | 23/23 成功、0 错误；配置核验（2CPU/512MiB、非 root、Hikari 10、缓存 on）通过；记录 `sampleCostMs` 与真实测量窗口 7.264s（含尾部） |

## 第三轮审核返工（2026-09-14，Web 验收前）

### fixture

- 主体点位改用客户端真实四类 `accessible_toilet / friendly_clinic / baby_room / self_definition`
  （确认自 `frontend/src/types/marker.ts`、`mobile/src/types/marker.ts`）。
- 私有/PENDING/图片改用与类别互质的模数 `i%37`/`i%53`/`i%41`，避免与类别固定相关导致某类全私有
  或无图；`synthetic_media.MARKER_MODULO` 同步为 41。
- 仅末尾 10 行（4991..5000）保留 `elevator/ramp/parking` 作为 legacy 未知类别单独 fixture。
- 实测每类均衡：约 1247 行、1191 公开 APPROVED、约 28-30 公开图片、约 56 私有、约 23 PENDING；
  legacy 共 10 行（`elevator 4 / parking 3 / ramp 3`）。
- `seed --recreate` 现在启动新 `runId` 并清理 `flow_state.json`/`bench-marker-set.json`/cookie vault，
  避免跨基线串数据（此前导致 PG18 读回旧 state 点位不一致，本轮实测复现并修复）。

### 工具

1. `run_switch` 失败分支：重新 `freeze` 并**实测 503**；freeze 失败则记 `refrozen=unknown`，
   不再误报维护态；保留已完成 steps。
2. `_http_bounded` 设 8MiB 明确上限并检测超限（不再截断后当全量解析）。
3. 旧 Cookie 必须真实采集（有记录代次但采集失败即失败）；重放**严格 401** 才通过，503/0/200 一律失败。
4. Cookie vault 存本地合成文件（不打印/不提交），切换后重放**全部**历史 Cookie；返回 Java 时
   最初 Java g1 Cookie 也被重放并 401（实测 `[401,401]`），不靠相邻后端推断。
5. generation：持久 `runId` + 单调序号；`load` 遇损坏即拒绝；**启动前原子登记为已用**，失败不可复用；
   reseed 换新 runId，命名空间含 runId，不会与既有 Redis 会话碰撞。
6. compose 关键值以已验证 `.env` 覆盖宿主环境；`up-deps` 增加 `compose config`（含 `--profile apps`）
   resolved 校验：java→pg17/pg18 合成库、rust→pg17/pg18 合成库、端口全 127.0.0.1。
7. UID 统一 10001：Java 与 Rust compose `user` 均 10001:10001；Java 各阶段真实上传头像并读回，
   证明共享上传卷可写可读（Rust 腿待镜像）。
8. benchmark：默认读/上传集合取自合成库真实公开 APPROVED 四类点位，落盘并记录 `count`/`sha256`/
   `perCategory`（配对一致）；正常场景非 200 全计错误（401 不再从错误率扣除，另记 byStatus）；
   新增 `reject-login` 场景（期望 401）；预热校验 fatal/stuck；`Sampler.stop_collect` 等待覆盖 exec
   timeout 且超时即失败；白名单 env 增加 `PASSWORD_MAX_CONCURRENCY`/`DB_STATEMENT_TIMEOUT_MS`/
   `DB_LOCK_TIMEOUT_MS`/`MEDIA_MAX_CONCURRENCY`；Java BCrypt 10 用 `PasswordConfig.java` 源码 +
   库中 hash 前缀双证据；文档明确 urllib timeout 非严格总 deadline。

### 第三轮实测

| 项 | 结果 |
| --- | --- |
| 工具测试 `tests/test_tools.py` / `check-rehearsal self-test` | 21 tests, 0 failures/errors |
| `benchmark-http.py --self-test` | guard 15/15 + 边界 4/4 |
| 每类点位统计 | accessible_toilet 1247/1191/30；friendly_clinic 1248/1191/29；baby_room 1248/1191/28；self_definition 1247/1191/29 |
| switch java g1(pg17) → flow java-baseline | OK（含头像上传/读回，UID10001） |
| upgrade → switch java g2(pg18) | 旧 g1 Cookie 重放 **401** |
| flow java-pg18 | OK |
| db-rollback --recreate | raw、媒体稳定、指纹一致、保持维护态 |
| switch java g3(back) | 重放全部历史 Cookie `[401,401]`（含最初 g1） |
| flow java-pg18（back） | OK |
| up-deps resolved config | OK（java/rust 指向 pg17/pg18 合成库，端口全回环） |
| `benchmark --backend java --scenario read --quick` | 39/39 成功；配置核验（2CPU/512MiB、UID10001、Hikari10、缓存on、BCrypt 证据）通过；点位集合来自真实四类 |
| `benchmark --backend java --scenario reject-login --quick` | 696 请求全 401 计为期望成功 |

## 第四轮收尾（工具，未 reseed/切换/性能实跑）

1. `SwitchError` 携带 `facts`；`run_switch` 初次 freeze 失败记 `steps=[]` + `refrozen=unverified`，
   后续失败记实际 `steps`/`refrozen`/`refreezeError`；`cmd_switch` 失败报告收录结构化 facts。
2. cookie vault 缺文件首轮允许，**已有损坏/结构非法即失败不覆盖**，原子写入；补损坏拒绝测试。
   generation 改为与 `max(current, reserved)` 比较，预约高代次后拒绝较低代次（失败代次不可复用），
   保留 runId 隔离。
3. compose Rust 显式 `PASSWORD_MAX_CONCURRENCY=2`、`MEDIA_MAX_CONCURRENCY=1`、
   `DB_STATEMENT_TIMEOUT_MS=20000`、`DB_LOCK_TIMEOUT_MS=5000`；bench 实测 inspect 断言这些值；
   Java/Rust 仍 UID/GID10001、2CPU/512MiB、池 10、BCrypt 10。
4. upload 改固定 **512x512** 合成 PNG（不随 seed/worker 变化），`meta.uploadImage` 记录尺寸/字节/
   sha256；`metrics.setupMs` 报告准备/login 开销范围；单请求延迟只计 HTTP 上传，登录/生成不入延迟；
   非 200 仍全部计错误。
5. 新增 `snapshot-baseline`/`restore-baseline`：在完整 Java→Rust→Java 新增写入验证后冻结并保存
   PG18 `up` 库 + uploads；恢复先 freeze + 停两写者，仅恢复既有 `up` 库与 uploads 后核对指纹/媒体；
   label 与路径受控（仅 `work_dir/artifacts|uploads`）。本轮只测试本地临时 fixture 边界。

### 第四轮测试

| 项 | 结果 |
| --- | --- |
| `tests/test_tools.py` / `check-rehearsal self-test` | **29 tests, 0 failures/errors** |
| `benchmark-http.py --self-test` | guard 15/15 + 边界 4/4 |
| 新增：初次 freeze 失败 unverified / 重冻结 unknown / 失败 facts steps | 通过 |
| 新增：vault 损坏拒绝且不覆盖 / 非 dict 拒绝 / 缺文件允许 | 通过 |
| 新增：预约高代次后拒绝低代次 | 通过 |
| 新增：baseline label/路径/manifest/媒体校验（本地 fixture） | 通过 |

### 配对测量准备（待集成镜像授权）

1. 完成完整 Java→Rust→Java 矩阵与新增写入验证（现有 Java 腿已过，Rust 腿待镜像）。
2. `snapshot-baseline --label pairA`（freeze + 停两写者，保存 PG18 `up` + uploads 及指纹/manifest）。
3. 依次 `benchmark --backend rust|java` 各场景（read/login/upload，`--assert-single-backend`
   默认开，使用同一落盘点位集合与 512 图像），每后端一次只运行一个。
4. 每对之间 `restore-baseline --label pairA` 复位，再 `switch` 激活目标后端；报告记录
   `markerSet.sha256`、`uploadImage.sha256`、`datasetGrowth` 证明两端同数据基线。
5. 记录环境/镜像 digest/源码 sha256/dirty；完整矩阵由温晓授权窗口执行，本轮不实跑。

## 第五轮收尾（基准恢复顺序修正，仅工具）

- `run_restore_baseline` 改为**先全部只读预检**（label/路径、`read_manifest` 结构、`database=UP_DB`、
  dump 存在且 sha256 一致、media 数量/sha256 一致），任一失败在任何 freeze/停应用/DDL/删除媒体**之前**
  中止，不再“先 drop 再校验”。预检通过后才 freeze → 停两写者 → 重建 `up` → pg_restore → 恢复 uploads
  → 核对指纹/媒体。
- `read_manifest` 强化：`database` 必为 `UP_DB`、`dumpSha256`/`media.combinedSha256` 64hex、
  `fingerprint`/`media` 为 dict、`fileCount` 非负 int。
- `snapshot-baseline` 同 label 已有 dump/manifest/media 即**拒绝覆盖**（保留已验收矩阵/benchmark 证据），
  提示换新 label；仍只写 work-dir 内固定路径。
- 新增针对性测试：坏 dump hash / 缺 dump / 坏 media / 错 database 时 **零 freeze/stop/DDL/delete 调用**；
  合法 fixture 仍按 freeze→drop→restore→fingerprint 顺序恢复；snapshot 拒绝已有 label。

| 项 | 结果 |
| --- | --- |
| `tests/test_tools.py` / `check-rehearsal self-test` | **35 tests, 0 failures/errors** |
| 新增：坏 dump/media/database 零副作用；合法顺序恢复；snapshot 拒绝覆盖 | 通过 |

## 交付物

`backend-rust/rehearsal/`：`guard.py`、`common.py`、`switching.py`、`db_rehearsal.py`、
`bench_core.py`、`synthetic_media.py`、`http_flows.py`、`tests/test_tools.py`、
`Dockerfile.pg17`、`pg17-init/`、`compose.rehearsal.yml`、`nginx/entry*.tmpl`、
`sql/02_synthetic_seed.sql`、`rehearsal-env.example`、`README.md`；
`backend-rust/scripts/check-rehearsal.py`、`backend-rust/scripts/benchmark-http.py`。

## 已实跑汇总（新 fixture，第一轮）

| 步骤 | 结果 |
| --- | --- |
| guard 自检 | 15/15 passed |
| benchmark 自检 | guard + 汇总函数 OK |
| up-deps（构建 PG17.11 镜像） | OK，仅回环绑定 |
| PG17 版本/扩展 | 17.11 / PostGIS 3.6.4 / 仅 `plpgsql,postgis` |
| psql `\restrict` 支持 | 支持（探针返回 1） |
| seed --recreate | users 20 / markers 5000 / translations 7500 / favorites 180 / edit 10 / image 20 |
| Java PG17 validate + 读写 | flow java-baseline OK |
| upgrade --recreate | 指纹一致 |
| Java PG18 validate + 读写 | flow java-pg18 OK |
| db-rollback --recreate | `restoreMode=raw`，指纹一致 |
| Java 回退库 validate + 读写 | flow java-pg18 OK |

## 未实测 / 阻塞（不得记为通过）

- Rust `--check-baseline`/`--adopt-baseline`、Rust release 容器启动、Java↔Rust 同入口切换
  与 `rust-writes`/`rollback-verify` 阶段：Rust 镜像未交付，`adopt`/`switch --to rust`
  返回 `blocked(2)`。
- 完整性能矩阵（idle/warm read/login/upload × 两后端 × 3 轮）：Rust 镜像未交付；本轮只跑了
  Java read 的 `--quick` smoke（明确非完整结果）。Rust 交付后按同一配置实跑。
- Java→Rust→Java 的旧 Cookie 失效：Rust 腿待交付；已用 **Java→Java 分代**（g1→g2、g3）
  在返回 Java 时重放**最初 g1 Cookie** 并严格 401，机制一致。
- 共享上传卷在 **Linux 上的同属主可写**：已将 Java/Rust 统一 UID/GID 10001，并实测 Java 上传
  头像后读回；Rust 腿待镜像，届时验证同一卷双向读写（不使用 chmod 777）。
- Web 真浏览器（lycoris-stage4 / 5198）与 Android emulator 由父级验收，本工具不改动。

## 集成接口（Rust 交付后）

- `RUST_REHEARSAL_IMAGE`：非 root，读 `DATABASE_URL`/`REDIS_URL`，`UPLOAD_DIR=/app/uploads`，
  入口支持 `--check-baseline`/`--adopt-baseline`。
- `switch --to rust --generation N` 写独立命名空间/Cookie，reload 前 `nginx -t`。
- 步骤退出码：`0` 成功、`1` 失败、`2` 依赖阻塞；报告见 `<work-dir>/reports/`。
