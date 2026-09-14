-- 阶段 5：PostGIS 空间查询增量迁移（只追加，绝不修改 0001_baseline.sql）
--
-- 目标：为 map_markers 的旧写入列 lat/lng 派生 geography(Point,4326) 生成列，并建立
-- is_public AND review_status='APPROVED' AND location IS NOT NULL 的 GiST 部分索引。
-- Java 回退版本的原始 INSERT/UPDATE 继续只写 lat/lng，生成列自动同步，无需两套应用代码；
-- 旧列、ID、资源 URL、译文、事务与鉴权语义均不变。
--
-- 合法地理坐标判定（已在 PostgreSQL 18.6 实测）：
--   * PostgreSQL 中 NaN 与自身相等，且大于所有非 NaN 值：`'NaN'::float8 = 'NaN'::float8`
--     为 true，`'NaN'::float8 < 'Infinity'` 为 false；
--   * 因此显式要求 `lat/lng > '-Infinity' AND < 'Infinity'` 排除 NaN、+Infinity、-Infinity，
--     再要求 lat∈[-90,90]、lng∈[-180,180]；两者都满足才生成 geography，否则 NULL。
--   * 超范围（如 lng=360）或非有限的历史行 location 为 NULL，由 find_nearby 的
--     legacy 有限异常坐标分支沿用原 Haversine 公式处理；NaN/Infinity 不进入附近结果。
--
-- 维护窗口与锁/磁盘/回退边界（务必先读）：
--   * SQLx 把整个迁移文件放在**同一个事务**里执行。`ALTER TABLE ... ADD COLUMN ... GENERATED
--     ... STORED` 需要 ACCESS EXCLUSIVE 锁并重写整表；该锁在事务内一直持有到 COMMIT，
--     因此紧随其后的 `CREATE INDEX` 并不会把锁降到 SHARE —— 读者在整个迁移期间都被阻塞。
--     必须安排在维护窗口，不能把本迁移当成“只有建索引会短暂阻塞写入”。
--   * 普通 `CREATE INDEX`（非 CONCURRENTLY，因其不可事务）同样在事务内执行；两者都不通过
--     SQLx 默认事务使用 CONCURRENTLY。
--   * 磁盘需要为**表重写的新堆 + 新 GiST 索引 + 重写/建索引产生的 WAL + 排序临时文件**预留
--     余量，约等于原表大小 + 索引大小 + 相应 WAL，而不是一份表数据。维护前确认足够空间。
--   * 回退：Java 应用回退**保留**本迁移新增的生成列与索引即可（Java 只写 lat/lng，生成列由
--     数据库同步；索引对 Java 无副作用）。**不要**手工执行 `DROP COLUMN location` / `DROP INDEX`：
--     那会让 `_sqlx_migrations` 仍标记 0002 已应用、而结构缺少生成列，Rust 再次启动或查询会
--     直接失败。需要真正撤销结构时，必须另行设计前向迁移并同步更新迁移历史，或从完整备份恢复
--     并保持数据结构与 `_sqlx_migrations` 一致；本文件不提供手工拆卸配方。
--
-- 异常坐标部分索引：公开已审核但 `location IS NULL` 的历史行（有限越界等）每次都要靠 legacy
-- 分支查找，顺序扫描整表可能抵消 GiST 收益。这里为 `(category, id)` 建同可见性条件的部分索引，
-- 使 legacy 分支能只扫描这些少量行；是否有收益由 EXPLAIN（ANALYZE, BUFFERS）实测决定，
-- 证据见 docs/rust-migration/stage5-spatial.md 与本轮 1000 行小检查。

ALTER TABLE public.map_markers
    ADD COLUMN location geography(Point, 4326)
    GENERATED ALWAYS AS (
        CASE
            WHEN lat > '-Infinity'::double precision
                AND lat < 'Infinity'::double precision
                AND lng > '-Infinity'::double precision
                AND lng < 'Infinity'::double precision
                AND lat BETWEEN -90 AND 90
                AND lng BETWEEN -180 AND 180
            THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
            ELSE NULL
        END
    ) STORED;

CREATE INDEX idx_map_markers_location_gist
    ON public.map_markers USING GIST (location)
    WHERE is_public AND review_status = 'APPROVED' AND location IS NOT NULL;

CREATE INDEX idx_map_markers_legacy_null
    ON public.map_markers (category, id)
    WHERE is_public AND review_status = 'APPROVED' AND location IS NULL;
