# 阶段 5：PostGIS 空间查询实施记录

日期：2026-09-14。苏瑶实现、测试与返工；温晓设计、审查与验收。分支工作树
`rust-spatial-worktree`；不修改 `0001_baseline.sql`、不改前端/Android/Java、不部署。

状态：**已通过在线小门禁与正式空间测量**：`integration`/`markers_spatial`/`spatial_migration`/
`baseline_adoption` 共 **41 项测试通过、0 失败**；`cargo sqlx prepare --check` 通过；已用修正后的
工具在 1000/10000/100000 三个规模完成正式测量，三规模旧/新 ID 与排序全部一致、两索引真实入选、
无失败。阶段 5 仍待主分支 Linux 集中整合、原 Java JAR 与最小客户端验证（由温晓安排）。
本文件区分“已实测”与“待测”，不把未执行项写成通过。

## 1. 改动文件

产品与服务：

- `backend-rust/migrations/0002_spatial.sql`（新增；不触碰 0001）。
- `backend-rust/src/modules/markers/sql/find_nearby.sql`（重写）。
- `backend-rust/src/modules/markers/repository.rs`（`find_nearby` 10 参数缩为 4）。
- `backend-rust/src/modules/markers/service.rs`（删除 `NearbyBounds` 与包围盒预算）。
- `backend-rust/src/modules/markers/cache.rs`（`nearby` 键 `v1` → `v2`；`viewport` 不变）。
- `backend-rust/.sqlx/`（在线 `cargo sqlx prepare`：删除旧 `find_nearby` 无引用条目，
  新增当前查询条目；其余条目未改内容）。

测试：

- `backend-rust/tests/markers_spatial.rs`（新增：独立参考差分、异常坐标、边界、极点旧候选漏点、缓存 v2）。
- `backend-rust/tests/spatial_migration.rs`（新增：空库 0001+0002、生成列/索引、接管→`--migrate`、Java 形状 DML）。
- `backend-rust/tests/baseline_adoption.rs`、`tests/common/mod.rs`（legacy fixture 只用 0001）。

工具与文档：

- `backend-rust/scripts/spatial_explain.py`（可重复性能/EXPLAIN 工具）。
- `backend-rust/scripts/find_nearby_legacy.sql`（0815d6b 旧查询逐字原文，供差分基准）。
- `backend-rust/scripts/spatial_run.py`（回环合成环境下的 cargo 执行封装）。
- `docs/rust-migration/stage5-spatial-perf.json`（最近一次小规模 EXPLAIN 报告）。
- 本文件。

## 2. `0002_spatial.sql`

### 2.1 生成列

`map_markers` 增加 `location geography(Point, 4326)` **STORED 生成列**：

```sql
CASE
  WHEN lat > '-Infinity'::float8 AND lat < 'Infinity'::float8
   AND lng > '-Infinity'::float8 AND lng < 'Infinity'::float8
   AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180
  THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  ELSE NULL
END
```

- PostgreSQL 18.6 实测：`'NaN'::float8 = 'NaN'::float8` 为 `true`（NaN 等于自身），
  `'NaN'::float8 < 'Infinity'` 为 `false`；`'NaN'`/`'Infinity'`/`'-Infinity'` 的
  `BETWEEN -90 AND 90` 均为 `false`。因此显式 `< 'Infinity'` 与范围判断可排除三者。
- 只有一份写入口（旧 `lat/lng`）。Java 回退版本的原始 `INSERT/UPDATE` 继续只写旧列，
  生成列由数据库自动同步，没有第二套应用同步代码；旧列、ID、资源 URL、译文、事务、
  鉴权语义不变。

### 2.2 索引

```sql
CREATE INDEX idx_map_markers_location_gist
    ON map_markers USING GIST (location)
    WHERE is_public AND review_status = 'APPROVED' AND location IS NOT NULL;

CREATE INDEX idx_map_markers_legacy_null
    ON map_markers (category, id)
    WHERE is_public AND review_status = 'APPROVED' AND location IS NULL;
```

- GiST 索引服务合法坐标候选；`(category,id)` 部分索引服务 `location IS NULL` 的历史异常行，
  使 legacy 分支只扫描少量行而不是整表顺序扫描。
- 是否有收益以 `EXPLAIN (ANALYZE, BUFFERS)` 实测决定，见第 7 节：1000 行小检查中两个索引
  都在真实计划里被选用（`idx_map_markers_location_gist` 用于候选分支、`idx_map_markers_legacy_null`
  用于 `location IS NULL` 分支），未使用 `enable_seqscan=off` 强迫。

### 2.3 锁 / 磁盘 / 回退边界（已修正）

- SQLx 将整个迁移文件放在**同一事务**执行。`ADD COLUMN ... GENERATED ... STORED` 需要
  `ACCESS EXCLUSIVE` 并重写整表，该锁持有到 `COMMIT`；其后的 `CREATE INDEX` 不会把锁降到
  `SHARE`，**读者在整个迁移期间都被阻塞**。必须在维护窗口执行，不能描述成“只有建索引短暂
  阻塞写入”。
- `CONCURRENTLY` 不可事务，不能放进 SQLx 默认事务；因此使用普通事务性建索引。
- 磁盘需为**表重写的新堆 + 新 GiST/btree 索引 + 相应 WAL + 排序临时文件**预留余量，
  约等于原表 + 索引 + WAL，而不是一份表。
- 回退：Java 应用回退**保留**生成列与索引即可（Java 不写它们，生成列自动同步，索引无副作用）。
  **不提供**手工 `DROP COLUMN`/`DROP INDEX` 配方：那会让 `_sqlx_migrations` 仍标记 0002
  已应用而结构缺列，Rust 再次启动/查询会失败。真正撤销结构需要后续前向迁移并同步迁移历史，
  或从完整备份恢复并保持数据结构与历史一致。

## 3. `find_nearby.sql`

- 参数：`$1=lat, $2=lng, $3=radius_meters, $4=category`（原 10 参数中的 bbox 参数已删除）。
- 候选分支：`location IS NOT NULL` 且
  `ST_DWithin(location, ST_MakePoint($2,$1)::geography, radius*1.002+0.01, false)`；
  `ST_MakePoint` **经度在前**，已修正早期的 `$1,$2` 颠倒并用真实上海差分验证。
- legacy 分支：`location IS NULL`，最终按原 `6371000 * 2 * asin(sqrt(...))` 公式处理有限越界
  坐标（如 `lng=360` 周期折回）。两分支 `UNION ALL`，避免跨分支 `OR` 使空间索引失效。
- 距离表达式在三角函数前用 `CASE` 排除 NaN/Infinity，并把 `asin` 入参 `LEAST(1, GREATEST(0, ...))`
  clamp，避免异常行/浮点极值触发域错误；不新增 `LIMIT`/截断，保持 `distance, id` 稳定排序。
- 最终列仍从 `map_markers` 直接 `SELECT`（`JOIN` 候选 ID），避免子查询丢失 NOT NULL 元数据，
  也不把 SQLx 不支持的 geography 生成列带入结果。
- 候选半径 `*1.002+0.01`：覆盖 WGS84 最大半轴（6378137 m）与产品球半径（6371000 m）之比
  `<1.002`；最终仍按原半径精确筛选，不扩大用户结果。
- 半径 1..50000 夹取、默认类别、公有 APPROVED、类别、译文/哈希、提交后失效等语义保持。

## 4. 服务与缓存

- 删除 `NearbyBounds` 与 `EARTH_RADIUS_METERS` 预算；服务直接传 (lat,lng,radius,category)。
- `nearby` 缓存键 `nearby:v1` → `nearby:v2`，保留精确 `f64::to_bits` 键与 generation/可见性重检；
  缓存仍只存 ID。可见性变化在命中后经 PG 重检立即生效。
- **视口未改**：`find_viewport(.sql)` 与 `viewport:v1` 缓存键保持原 SQL 与日期变更线语义，
  未做无实测支撑的改动。

## 5. 基线接管与迁移

- `--check-baseline` / `--adopt-baseline` 仍**只面向 legacy（0001）结构**：`expected.rs` 仍是
  0001 期望；对含 0002 生成列的库，`inspect_schema` 会因多出 `location` 列而拒绝接管。
  真 checksum 与未知/失败/篡改历史的拒绝逻辑未放宽。
- 真实流程：legacy 库 `--adopt-baseline` 只登记 0001（不执行 0001 DDL、不改业务行/序列），
  随后 `--migrate` 才应用 0002，普通启动 `verify_applied` 校验 0001+0002 校验和。
- 测试 fixture 显式只建 0001：`TempDatabase::create_only_0001()`（原文执行 0001、无历史）与
  `create_only_0001_migrated()`（只应用 0001 的 SQLx 历史）；不再把含 0002 的 `create_migrated`
  误当 legacy。
- `tests/integration.rs` 的完整迁移断言已从“恰好 1 条”改为用内嵌 `MIGRATOR` 核对真实版本并
  显式断言 `[1, 2]`，随后 `verify_applied` 成功。adopt-only 路径仍只登记 0001（相关断言保持 1），
  unknown-applied 用例仍用未内嵌的版本 999，未改动 0001 或产品启动校验。
  主分支阶段 4 的同类 `[1,2]` 断言由苏瑶 A 在整合时处理，本工作树不复制整个主分支文件。

## 6. 异常坐标与旧查询行为修复（单列）

- 旧带 bbox 的 Haversine 查询对 `lat/lng = ±Infinity` 会因三角函数域错误直接
  `ERROR: input is out of range`（PostgreSQL 18.6 实测），无法产出结果。
- 新 `find_nearby.sql` 用 `CASE` 先判有限，NaN/Infinity 不进入附近结果，且不会报错；这是
  **有意的行为修复**，不是“旧新一致”。
- 由 `tests/markers_spatial.rs::nearby_excludes_nonfinite_and_keeps_finite_out_of_range_legacy`
  单列覆盖；性能工具的正常数据集只含有限值（含少量有限越界 `lng=360`），不混入非有限行。
- 有限越界坐标仍沿用原公式，不通过 PostGIS 隐式归一改写。

## 7. 性能 / EXPLAIN 工具

```text
python backend-rust/scripts/spatial_explain.py --scale <1000|10000|100000> \
    --output docs/rust-migration/stage5-spatial-<scale>.json
```

- 规模只允许 `1000` / `10000` / `100000`；阶段 4 正式性能测量结束后，已在开启的阶段 5 窗口对
  三个规模各跑一次（本机回环合成 PG，非全机独占；不跑 cargo/浏览器/压测）。
- 数据集：`setseed(0.42)`，全球稀疏 60% + 城市密集 40%（8 城市），四个真实类别
  `accessible_toilet`/`friendly_clinic`/`baby_room`/`self_definition`，每城市每类别都有行；
  另有每类别各一条有限越界 `lng=360` 历史行，确保稀疏用例确定命中。报告含每城市每类别计数。
- 旧 SQL 取自 `backend-rust/scripts/find_nearby_legacy.sql`（0815d6b 逐字 LF 原文，无附加注释）；
  报告记录其 sha256。
- 同一 psql 会话内：1 次冷执行 + `WARMUP` 次预热 + `REPEAT` 次测量，模拟连接池复用；
  报告分别给出 `cold_first_ms` 与预热后的 `hot_median_ms`，并保存每轮完整
  `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`。
- **不设置** `SET jit = off`，**不设置** `enable_seqscan`；报告记录 `SHOW jit` /
  `max_parallel_workers_per_gather` / `work_mem` / `shared_buffers`、PG/PostGIS 版本、
  行数、表与索引大小、旧/新 SQL 与迁移/工具 sha256。
- 正常有限数据集上：旧/新 ID 集合或顺序不一致、旧 SQL 报错、城市用例 0 命中，脚本都
  **非零退出**并保留失败报告，不以 warning 返回 0。
- `legacy_bounds` 参考实现保持原 `asin(ratio).min(1.0)` 语义：`asin` 的**有限**结果可能大于
  1 rad 并被 `.min(1.0)` 截到 1.0 rad，不先 clamp 比值。`tests/markers_spatial.rs` 用真实
  未跨极点样例证明旧候选漏点：中心 `(89.5, 0)`、半径 50000 m、点 `(89.77, 60)`；独立
  Haversine 约 `48200.017821 m`（到北极 `55597.463322 m`，不触极点），旧 `all_longitudes=false`
  且经度半宽约 `57.295779513°`，完整旧 bbox 谓词排除该点，而新查询按真球面半径包含它。
- 报告中数字只代表本地合成数据下的观测，**不代表生产性能结论**；收益随规模与查询选择性而变，
  不对 Rust/PostGIS 预设“一定更快”。

### 本轮在线小门禁结果（已执行）

在线合成环境：`lycoris_spatial_dev` 用 `cargo sqlx database reset -y -f` 重建为最终 0001+0002
（旧 dev 的旧 0002 一并丢弃，不伪造迁移历史）；共享 `lycoris_rust` 未迁移；UUID 用例库独占创建清理。

- `cargo sqlx prepare --check -- --all-targets`：通过（`find_nearby` 元数据 `e84d493f…` 与
  在线 schema 一致）。
- `cargo test --test integration --test markers_spatial --test spatial_migration --test baseline_adoption`：
  **41 通过、0 失败**（integration 9、baseline_adoption 25、markers_spatial 5、spatial_migration 2）。
- `cargo fmt --all -- --check`、`cargo clippy --offline --lib --test integration --test markers_spatial
  --test spatial_migration --test baseline_adoption -- -D warnings`：通过、零警告。
- `spatial_explain.py --self-check`：`explain_rounds=11`、每段以分号结束、`root_shared_hit=921`、
  `buffer_totals_from_root=true`、`ok=true`。
- 命令使用保留 `target-spatial`、`CARGO_BUILD_JOBS=2`、`RUST_TEST_THREADS=2`；未创建新 target。

### 正式测量：1000 / 10000 / 100000（已实测，本地合成）

唯一报告（互不覆盖；均为自建自清 UUID 库，只连 `127.0.0.1:55432` 合成测试 PG）：

- `docs/rust-migration/stage5-spatial-1000.json`
- `docs/rust-migration/stage5-spatial-10000.json`
- `docs/rust-migration/stage5-spatial-100000.json`
- 更早的 `stage5-spatial-small.json` 是 1000 行小门禁首跑，保留对照；旧 `stage5-spatial-perf.json`
  已作废删除。

统一设置（三报告一致）：PG `18.6` / PostGIS `3.6.4`；`SHOW jit=on`、
`max_parallel_workers_per_gather=2`、`work_mem=4MB`、`shared_buffers=128MB`；未设置
`enable_seqscan`。每用例旧/新各自在**同一 psql 连接**内 1 次冷执行 + 3 次预热 + 7 次热测
（11 轮），保存每轮完整 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`。

热中位数（ms，新 / 旧）：

| 规模 | 行数 | shanghai 1km | shanghai 50km | equator sparse 50km |
| --- | --- | --- | --- | --- |
| 1000 | 1004 | 0.099 / 0.130 | 0.116 / 0.126 | 0.062 / 0.136 |
| 10000 | 10004 | 0.545 / 1.166 | 0.694 / 1.169 | 0.090 / 0.983 |
| 100000 | 100004 | 6.180 / 13.459 | 6.105 / 14.247 | 0.119 / 11.971 |

首次执行（`cold_first_ms`，ms，新 / 旧）：

| 规模 | shanghai 1km | shanghai 50km | equator sparse 50km |
| --- | --- | --- | --- |
| 1000 | 8.952 / 0.265 | 9.191 / 0.297 | 0.366 / 0.231 |
| 10000 | 9.715 / 1.906 | 9.740 / 1.672 | 0.366 / 1.535 |
| 100000 | 16.291 / 18.867 | 15.641 / 15.385 | 9.067 / 12.415 |

分析（不预设结论）：

- **热路径**：10000/100000 新查询更快——城市用例约 1.7–2.3x，稀疏 50km 约 11–101x（旧计划
  读取全表进行筛选，新计划读取 GiST 候选与少量 legacy NULL）。1000 行城市
  用例两者接近（0.099/0.116 vs 0.130/0.126），小表上空间索引收益有限；稀疏 1000 行已约 2x。
- **首次执行**：1000/10000 城市用例新查询执行约 9–10ms，高于旧（<2ms）；首次调用的开销
  更高，未做函数级 profile 归因。100000 城市 1km 为 16.291/18.867ms，城市 50km 为
  15.641/15.385ms（新查询略慢），稀疏为 9.067/12.415ms。这里比较的是 EXPLAIN 的
  Execution Time，Planning Time 在每轮原始报告单独记录；首次与热值分开，不代表应用端到端延迟。
- **结果一致性**：三规模三用例旧/新 ID 与顺序**全部一致**、`old_error=null`、`failures=[]`；
  城市非零（9/13、84/123、908/1237），稀疏 1/1/2。
- **真实计划**：候选分支使用 `idx_map_markers_location_gist`，legacy 分支使用
  `idx_map_markers_legacy_null`；未用 `enable_seqscan=off` 强迫。
- **尺寸**：1000 表 `180224 B` / GiST `73728 B`；10000 表 `1769472 B` / GiST `770048 B`；
  100000 表 `17637376 B` / GiST `6733824 B`；`legacy_null` 恒 `16384 B`。
- **sha256**：旧 SQL `6b61550d…`、新 SQL `e84d493f…`、0001 `86f2fc0f…`、0002 `eaca941f…`、
  工具 `97b7a027…`。
- **边界**：以上为本地合成 SQL 测量，非全机独占、非生产；未跑 cargo/浏览器/压测。NaN/Infinity
  修复与未跨极点旧 bbox 漏点已由独立测试证明，不冒充旧新等价。

温晓独立复核三份报告的全部 **198 份执行计划**：执行时间、根节点 BUFFERS、实际返回行数、
热中位数与两索引入选均一致。另建十万行 UUID 合成库，用真实四参数 SQL `PREPARE` 后连续
11 次 `EXPLAIN EXECUTE`，默认 `plan_cache_mode=auto` 选择 11 次 custom plan、0 次 generic plan；
每次返回 908 行并使用两索引，预热后执行中位数 6.573ms。此项验证参数化计划，无强制索引或
强制 plan cache 设置，也不将未选择的 generic plan 记为验证通过。独立脚本和原始计划位于本地
交付 `work/review-stage5-spatial-evidence.py`、`work/stage5-spatial-evidence-independent.json`。

### 未测

- 主分支阶段 4 整合后的 Linux 集中全套门禁、原 Java JAR 真实 HTTP 验收、最小客户端验证（由
  温晓安排）。
- 生产环境性能与容量不在本阶段结论内。
- 主分支阶段 4 的 integration 同类 `[1,2]` 断言由苏瑶 A 在整合时处理，本工作树不复制整份文件。

## 8. 验证命令（本轮范围）

```powershell
# 独立合成开发库：重建以匹配最终迁移（绝不迁移共享 lycoris_rust；不跑 check-rust.ps1 默认模式）
python backend-rust/scripts/spatial_run.py sqlx database reset -y -f
python backend-rust/scripts/spatial_run.py sqlx prepare --check -- --all-targets
python backend-rust/scripts/spatial_run.py fmt --all -- --check
python backend-rust/scripts/spatial_run.py clippy --offline --lib --test integration --test markers_spatial --test spatial_migration --test baseline_adoption -- -D warnings
python backend-rust/scripts/spatial_run.py test --test integration --test markers_spatial --test spatial_migration --test baseline_adoption
python backend-rust/scripts/spatial_explain.py --self-check
# 正式测量：三个规模各一次，输出唯一报告（不自建新 target、不跑 cargo）
python backend-rust/scripts/spatial_explain.py --scale 1000    --output docs/rust-migration/stage5-spatial-1000.json
python backend-rust/scripts/spatial_explain.py --scale 10000   --output docs/rust-migration/stage5-spatial-10000.json
python backend-rust/scripts/spatial_explain.py --scale 100000  --output docs/rust-migration/stage5-spatial-100000.json
```

## 9. 证据路径

- 迁移与查询：`backend-rust/migrations/0002_spatial.sql`、`src/modules/markers/sql/find_nearby.sql`。
- SQLx 元数据：`backend-rust/.sqlx/`。
- 正式性能/EXPLAIN 报告：`docs/rust-migration/stage5-spatial-1000.json`、
  `stage5-spatial-10000.json`、`stage5-spatial-100000.json`（各含每轮完整 EXPLAIN JSON）。
  `stage5-spatial-small.json` 为 1000 行小门禁首跑，保留对照；旧 `stage5-spatial-perf.json`
  已作废并删除。
- 旧查询原文：`backend-rust/scripts/find_nearby_legacy.sql`。
- 兼容边界：`docs/rust-migration/stages-4-5-design.md`、`api-contract.md`。

## 10. 未做 / 待办

- 在线小门禁与正式测量（1000/10000/100000）：**本轮已完成**（41 测试通过、prepare --check、
  fmt/clippy、三规模两索引真实入选、ID/排序一致），见第 7 节。
- 阶段 4 整合后的 Linux 集中全套门禁、原 Java JAR 真实 HTTP 验收、最小客户端验证：由温晓安排；
  生产性能与容量不在本阶段结论内。
