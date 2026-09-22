-- 阶段 6：场所标签（venue_type）增量迁移（只追加，绝不修改既有迁移）
--
-- 目标：为 `map_markers` 与 `marker_edit_proposals` 增加 nullable `venue_type` 文本列，
-- 仅允许六个受控取值（metro/hospital/mall/railway_station/school/other），且只有
-- `category = 'accessible_toilet'` 的点位/提案可以携带该标签；其它类别必须为 NULL。
--
-- 回填边界：
--   * 现有无障碍卫生间（category='accessible_toilet'）统一初始化为 'other'，
--     这只是结构默认回填，**具体场所分类由后续产品/运营逐条处理**；
--   * 现有编辑提案同样只对 accessible_toilet 回填 'other'，其余类别保持 NULL；
--   * 不删除任何记录、不修改任何既有软删状态（deactivated）或其它业务列。
--
-- 约束表达：CHECK 同时表达“取值白名单”与“非卫生间不得有标签”两条规则，兼容 NULL
-- （NULL 通过 CHECK）。约束名固定，便于迁移审计与故障定位。

ALTER TABLE public.map_markers
    ADD COLUMN venue_type text;

ALTER TABLE public.marker_edit_proposals
    ADD COLUMN venue_type text;

ALTER TABLE public.map_markers
    ADD CONSTRAINT ck_map_markers_venue_type
    CHECK (
        venue_type IS NULL
        OR (
            venue_type IN ('metro', 'hospital', 'mall', 'railway_station', 'school', 'other')
            AND category = 'accessible_toilet'
        )
    );

ALTER TABLE public.marker_edit_proposals
    ADD CONSTRAINT ck_marker_edit_proposals_venue_type
    CHECK (
        venue_type IS NULL
        OR (
            venue_type IN ('metro', 'hospital', 'mall', 'railway_station', 'school', 'other')
            AND category = 'accessible_toilet'
        )
    );

-- 结构默认回填：仅无障碍卫生间初始化 'other'，其余类别保持 NULL。
UPDATE public.map_markers
    SET venue_type = 'other'
    WHERE category = 'accessible_toilet' AND venue_type IS NULL;

UPDATE public.marker_edit_proposals
    SET venue_type = 'other'
    WHERE category = 'accessible_toilet' AND venue_type IS NULL;
