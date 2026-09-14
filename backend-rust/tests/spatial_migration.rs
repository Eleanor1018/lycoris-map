//! 阶段 5 迁移测试：0002 生成列与 GiST 部分索引、legacy 接管→`--migrate` 真实流程，
//! 以及原 Java 形状 INSERT/UPDATE/DELETE 在新增生成列下仍可用。

mod common;

use common::TempDatabase;
use lycoris_backend::{baseline, migrate};
use sqlx::PgPool;

async fn insert_coord(pool: &PgPool, lat: f64, lng: f64) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO map_markers (
            lat, lng, category, title, is_public, is_active, review_status, username,
            last_edited_by_owner, version, created_at, updated_at)
         VALUES ($1,$2,'accessible_toilet','t',true,true,'APPROVED','u',true,0,now(),now())
         RETURNING id",
    )
    .bind(lat)
    .bind(lng)
    .fetch_one(pool)
    .await
    .expect("插入点位失败")
}

/// 点位 7 的 location 是否落在查询点 `(0.001, 0)` 的 200m 内。
async fn within_200m_of_query_point(pool: &PgPool) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT ST_DWithin(location, \
            ST_SetSRID(ST_MakePoint(0.001, 0), 4326)::geography, 200, false) \
         FROM map_markers WHERE id = 7",
    )
    .fetch_one(pool)
    .await
}

async fn location_is_null(pool: &PgPool, id: i64) -> bool {
    sqlx::query_scalar("SELECT location IS NULL FROM map_markers WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("读取 location 失败")
}

#[tokio::test]
async fn empty_migration_adds_generated_geography_and_partial_gist_index() {
    let (temp, pool) = TempDatabase::create_migrated().await;

    // 生成列：STORED、类型 geography(Point,4326)。
    let generated: Option<String> = sqlx::query_scalar(
        "SELECT a.attgenerated::text FROM pg_attribute a \
         JOIN pg_class c ON c.oid = a.attrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = 'public' AND c.relname = 'map_markers' AND a.attname = 'location'",
    )
    .fetch_one(&pool)
    .await
    .expect("读取生成属性失败");
    assert_eq!(
        generated.as_deref(),
        Some("s"),
        "location 必须是 STORED 生成列"
    );

    let column_type: String = sqlx::query_scalar(
        "SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a \
         JOIN pg_class c ON c.oid = a.attrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = 'public' AND c.relname = 'map_markers' AND a.attname = 'location'",
    )
    .fetch_one(&pool)
    .await
    .expect("读取列类型失败");
    assert_eq!(column_type, "geography(Point,4326)");

    // GiST 部分索引定义。
    let indexdef: String = sqlx::query_scalar(
        "SELECT indexdef FROM pg_indexes \
         WHERE schemaname = 'public' AND indexname = 'idx_map_markers_location_gist'",
    )
    .fetch_one(&pool)
    .await
    .expect("读取索引定义失败");
    let lowered = indexdef.to_lowercase();
    assert!(
        lowered.contains("using gist"),
        "索引必须是 GiST: {indexdef}"
    );
    assert!(lowered.contains("where"), "索引必须是部分索引: {indexdef}");
    assert!(
        lowered.contains("is_public"),
        "部分条件缺 is_public: {indexdef}"
    );
    assert!(
        lowered.contains("review_status"),
        "部分条件缺 review_status: {indexdef}"
    );
    assert!(
        lowered.contains("location is not null"),
        "部分条件缺 location IS NOT NULL: {indexdef}"
    );

    // legacy NULL 异常行的部分索引定义。
    let legacy_index: String = sqlx::query_scalar(
        "SELECT indexdef FROM pg_indexes \
         WHERE schemaname = 'public' AND indexname = 'idx_map_markers_legacy_null'",
    )
    .fetch_one(&pool)
    .await
    .expect("读取 legacy 索引定义失败");
    let legacy_lowered = legacy_index.to_lowercase();
    assert!(
        legacy_lowered.contains("category") && legacy_lowered.contains("id"),
        "legacy 索引应覆盖 (category, id): {legacy_index}"
    );
    assert!(
        legacy_lowered.contains("is_public")
            && legacy_lowered.contains("review_status")
            && legacy_lowered.contains("location is null"),
        "legacy 索引部分条件不完整: {legacy_index}"
    );

    // 合法坐标生成 Point，越界与非有限坐标为 NULL。
    for (lat, lng) in [
        (31.2, 121.4),
        (0.0, 0.0),
        (-90.0, 180.0),
        (90.0, -180.0),
        (89.999, 0.0),
    ] {
        let id = insert_coord(&pool, lat, lng).await;
        assert!(
            !location_is_null(&pool, id).await,
            "有限且范围合法的坐标必须生成 location: ({lat},{lng})"
        );
    }

    // 有限但越界：lng=360 属于范围外，location 为 NULL（由 legacy 分支处理）。
    let out_of_range = insert_coord(&pool, 0.0, 360.0).await;
    assert!(
        location_is_null(&pool, out_of_range).await,
        "越界 lng=360 不应生成 location"
    );
    let lat_out = insert_coord(&pool, 100.0, 0.0).await;
    assert!(
        location_is_null(&pool, lat_out).await,
        "越界 lat=100 应为 NULL"
    );

    for non_finite in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let id = insert_coord(&pool, non_finite, 0.0).await;
        assert!(
            location_is_null(&pool, id).await,
            "非有限 lat={non_finite} 必须为 NULL"
        );
        let id = insert_coord(&pool, 0.0, non_finite).await;
        assert!(
            location_is_null(&pool, id).await,
            "非有限 lng={non_finite} 必须为 NULL"
        );
    }

    pool.close().await;
    drop(temp);
}

#[tokio::test]
async fn legacy_adopt_then_migrate_preserves_business_and_tracks_coordinate_updates() {
    let (temp, pool) = TempDatabase::create_only_0001().await;

    // Java 形状数据：显式 id、已推进的 identity 序列、业务列。
    sqlx::query(
        "INSERT INTO map_markers \
         (id, category, created_at, is_active, is_public, last_edited_by_owner, lat, lng, \
          review_status, title, updated_at, username, version, source_language) VALUES \
         (7, 'accessible_toilet', now(), true, true, false, 0, 0, 'APPROVED', 'java-shape', \
          now(), 'alice', 3, 'zh')",
    )
    .execute(&pool)
    .await
    .expect("插入 Java 形状点位失败");
    sqlx::query("SELECT setval('map_markers_id_seq', 7)")
        .execute(&pool)
        .await
        .expect("推进序列失败");

    type MarkerShape = (i64, f64, f64, i64, String);
    let before: MarkerShape =
        sqlx::query_as("SELECT id, lat, lng, version, title FROM map_markers WHERE id = 7")
            .fetch_one(&pool)
            .await
            .expect("读取业务列失败");

    // 接管只登记 0001，随后 `--migrate` 应用 0002。
    baseline::adopt_baseline(&pool).await.expect("接管应成功");
    migrate::run(&pool).await.expect("0002 迁移应成功");
    migrate::verify_applied(&pool)
        .await
        .expect("升级后启动校验应通过");

    let after: MarkerShape =
        sqlx::query_as("SELECT id, lat, lng, version, title FROM map_markers WHERE id = 7")
            .fetch_one(&pool)
            .await
            .expect("读取业务列失败");
    assert_eq!(before, after, "迁移不得改动 id/lat/lng/version/title");
    let sequence: i64 = sqlx::query_scalar(
        "SELECT last_value FROM pg_sequences \
         WHERE schemaname = 'public' AND sequencename = 'map_markers_id_seq'",
    )
    .fetch_one(&pool)
    .await
    .expect("读取序列失败");
    assert_eq!(sequence, 7, "迁移不得改动 identity 序列值");

    // 生成列与旧列同步，Java 只写 lat/lng。
    let wkt: String =
        sqlx::query_scalar("SELECT ST_AsText(location)::text FROM map_markers WHERE id = 7")
            .fetch_one(&pool)
            .await
            .expect("读取 location 失败");
    assert_eq!(wkt, "POINT(0 0)");

    // 空间查询在更新 lat/lng 后改变结果（Java 形状 UPDATE 自动同步生成列）。
    assert!(
        within_200m_of_query_point(&pool)
            .await
            .expect("空间查询失败"),
        "原点应距查询点约 111m，落在 200m 内"
    );
    sqlx::query("UPDATE map_markers SET lat = 0, lng = 0.01 WHERE id = 7")
        .execute(&pool)
        .await
        .expect("Java 形状更新坐标失败");
    assert!(
        !within_200m_of_query_point(&pool)
            .await
            .expect("空间查询失败"),
        "更新到约 1111m 后应落在 200m 外"
    );

    // Java 形状 INSERT / DELETE 在新增生成列下仍可用。
    let new_id: i64 = sqlx::query_scalar(
        "INSERT INTO map_markers \
         (category, created_at, is_active, is_public, last_edited_by_owner, lat, lng, \
          review_status, title, updated_at, username, version) VALUES \
         ('accessible_toilet', now(), true, true, false, 1, 2, 'APPROVED', 'new', now(), 'bob', 0) \
         RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .expect("Java 形状 INSERT 失败");
    assert!(new_id > 7, "新 ID 必须延续序列");
    sqlx::query("DELETE FROM map_markers WHERE id = $1")
        .bind(new_id)
        .execute(&pool)
        .await
        .expect("Java 形状 DELETE 失败");
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM map_markers")
        .fetch_one(&pool)
        .await
        .expect("读取行数失败");
    assert_eq!(remaining, 1, "DELETE 后应只剩 Java 形状点位");

    pool.close().await;
    drop(temp);
}
