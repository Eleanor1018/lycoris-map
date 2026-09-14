//! 阶段 5 空间查询正确性测试：独立 Rust 参考公式差分、异常坐标边界与缓存 v2 隔离。
//!
//! 参考实现是测试内独立的 Haversine 公式（与产品 6371000 m 球面语义一致），**不调用**
//! 被测 `find_nearby.sql`；正常有限值比较 ID 集合与 distance,id 排序，NaN/Infinity 与
//! 有限越界异常行单独断言。每个用例使用 UUID 临时库与独立 Redis 命名空间。

mod common;

use axum::Router;
use axum::http::StatusCode;
use common::{
    TempDatabase, call, connect_redis, destination, test_redis_url, unique_cache_namespace,
};
use fred::clients::Client;
use fred::interfaces::KeysInterface;
use fred::types::Expiration;
use lycoris_backend::app::{AppState, build_router};
use lycoris_backend::config::Config;
use lycoris_backend::modules::markers::cache::MarkerCache;
use serde_json::Value;
use sqlx::PgPool;

/// 产品球面半径（米），与 Java 及 SQL 距离公式一致。
const R: f64 = 6_371_000.0;

/// 复刻已删除 Rust `NearbyBounds` 的经度半宽（度），仅用于证明旧候选在近极点会漏点。
///
/// 原式是 `asin(sin(angular)/cos(lat)).min(1.0)`：`asin` 的**有限**结果可能大于 1 rad
/// （本用例约 1.118 rad），被 `.min(1.0)` 截到 1.0 rad（约 57.2958°）。这是要复现的旧行为，
/// 不是 ratio>1 导致 `asin` 为 NaN 的分支。
fn legacy_longitude_half_width_degrees(lat: f64, radius_meters: i32) -> f64 {
    let angular = radius_meters as f64 / 6_371_000.0 + (1e-9_f64).to_radians();
    let ratio = angular.sin() / lat.to_radians().cos();
    ratio.asin().min(1.0).to_degrees() + 1e-9
}

/// 复刻旧 `NearbyBounds` 的包围盒边界与 `all_longitudes` 标志。
#[allow(clippy::type_complexity)]
fn legacy_bounds(lat: f64, lng: f64, radius_meters: i32) -> (bool, f64, f64, f64, f64) {
    let angular = radius_meters as f64 / 6_371_000.0 + (1e-9_f64).to_radians();
    let latitude_delta = angular.to_degrees();
    let min_lat = (lat - latitude_delta).max(-90.0);
    let max_lat = (lat + latitude_delta).min(90.0);
    let all_longitudes = min_lat <= -90.0 || max_lat >= 90.0;
    if all_longitudes {
        return (true, min_lat, max_lat, -180.0, 180.0);
    }
    let longitude_delta = legacy_longitude_half_width_degrees(lat, radius_meters);
    let mut min_lng = lng - longitude_delta;
    let mut max_lng = lng + longitude_delta;
    if min_lng <= -180.0 {
        min_lng += 360.0;
    }
    if max_lng >= 180.0 {
        max_lng -= 360.0;
    }
    (false, min_lat, max_lat, min_lng, max_lng)
}

/// 旧 SQL 的 bbox 谓词（逐字复刻 WHERE 中的 bbox 分支），用于证明某点会被旧候选排除。
fn legacy_bbox_contains(lat: f64, lng: f64, radius_meters: i32, p_lat: f64, p_lng: f64) -> bool {
    if !(-90.0..=90.0).contains(&p_lat) || !(-180.0..=180.0).contains(&p_lng) {
        return true;
    }
    let (all_longitudes, min_lat, max_lat, min_lng, max_lng) =
        legacy_bounds(lat, lng, radius_meters);
    if !(min_lat..=max_lat).contains(&p_lat) {
        return false;
    }
    if all_longitudes {
        return true;
    }
    if min_lng <= max_lng {
        (min_lng..=max_lng).contains(&p_lng)
    } else {
        p_lng >= min_lng || p_lng <= max_lng
    }
}

/// 独立参考实现：与 `find_nearby.sql` 相同的球面公式，但由 Rust 计算，不调用被测 SQL。
fn haversine_meters(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let a = (f64::sin((lat2 - lat1).to_radians() / 2.0)).powi(2)
        + lat1.to_radians().cos()
            * lat2.to_radians().cos()
            * (f64::sin((lng2 - lng1).to_radians() / 2.0)).powi(2);
    6371000.0 * 2.0 * f64::asin(a.clamp(0.0, 1.0).sqrt())
}

#[derive(Clone)]
struct Seed {
    lat: f64,
    lng: f64,
    category: &'static str,
    title: &'static str,
    is_public: bool,
    review_status: &'static str,
}

impl Default for Seed {
    fn default() -> Self {
        Self {
            lat: 0.0,
            lng: 0.0,
            category: "accessible_toilet",
            title: "marker",
            is_public: true,
            review_status: "APPROVED",
        }
    }
}

#[derive(Clone, Copy)]
struct Point {
    id: i64,
    lat: f64,
    lng: f64,
    category: &'static str,
    is_public: bool,
    review_status: &'static str,
}

async fn insert(pool: &PgPool, seed: &Seed) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO map_markers (
            lat, lng, category, title, is_public, is_active, review_status, username,
            last_edited_by_owner, version, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,true,$6,'tester',true,0,now(),now())
         RETURNING id",
    )
    .bind(seed.lat)
    .bind(seed.lng)
    .bind(seed.category)
    .bind(seed.title)
    .bind(seed.is_public)
    .bind(seed.review_status)
    .fetch_one(pool)
    .await
    .expect("插入点位失败")
}

/// 参考期望：可见、类别匹配、lat/lng 有限且球面距离 <= radius；按 (distance, id) 排序。
fn expected_ids(points: &[Point], lat: f64, lng: f64, radius: f64, category: &str) -> Vec<i64> {
    let mut measured: Vec<(f64, i64)> = points
        .iter()
        .filter(|p| {
            p.is_public
                && p.review_status == "APPROVED"
                && p.category == category
                && p.lat.is_finite()
                && p.lng.is_finite()
        })
        .filter_map(|p| {
            let distance = haversine_meters(lat, lng, p.lat, p.lng);
            (distance <= radius).then_some((distance, p.id))
        })
        .collect();
    measured.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    measured.into_iter().map(|(_, id)| id).collect()
}

struct TestApp {
    router: Router,
    _upload: tempfile::TempDir,
}

impl std::ops::Deref for TestApp {
    type Target = Router;

    fn deref(&self) -> &Self::Target {
        &self.router
    }
}

fn app_with(pool: PgPool, redis: Client, db_url: &str, namespace: &str) -> TestApp {
    let mut config = Config::new(db_url, test_redis_url());
    config.marker_cache_namespace = namespace.to_string();
    let upload = tempfile::TempDir::new().expect("创建临时上传目录失败");
    config.upload_dir = upload.path().to_path_buf();
    let router = build_router(AppState::new(pool, redis, config).expect("构造 AppState 失败"));
    TestApp {
        router,
        _upload: upload,
    }
}

fn parse(body: &[u8]) -> Value {
    serde_json::from_slice(body).expect("响应不是合法 JSON")
}

async fn response_ids(app: &Router, lat: f64, lng: f64, radius: i64, category: &str) -> Vec<i64> {
    let uri =
        format!("/api/markers/nearby?lat={lat}&lng={lng}&radius={radius}&category={category}");
    let (status, _, body) = call(app, &uri).await;
    assert_eq!(status, StatusCode::OK, "nearby 应返回 200: {uri}");
    parse(&body)
        .as_array()
        .expect("响应应为数组")
        .iter()
        .map(|marker| marker["id"].as_i64().expect("id"))
        .collect()
}

#[tokio::test]
async fn nearby_matches_independent_reference_across_geography_and_visibility() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(pool.clone(), redis, temp.url(), &unique_cache_namespace());

    let seeds = [
        // 上海城市密集：中心与约 50km 外。
        Seed {
            lat: 31.2304,
            lng: 121.4737,
            title: "sh-center",
            ..Default::default()
        },
        Seed {
            lat: 31.6800,
            lng: 121.4737,
            title: "sh-50km",
            ..Default::default()
        },
        // 赤道 1m 附近与边界。
        Seed {
            lat: 0.0,
            lng: 0.0,
            title: "eq-center",
            ..Default::default()
        },
        Seed {
            lat: destination(0.0, 0.0, 0.5, 90.0).0,
            lng: destination(0.0, 0.0, 0.5, 90.0).1,
            title: "eq-0.5m",
            ..Default::default()
        },
        Seed {
            lat: destination(0.0, 0.0, 1.5, 90.0).0,
            lng: destination(0.0, 0.0, 1.5, 90.0).1,
            title: "eq-1.5m",
            ..Default::default()
        },
        // 高纬。
        Seed {
            lat: 78.2232,
            lng: 15.6469,
            title: "high-lat",
            ..Default::default()
        },
        // 日期变更线：中心、东/西两侧、对面。
        Seed {
            lat: 0.0,
            lng: 179.999,
            title: "dl-center",
            ..Default::default()
        },
        Seed {
            lat: 0.0,
            lng: 179.998,
            title: "dl-east",
            ..Default::default()
        },
        Seed {
            lat: 0.0,
            lng: -179.998,
            title: "dl-west",
            ..Default::default()
        },
        Seed {
            lat: 0.0,
            lng: 0.0,
            category: "baby_room",
            title: "dl-opposite-other-category",
            ..Default::default()
        },
        // 极点附近：50km 内不受经度限制。
        Seed {
            lat: 89.6,
            lng: -120.0,
            title: "pole-in",
            ..Default::default()
        },
        Seed {
            lat: 89.5,
            lng: 0.0,
            title: "pole-out",
            ..Default::default()
        },
        // 同距不同 ID（赤道东西各 0.002°）。
        Seed {
            lat: 0.0,
            lng: 0.002,
            title: "tie-a",
            ..Default::default()
        },
        Seed {
            lat: 0.0,
            lng: -0.002,
            title: "tie-b",
            ..Default::default()
        },
        // 4 类别与可见性边界。
        Seed {
            lat: 0.0,
            lng: 0.001,
            category: "baby_room",
            title: "baby",
            ..Default::default()
        },
        Seed {
            lat: 0.0,
            lng: 0.001,
            category: "friendly_clinic",
            title: "clinic",
            ..Default::default()
        },
        Seed {
            lat: 0.0,
            lng: 0.001,
            category: "self_definition",
            title: "self",
            ..Default::default()
        },
        Seed {
            lat: 0.0,
            lng: 0.0,
            is_public: false,
            title: "private",
            ..Default::default()
        },
        Seed {
            lat: 0.0,
            lng: 0.0,
            review_status: "PENDING",
            title: "pending",
            ..Default::default()
        },
        // 有限越界（lng=360 周期折回 0°），由 legacy 分支按原公式处理。
        Seed {
            lat: 0.0,
            lng: 360.0,
            title: "legacy-wrap",
            ..Default::default()
        },
    ];
    let mut points = Vec::new();
    for seed in &seeds {
        let id = insert(&pool, seed).await;
        points.push(Point {
            id,
            lat: seed.lat,
            lng: seed.lng,
            category: seed.category,
            is_public: seed.is_public,
            review_status: seed.review_status,
        });
    }

    let cases: [(f64, f64, i64, &str); 6] = [
        (31.2304, 121.4737, 1000, "accessible_toilet"),
        (31.2304, 121.4737, 50_000, "accessible_toilet"),
        (0.0, 0.0, 1, "accessible_toilet"),
        (0.0, 0.0, 1000, "accessible_toilet"),
        (0.0, 179.999, 1000, "accessible_toilet"),
        (90.0, 75.0, 50_000, "accessible_toilet"),
    ];
    for (lat, lng, radius, category) in cases {
        let expected = expected_ids(&points, lat, lng, radius as f64, category);
        let actual = response_ids(&app, lat, lng, radius, category).await;
        assert_eq!(
            actual, expected,
            "({lat},{lng},r={radius},{category}) 应与独立参考一致"
        );
    }

    // 非默认类别查询：只返回对应类别，且 legacy 类别归一由服务层负责（此处用规范化值）。
    let baby_expected = expected_ids(&points, 0.0, 0.0, 1000.0, "baby_room");
    assert_eq!(
        response_ids(&app, 0.0, 0.0, 1000, "baby_room").await,
        baby_expected
    );
    let self_expected = expected_ids(&points, 0.0, 0.0, 1000.0, "self_definition");
    assert_eq!(
        response_ids(&app, 0.0, 0.0, 1000, "self_definition").await,
        self_expected
    );
    let clinic_expected = expected_ids(&points, 0.0, 0.0, 1000.0, "friendly_clinic");
    assert_eq!(
        response_ids(&app, 0.0, 0.0, 1000, "friendly_clinic").await,
        clinic_expected
    );

    pool.close().await;
}

#[tokio::test]
async fn nearby_excludes_nonfinite_and_keeps_finite_out_of_range_legacy() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(pool.clone(), redis, temp.url(), &unique_cache_namespace());

    // 有限越界：lng=360 等价于 0°（周期折回），lat=0。查询 (0, 0.5)：dlng=360 → 距离≈0。
    let wrap = insert(
        &pool,
        &Seed {
            lat: 0.0,
            lng: 360.5,
            title: "wrap",
            ..Default::default()
        },
    )
    .await;
    let neighbor = insert(
        &pool,
        &Seed {
            lat: 0.0,
            lng: 0.5,
            title: "neighbor",
            ..Default::default()
        },
    )
    .await;
    // 非有限：NaN / +Infinity / -Infinity，绝不进入结果。
    let nan = insert(
        &pool,
        &Seed {
            lat: f64::NAN,
            lng: 0.0,
            title: "nan",
            ..Default::default()
        },
    )
    .await;
    let inf = insert(
        &pool,
        &Seed {
            lat: 0.0,
            lng: f64::INFINITY,
            title: "inf",
            ..Default::default()
        },
    )
    .await;
    let ninf = insert(
        &pool,
        &Seed {
            lat: f64::NEG_INFINITY,
            lng: 0.0,
            title: "-inf",
            ..Default::default()
        },
    )
    .await;

    let points = vec![
        Point {
            id: wrap,
            lat: 0.0,
            lng: 360.5,
            category: "accessible_toilet",
            is_public: true,
            review_status: "APPROVED",
        },
        Point {
            id: neighbor,
            lat: 0.0,
            lng: 0.5,
            category: "accessible_toilet",
            is_public: true,
            review_status: "APPROVED",
        },
        Point {
            id: nan,
            lat: f64::NAN,
            lng: 0.0,
            category: "accessible_toilet",
            is_public: true,
            review_status: "APPROVED",
        },
        Point {
            id: inf,
            lat: 0.0,
            lng: f64::INFINITY,
            category: "accessible_toilet",
            is_public: true,
            review_status: "APPROVED",
        },
        Point {
            id: ninf,
            lat: f64::NEG_INFINITY,
            lng: 0.0,
            category: "accessible_toilet",
            is_public: true,
            review_status: "APPROVED",
        },
    ];

    let actual = response_ids(&app, 0.0, 0.5, 1000, "accessible_toilet").await;
    assert!(
        actual.contains(&wrap),
        "有限越界 lng=360.5 应按原公式折回命中: {actual:?}"
    );
    assert!(actual.contains(&neighbor), "邻近点应命中");
    for excluded in [nan, inf, ninf] {
        assert!(!actual.contains(&excluded), "非有限点 {excluded} 不得出现");
    }
    // 与独立参考一致（参考同样排除非有限、保留有限越界）。
    assert_eq!(
        actual,
        expected_ids(&points, 0.0, 0.5, 1000.0, "accessible_toilet")
    );

    pool.close().await;
}

#[tokio::test]
async fn nearby_boundary_inside_equal_outside_matches_reference() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(pool.clone(), redis, temp.url(), &unique_cache_namespace());

    // 沿赤道构造 990m / 恰好 1000m / 1010m 三点（lat=0，经度差 = 距离/R）。
    let at = |meters: f64| meters / R;
    let inside = insert(
        &pool,
        &Seed {
            lat: 0.0,
            lng: at(990.0).to_degrees(),
            title: "inside",
            ..Default::default()
        },
    )
    .await;
    let equal = insert(
        &pool,
        &Seed {
            lat: 0.0,
            lng: at(1000.0).to_degrees(),
            title: "equal",
            ..Default::default()
        },
    )
    .await;
    let outside = insert(
        &pool,
        &Seed {
            lat: 0.0,
            lng: at(1010.0).to_degrees(),
            title: "outside",
            ..Default::default()
        },
    )
    .await;

    let points = vec![
        Point {
            id: inside,
            lat: 0.0,
            lng: at(990.0).to_degrees(),
            category: "accessible_toilet",
            is_public: true,
            review_status: "APPROVED",
        },
        Point {
            id: equal,
            lat: 0.0,
            lng: at(1000.0).to_degrees(),
            category: "accessible_toilet",
            is_public: true,
            review_status: "APPROVED",
        },
        Point {
            id: outside,
            lat: 0.0,
            lng: at(1010.0).to_degrees(),
            category: "accessible_toilet",
            is_public: true,
            review_status: "APPROVED",
        },
    ];

    let actual = response_ids(&app, 0.0, 0.0, 1000, "accessible_toilet").await;
    assert!(actual.contains(&inside), "990m 边界内必须命中");
    assert!(!actual.contains(&outside), "1010m 边界外必须排除");
    // 恰好等距是否命中取决于 `distance <= radius`，与独立参考逐点一致。
    assert_eq!(
        actual.contains(&equal),
        haversine_meters(0.0, 0.0, 0.0, at(1000.0).to_degrees()) <= 1000.0,
        "恰好 1000m 的收录必须与 reference 的 `<= radius` 语义一致"
    );
    assert_eq!(
        actual,
        expected_ids(&points, 0.0, 0.0, 1000.0, "accessible_toilet")
    );

    pool.close().await;
}

#[tokio::test]
async fn nearby_near_pole_matches_true_sphere_even_where_old_bbox_would_miss() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(pool.clone(), redis, temp.url(), &unique_cache_namespace());

    // 近极点几何：中心 (89.5, 0)、半径 50000m、点 (89.77, 60)。两点球面距离约 48200m
    // （< 50000m），到北极约 55597m，因此未跨极点；旧 bbox 的 all_longitudes=false，
    // 但经度半宽被 `asin(...).min(1.0)` 截到约 57.2958°，故 lng=60° 落在旧候选之外
    // （旧会漏点）；新查询按真球面半径包含它。
    let (lat, lng, radius) = (89.5_f64, 0.0_f64, 50_000_i32);
    let (p_lat, p_lng) = (89.77_f64, 60.0_f64);
    let point = insert(
        &pool,
        &Seed {
            lat: p_lat,
            lng: p_lng,
            category: "friendly_clinic",
            title: "pole-bbox-miss",
            ..Default::default()
        },
    )
    .await;

    let distance = haversine_meters(lat, lng, p_lat, p_lng);
    assert!(
        (distance - 48_200.017_821).abs() < 1.0,
        "独立 Haversine 应约为 48200.017821m，实际 {distance}"
    );
    assert!(distance <= radius as f64, "点应在 50000m 真球面半径内");
    let to_pole = haversine_meters(lat, lng, 90.0, 0.0);
    assert!(
        (to_pole - 55_597.463_322).abs() < 1.0,
        "到北极应约为 55597.463322m，实际 {to_pole}"
    );
    assert!(to_pole > radius as f64, "样例不应触极点");

    let (all_longitudes, _, _, _, _) = legacy_bounds(lat, lng, radius);
    assert!(!all_longitudes, "未跨极点时旧 all_longitudes 必须为 false");
    let half = legacy_longitude_half_width_degrees(lat, radius);
    assert!(
        (half - 57.295_779_513).abs() < 1e-6,
        "旧经度半宽应约为 57.295779513°，实际 {half}"
    );
    assert!(
        !legacy_bbox_contains(lat, lng, radius, p_lat, p_lng),
        "完整旧 bbox 谓词应排除该点（证明旧候选漏点）"
    );

    let actual = response_ids(&app, lat, lng, radius as i64, "friendly_clinic").await;
    assert!(
        actual.contains(&point),
        "新 SQL 按真球面半径应命中旧候选漏掉的点: {actual:?}"
    );
}

#[tokio::test]
async fn nearby_cache_v2_ignores_v1_and_rechecks_visibility() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let namespace = unique_cache_namespace();
    let app = app_with(pool.clone(), redis.clone(), temp.url(), &namespace);

    let marker = insert(
        &pool,
        &Seed {
            lat: 12.0,
            lng: 12.0,
            title: "cache",
            ..Default::default()
        },
    )
    .await;
    let cache = MarkerCache::new(redis.clone(), true, &namespace);
    let generation = cache.current_generation().await.expect("generation");

    // 伪造一个 v1 缓存键（服务改用 v2，必须完全忽略它）。
    let v1_key = format!(
        "{namespace}:nearby:v1:g{generation}:lat={:016x}|lng={:016x}|r=1000|c=accessible_toilet",
        12.0_f64.to_bits(),
        12.0_f64.to_bits()
    );
    redis
        .set::<(), _, _>(
            v1_key,
            "{\"v\":1,\"ids\":[999999]}".to_string(),
            Some(Expiration::EX(30)),
            None,
            false,
        )
        .await
        .expect("写入 v1 键失败");

    let actual = response_ids(&app, 12.0, 12.0, 1000, "accessible_toilet").await;
    assert_eq!(actual, vec![marker], "v1 伪缓存不得影响结果");

    // v2 命中：缓存键含真实 ID。
    let (status, _, _) = call(
        &app,
        "/api/markers/nearby?lat=12&lng=12&radius=1000&category=accessible_toilet",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let v2_key = cache.nearby_key(generation, 12.0, 12.0, 1000, "accessible_toilet");
    assert!(
        cache.read_ids(&v2_key).await.unwrap().contains(&marker),
        "v2 缓存应写入真实 ID"
    );

    // 命中后转为私有：仍回 PG 重检可见性并隐藏。
    sqlx::query("UPDATE map_markers SET is_public = false WHERE id = $1")
        .bind(marker)
        .execute(&pool)
        .await
        .expect("更新可见性失败");
    assert_eq!(
        response_ids(&app, 12.0, 12.0, 1000, "accessible_toilet").await,
        Vec::<i64>::new(),
        "缓存命中后转私有必须立即隐藏"
    );

    // 恢复公开：同一 generation 下重新出现（内容校验来自 PG）。
    sqlx::query("UPDATE map_markers SET is_public = true WHERE id = $1")
        .bind(marker)
        .execute(&pool)
        .await
        .expect("恢复可见性失败");
    assert_eq!(
        response_ids(&app, 12.0, 12.0, 1000, "accessible_toilet").await,
        vec![marker],
        "恢复公开后应重新出现"
    );

    let _: i64 = redis
        .del(format!("{namespace}:gen"))
        .await
        .expect("清理 generation");
    pool.close().await;
}
