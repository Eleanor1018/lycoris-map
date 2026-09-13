# backend-rust

Lycoris Rust 后端（Axum + SQLx）工作目录。当前处于**阶段 0.5：最新版本运行基线**，
只提供隔离测试依赖环境，尚无任何 Rust 应用源码，也不接管生产流量。生产仍由
`backend/` 的 Spring Boot 服务承担。

## 目录

| 路径 | 用途 |
| --- | --- |
| `compose.test.yml` | 隔离测试依赖：PostgreSQL 18.6 + PostGIS 3.6.4、Redis 8.10.1 |
| `scripts/check-services.py` | 启动并校验上述两个容器及精确版本（仅标准库） |
| `.gitignore` | 忽略构建产物与本地覆盖配置 |

数据基线结构见 [../docs/rust-migration/schema-baseline.sql](../docs/rust-migration/schema-baseline.sql)，
版本与来源见 [../docs/rust-migration/versions.md](../docs/rust-migration/versions.md)。

## 启动

默认使用上游镜像；受限网络下可用经 digest 校验的镜像站地址覆盖：

```powershell
python backend-rust/scripts/check-services.py --start `
  --pg-image "docker.m.daocloud.io/postgis/postgis@sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677" `
  --redis-image "docker.m.daocloud.io/library/redis@sha256:298e5b3bc566bade82f46ad5511777a4a07a294097ce16ada2f6a42be5239df5"
```

`--pg-image` / `--redis-image` 只作为子进程环境变量覆盖 `PG_TEST_IMAGE` / `REDIS_TEST_IMAGE`，
不修改 `compose.test.yml`。也可先手动启动再检查：

```powershell
docker compose -f backend-rust/compose.test.yml up -d
python backend-rust/scripts/check-services.py
```

## 检查

`check-services.py` 通过 argv 调用 `docker compose` / `docker exec`（无 shell 拼接），
等待最多 60 秒，确认：PostgreSQL 18.6、PostGIS 3.6.4、Redis 8.10.1、
连接可用及可创建临时数据库；不执行 `FLUSHALL`，不删除容器。版本不符或超时返回非零。

## 连接与数据目录

| 组件 | 地址 | 凭据 |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:55432` | 用户 `lycoris` / 密码 `lycoris_local_test` / 库 `lycoris_rust` |
| Redis | `127.0.0.1:56379` | 无密码 |

测试用户为超级用户，集成测试可创建并删除临时数据库。持久卷为
`lycoris-rust-postgres-data`、`lycoris-rust-redis-data`，位于 Docker 数据目录。
容器名固定 `lycoris-rust-postgres`、`lycoris-rust-redis`，端口仅绑定回环地址。

## 边界

- 不包含应用容器，不接入生产，不保存真实数据。
- 不操作 `lycoris-restore-review` 容器（温晓的私有恢复验收环境）。
- 认证暂留既有语义，`tower-sessions` 不降级，适配设计由温晓在下一阶段确定。
- 当前仅环境文件；Rust 应用源码不在本阶段创建。
