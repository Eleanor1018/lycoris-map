-- Lycoris 阶段 4 演练合成数据（PG17 来源库 lycoris_rehearsal_src）。
--
-- 依赖：先用 docs/rust-migration/schema-baseline.sql 建 6 张业务表（脚本步骤 seed）。
-- 内容：20 个合成用户（含 1 个 ADMIN、1 个已删除、部分头像）、5000 个点位、
--       译文、收藏、编辑提案、图片提案。全部为合成数据，用户名/邮箱用 .invalid 域。
--
-- 口令：所有合成用户口令为 RehearsalPassw0rd!，用 pgcrypto bcrypt cost 10 生成
--       （与 Java Spring Security / Rust bcrypt 兼容；与性能测量的哈希成本 10 一致）。
-- 可重复：lat/lng 与标题由 id 通过确定性函数派生，不使用 random()。
-- 幂等：本脚本假设在空表上执行；重复执行会主键冲突（由步骤 guard/流程避免）。
-- 媒体引用规则必须与 rehearsal/synthetic_media.py 保持一致：
--       users.id % 3 == 0        -> /uploads/avatars/synth-avatar-<id>.png
--       map_markers.id % 41 == 0 -> /uploads/markers/synth-marker-<id>.png

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) users：20 行，id 1..20。id=1 管理员，id=20 已删除。
INSERT INTO public.users (
    id, avatar_url, email, nickname, password, pronouns, public_id, role,
    signature, username, deleted, deleted_at, session_version, row_version
)
SELECT
    i,
    CASE WHEN i % 3 = 0 THEN '/uploads/avatars/synth-avatar-' || i || '.png' END,
    'rehearsal_user_' || i || '@example.invalid',
    'Rehearsal User ' || i,
    crypt('RehearsalPassw0rd!', gen_salt('bf', 10)),
    NULL,
    ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
    CASE WHEN i = 1 THEN 'ADMIN' ELSE 'USER' END,
    NULL,
    CASE WHEN i = 1 THEN 'rehearsal_admin' ELSE 'rehearsal_user_' || i END,
    (i = 20),
    CASE WHEN i = 20 THEN TIMESTAMPTZ '2026-01-02T00:00:00Z' END,
    0, 0
FROM generate_series(1, 20) AS s(i);

-- 2) map_markers：5000 行，id 1..5000。主体用客户端真实四类
--    accessible_toilet / friendly_clinic / baby_room / self_definition；
--    仅末尾 10 行（4991..5000）作为 legacy 未知类别单独 fixture。
--    私有/PENDING/图片用与类别互质的模数，避免与类别固定相关（某类全私有无图）：
--      is_public=false 当 i%37=0（37 与 4 互质）
--      review_status=PENDING 当 i%53=0（53 与 4 互质）
--      mark_image 当 i%41=0（41 与 4 互质，须与 synthetic_media.MARKER_MODULO 一致）
INSERT INTO public.map_markers (
    id, category, created_at, description, is_active, is_public,
    last_edited_by, last_edited_by_owner, last_edited_by_public_id,
    lat, lng, mark_image, open_time_end, open_time_start,
    review_status, title, updated_at, user_public_id, username,
    client_request_id, version, source_language
)
SELECT
    i,
    CASE
        WHEN i > 4990 THEN (ARRAY['elevator', 'ramp', 'parking'])[((i - 4991) % 3) + 1]
        ELSE (ARRAY['accessible_toilet', 'friendly_clinic', 'baby_room', 'self_definition'])[(i % 4) + 1]
    END,
    TIMESTAMPTZ '2026-01-01T00:00:00Z',
    'Synthetic description for marker ' || i,
    true,
    (i % 37 <> 0 AND i % 53 <> 0),
    NULL, false, NULL,
    31.2304 + 0.09 * sin(i * 0.017),
    121.4737 + 0.12 * cos(i * 0.013),
    CASE WHEN i % 41 = 0 THEN '/uploads/markers/synth-marker-' || i || '.png' END,
    NULL, NULL,
    CASE WHEN i % 53 = 0 THEN 'PENDING' ELSE 'APPROVED' END,
    'Synthetic Marker ' || i,
    TIMESTAMPTZ '2026-01-01T00:00:00Z',
    (SELECT u.public_id FROM public.users u WHERE u.id = ((i - 1) % 20) + 1),
    (SELECT u.username  FROM public.users u WHERE u.id = ((i - 1) % 20) + 1),
    NULL, 0, 'zh'
FROM generate_series(1, 5000) AS s(i);

-- 3) map_marker_translations：每点位英文，偶数点位加日文；唯一 (marker_id, language)。
INSERT INTO public.map_marker_translations (
    id, marker_id, language, title, description, source_hash, origin, updated_at
)
SELECT
    (i - 1) * 2 + 1,
    i, 'en',
    'EN Synthetic Marker ' || i,
    'English description ' || i,
    md5('synthetic:' || i || ':en') || md5('synthetic:' || i || ':en-desc'),
    'MACHINE',
    TIMESTAMPTZ '2026-01-01T00:00:00Z'
FROM generate_series(1, 5000) AS s(i)
UNION ALL
SELECT
    (i - 1) * 2 + 2,
    i, 'ja',
    'JA Synthetic Marker ' || i,
    '日本語の説明 ' || i,
    md5('synthetic:' || i || ':ja') || md5('synthetic:' || i || ':ja-desc'),
    'MACHINE',
    TIMESTAMPTZ '2026-01-01T00:00:00Z'
FROM generate_series(1, 5000) AS s(i)
WHERE i % 2 = 0;

-- 4) marker_favorites：用户 1..6 收藏点位 1..30（唯一对）。
INSERT INTO public.marker_favorites (id, created_at, marker_id, user_public_id)
SELECT
    ROW_NUMBER() OVER (ORDER BY u.id, m.i),
    TIMESTAMPTZ '2026-01-01T00:00:00Z',
    m.i,
    u.public_id
FROM generate_series(1, 30) AS m(i)
CROSS JOIN (SELECT id, public_id FROM public.users WHERE id <= 6) AS u;

-- 5) marker_edit_proposals：每 500 个点位一条 PENDING 编辑提案。
INSERT INTO public.marker_edit_proposals (
    id, category, created_at, description, is_active, is_public, marker_id,
    marker_lat, marker_lng, marker_title, open_time_end, open_time_start,
    proposer_is_owner, proposer_public_id, proposer_username, reviewed_at,
    reviewed_by, status, title, version, base_marker_version, language
)
SELECT
    ROW_NUMBER() OVER (ORDER BY m.id),
    m.category,
    TIMESTAMPTZ '2026-01-03T00:00:00Z',
    m.description, true, true,
    m.id, m.lat, m.lng, m.title, NULL, NULL,
    false, m.user_public_id, m.username, NULL, NULL,
    'PENDING',
    'Proposed ' || m.title, 0, m.version, 'zh'
FROM public.map_markers m
WHERE m.id % 500 = 0;

-- 6) marker_image_proposals：每 250 个点位一条 PENDING 图片提案，引用已生成合成图。
INSERT INTO public.marker_image_proposals (
    id, created_at, image_url, marker_id, marker_title, proposer_public_id,
    proposer_username, reviewed_at, reviewed_by, status
)
SELECT
    ROW_NUMBER() OVER (ORDER BY m.id),
    TIMESTAMPTZ '2026-01-04T00:00:00Z',
    '/uploads/markers/synth-marker-' || m.id || '.png',
    m.id, m.title, m.user_public_id, m.username, NULL, NULL, 'PENDING'
FROM public.map_markers m
WHERE m.id % 250 = 0;

-- 显式 id 插入后推进 identity 序列，保证后续 Java/Rust 写入不冲突。
SELECT setval('public.users_id_seq', (SELECT max(id) FROM public.users), true);
SELECT setval('public.map_markers_id_seq', (SELECT max(id) FROM public.map_markers), true);
SELECT setval('public.map_marker_translations_id_seq', (SELECT max(id) FROM public.map_marker_translations), true);
SELECT setval('public.marker_favorites_id_seq', (SELECT max(id) FROM public.marker_favorites), true);
SELECT setval('public.marker_edit_proposals_id_seq', (SELECT max(id) FROM public.marker_edit_proposals), true);
SELECT setval('public.marker_image_proposals_id_seq', (SELECT max(id) FROM public.marker_image_proposals), true);

COMMIT;
