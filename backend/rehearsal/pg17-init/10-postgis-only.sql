-- Lycoris 阶段 4：演练 PG17 镜像首次初始化时只创建 postgis 扩展。
-- 不创建 topology/tiger/geocoder，避免跨 PostGIS 版本的扩展配置表差异。
-- 应用业务库随后由 scripts/check-rehearsal.py seed 步骤加载 6 表基线与合成数据。
CREATE EXTENSION IF NOT EXISTS postgis;
