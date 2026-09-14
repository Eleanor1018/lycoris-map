# backend（旧 Java 后端）

> **状态：已退出默认本地开发。** 新的后端功能在 [`backend-rust/`](../backend-rust/README.md) 开发与验收；
> 本地默认启动入口见该文档与[仓库根说明](../README.md)。线上本次不变，仍按现有 Java 生产配置运行。

本目录保留现有 Java（Spring Boot）源码、构建与线上运维配置，作为**当前生产服务**与**回退参考**继续存在。
本次不改变线上部署、数据库或流量，也不删除任何源码；仅本地开发默认后端切换到 Rust。

- 保留的构建与运维参考：`Dockerfile`、`docker-compose.ec2.yml`、`deploy/`（Nginx、数据库迁移）、
  `deploy.sh` / `rollback.sh`，以及 Maven Wrapper 与旧测试。它们用于生产与回退对照，不在本轮改动范围。
- 本目录的 `docker-compose.local.yml` 只作旧 Java 本地调试保留（见文件顶部提示），不再默认使用。
- 旧 Java 本地调试步骤不再位于根 README（根文档已切换为 Rust 默认）；如需查阅可从本轮之前的 Git 历史查看。
