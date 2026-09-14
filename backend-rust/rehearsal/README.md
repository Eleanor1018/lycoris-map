# rehearsal — 阶段 4 受控本地演练环境

本目录的 Python 演练工具仅保留本地，不随 Git 分发。以下为本地已有工具的使用参考。

本目录只包含**演练配置、合成数据与说明**，不修改任何应用 Rust/Java 源码；应用镜像由
其它任务交付。所有资源前缀 `lycoris-rust-rehearsal`，只连接回环演练端口与合成库。

## 文件

| 路径 | 用途 |
| --- | --- |
| `guard.py` | 安全 guard：精确回环主机（`127.0.0.1`/`::1`/`localhost`，不用 `127.` 前缀）、白名单端口、白名单合成库、拒绝任何 query/fragment（SQLx `host`/`hostaddr`/`dbname` 覆盖）、容器名前缀、合成凭据。`python guard.py` 自检。 |
| `common.py` | docker/compose/psql 封装、脱敏执行、JSON 报告（同名重跑追加 `-N` 不覆盖）、稳定指纹、pg_dump/restore、白名单库维护。psql **始终经 stdin**，容器内 local socket 无口令。 |
| `switching.py` | 同入口切换：维护冻结 → 停写者并核验 → 启动 → 直连就绪 → `nginx -t` 激活；`generations.json` 严格递增持久化；旧 Cookie 真实重放断言；`run_switch` 依赖注入便于单测失败路径。 |
| `db_rehearsal.py` | 大版本回退：冻结 + 停止写者 + 媒体 sha256 前后核对 + PG18 最新原样导出/恢复（可选受控删除 `\restrict`）。 |
| `bench_core.py` | 性能核心：有界负载、每 worker 独立结果、主线程异常收集、真实请求 deadline、成功/错误延迟分离、一次 exec 采样、受测容器配置核验。 |
| `synthetic_media.py` | 确定性 PNG 头像/点位图片（`--selftest` 校验编码）。 |
| `http_flows.py` | 分阶段真实 HTTP 业务流（Java PG17 / Java PG18 / Rust 写入 / 回退核对 / 库回退后核对）。 |
| `nginx/entry.conf.tmpl`、`nginx/entry-maintenance.conf.tmpl` | 入口切换与维护（全 503）模板。 |
| `tests/test_tools.py` | 工具单测：Sampler 真实 start/stop、负载边界、worker 致命异常、有界窗口、零成功拒绝、切换失败保留维护态、generation 复用拒绝、Cookie 采集顺序。 |
| `Dockerfile.pg17`、`pg17-init/10-postgis-only.sql` | 精简 PG17.11 + PostGIS 3.6.4 来源/回退镜像，只建 `postgis` 扩展。 |
| `compose.rehearsal.yml` | 项目 `lycoris-rust-rehearsal`：pg17(55435)/pg18(55434)/redis(56380)/nginx(18180)/java(18182)/rust(18181)，仅回环绑定。 |
| `sql/02_synthetic_seed.sql` | 6 表合成数据：20 用户、5000 点位、译文/收藏/编辑提案/图片提案；`pgcrypto` bcrypt cost 10。 |
| `rehearsal-env.example` | 合成环境变量样例；实际 `.env`/`secrets.env` 由 `render`/`seed` 写到可追踪临时目录。 |

## 资源与版本边界

- 端口：入口 `18180`、Rust `18181`、Java `18182`、PG18 `55434`、PG17 `55435`、Redis `56380`。
  现有 `18080/5197/55432/55433/56379` 不动；不触碰 `lycoris-restore-review`。
- 库：`lycoris_rehearsal_src`（PG17 来源）、`lycoris_rehearsal_up`（PG18 升级）、
  `lycoris_rehearsal_back`（PG17 回退目标）。拒绝 `lycoris_rust`/`restore_review` 等。
- PG17 镜像：`postgres:17.11-bookworm@sha256:051f7b7b…` + `postgresql-17-postgis-3=3.6.4+dfsg-2.pgdg12+1`
  （`PG17_REHEARSAL_BASE`/`PG17_POSTGIS_PKG_VERSION` 可覆写为同 digest 可信源）。
  实际版本 PG17.11 / PostGIS 3.6.4，且只装 `postgis`。
- 会话分代：`switch --generation N` 写入独立 `SESSION_NAMESPACE`/`SESSION_COOKIE_NAME`
  （Java `lycoris:session:rehearsal:java:gN`，Rust `lycoris:rust:rehearsal:gN`）；旧 Cookie
  因命名空间与 Cookie 名均不同而不可恢复，绝不 `FLUSHALL`/清共享 Redis 会话。
- Web Origin 白名单明确为 `http://localhost:5198,http://127.0.0.1:5198`（`REHEARSAL_WEB_ORIGINS`）；
  Android 原生 API 无 Origin。Spring CORS 对非白名单 Origin 直接 403，故 HTTP 客户端须带白名单 Origin。
- 二级密码 BCrypt 哈希含 `$`，Compose 会插值 `${}`/`$VAR`；已用 `secrets.env`（值中 `$`→`$$`）
  经 `env_file` 传入，并在 `switch` 启动后校验容器内值与原值一致。
- Java/Rust 各 2CPU/512MiB，PG 1GiB，Redis 128MiB；两者统一非 root UID/GID **10001**
  （`REHEARSAL_APP_UID/GID`），`exec java -jar /app/app.jar`、`SERVER_SSL_ENABLED=false`、
  Hikari 池上限 10，共用 `<work-dir>/uploads`（Linux 上同属主可写）。
- 合成数据用客户端真实四类 `accessible_toilet/friendly_clinic/baby_room/self_definition`，
  每类约 1247 行、1191 公开 APPROVED、约 28-30 张公开图片、约 56 私有、约 23 PENDING；
  私有/PENDING/图片用与类别互质的模数（37/53/41），避免某类全私有无图。末尾 10 行为
  `elevator/ramp/parking` legacy 未知类别单独 fixture。
- compose 关键值以已验证的 `.env` 显式并入子进程环境（覆盖宿主同名变量），并 `up-deps` 用
  `compose config` 实测最终目标（java→pg17/pg18 合成库、rust→pg17/pg18 合成库、端口全回环）。

## 分步运行（仓库根目录）

当前演练实际工作目录（父级经 Docker mount 核对）：
`C:/Users/Nora/AppData/Local/Temp/opencode/rehearsal-pg1711`。报告 JSON 内记录的是脚本
解析出的**绝对路径**（`workDir`），不依赖 `%TEMP%` 占位符。

```powershell
$wd = "C:/Users/Nora/AppData/Local/Temp/opencode/rehearsal-pg1711"
python backend-rust/scripts/check-rehearsal.py --work-dir $wd render --java-jar C:/Users/Nora/lycoris/backend/target/demo-1.0.3.jar
python backend-rust/scripts/check-rehearsal.py --work-dir $wd guard
python backend-rust/scripts/check-rehearsal.py --work-dir $wd up-deps          # 构建/启动 pg17.11+3.6.4；校验 resolved config
python backend-rust/scripts/check-rehearsal.py --work-dir $wd seed --recreate  # 新 runId，清理 flow/marker/cookie 依赖状态
python backend-rust/scripts/check-rehearsal.py --work-dir $wd switch --to java --db pg17 --generation 1
python backend-rust/scripts/check-rehearsal.py --work-dir $wd flow --phase java-baseline
python backend-rust/scripts/check-rehearsal.py --work-dir $wd upgrade --recreate
python backend-rust/scripts/check-rehearsal.py --work-dir $wd switch --to java --db pg18 --generation 2
python backend-rust/scripts/check-rehearsal.py --work-dir $wd flow --phase java-pg18
python backend-rust/scripts/check-rehearsal.py --work-dir $wd db-rollback --recreate
python backend-rust/scripts/check-rehearsal.py --work-dir $wd switch --to java --db back --generation 3
python backend-rust/scripts/check-rehearsal.py --work-dir $wd flow --phase java-pg18
python backend-rust/scripts/check-rehearsal.py --work-dir $wd report-index
# Rust 交付后：adopt / switch --to rust / flow rust-writes / switch java / flow rollback-verify
python backend-rust/scripts/check-rehearsal.py --work-dir $wd down              # 保留卷
```

退出码：`0` 成功、`1` 失败、`2` 依赖阻塞。报告在 `<work-dir>/reports/<step>.json`
（同名重跑追加 `-N`，不覆盖失败记录），汇总在 `rehearsal-summary.json`。
`switch` 的 generation 为持久 `runId` 下的严格递增序号，启动前原子登记、失败也不可复用；
同名旧 Cookie 存本地 `session-cookies.json`（仅合成、不打印、不提交），返回 Java 时重放
**最初** Java Cookie 并以严格 401 证明不复活。

## 公平性能（`scripts/benchmark-http.py`）

```powershell
python backend-rust/scripts/benchmark-http.py --self-test
python backend-rust/scripts/benchmark-http.py --backend java --scenario read `
    --warmup 10 --duration 20 --concurrency 8 --repeats 3 `
    --cache-state on --assert-single-backend --work-dir $wd
```

默认预热 10s、测量 20s、并发 8、3 轮；`--quick` 为 smoke，不得冒充完整结果。一次只压一个
后端。报告含原始每轮延迟与计数、容器 `memory.current`/`cpu.stat`、`/proc/1` VmRSS 与 PG
连接数，不做百分比达标判定。

- 正常 read/upload 使用合成库真实公开 APPROVED 四类点位集合（落盘 `bench-marker-set.json`，
  记录 `count`/`sha256`/`perCategory`，配对两端复用同一集合；`--refresh-marker-set` 重建）。
- 正常场景成功只认 200，**其余（含 401/5xx/网络）全部计入错误率**，另按状态细分类；拒绝负载
  用 `--scenario reject-login`（期望 401）。
- upload 使用固定 **512x512** 合成 PNG（不随 seed/worker 变化），报告 `meta.uploadImage`
  记录尺寸/字节/sha256；`metrics.setupMs` 报告 worker 准备（client/图像生成/上传前登录）
  落在测量窗口内的开销范围，单请求延迟只计 HTTP 上传。
- 配置实测（`--assert-single-backend` 默认开）：inspect image/user/limits/白名单 env，断言
  Java/Rust 均 UID10001、2CPU/512MiB、Hikari/Rust 池 10、BCrypt 10（Rust env；Java 源码+hash
  前缀双证据）；Rust 另断言 `DB_STATEMENT_TIMEOUT_MS=20000`、`DB_LOCK_TIMEOUT_MS=5000`、
  `PASSWORD_MAX_CONCURRENCY=2`、`MEDIA_MAX_CONCURRENCY=1`。记录 `gitDirty` 与源码 sha256。

## 配对性能基线（快照/恢复）

在**完整 Java→Rust→Java 新增写入验证之后**建立基线，避免用最初 seed 覆盖新增写入证据：

```powershell
# 完整矩阵（Java/Rust 往返与新增写入验证）完成后，冻结并保存同名 PG18 up 库 + uploads
python backend-rust/scripts/check-rehearsal.py --work-dir $wd snapshot-baseline --label pairA
# 配对测量前恢复：先 freeze + 停两写者，仅恢复既有 up 库与 uploads，再核对指纹/媒体
python backend-rust/scripts/check-rehearsal.py --work-dir $wd restore-baseline --label pairA
```

- 快照/恢复只允许 `<work-dir>/artifacts/baseline-<label>*` 与既有 `<work-dir>/uploads`；
  `label` 限 `[A-Za-z0-9_-]{1,64}`；任意未受 guard 校验的路径不允许。
- `snapshot-baseline` 同 label 已有 dump/manifest/media 时**拒绝覆盖**（保留已验收证据），请换新 label。
- `restore-baseline` 先做**全部只读预检**（label/路径、manifest 结构、`database=lycoris_rehearsal_up`、
  dump 存在且 sha256 一致、media 数量/sha256 一致），任一失败即在任何 freeze/停应用/DDL/删除媒体
  **之前**中止，绝不先删已有数据；预检通过后才 freeze → 停两写者 → 重建 `up` → 恢复并核对指纹/媒体。
  来源库不删除，入口保持维护态（随后 switch 激活）。
- 本轮只实现/测试本地临时 fixture 边界（含坏 dump/media/database 时零副作用调用计数），未执行实际恢复。
