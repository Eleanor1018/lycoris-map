//! 公开点位读取的真实 PG / Redis 集成测试。
//!
//! 覆盖：5 条路由的状态/形状/默认值、可见性、语言协商与哈希、搜索合并、邻近/视口
//! 边界与缓存回源。每个用例独立临时库与独立 Redis 缓存命名空间。

mod common;

use std::time::{Duration, Instant};

use axum::Router;
use axum::http::{HeaderMap, StatusCode, header};
use common::{
    TempDatabase, call, call_with_headers, connect_redis, disconnected_redis, test_redis_url,
    unique_cache_namespace, unreachable_redis,
};
use fred::clients::Client;
use fred::interfaces::KeysInterface;
use fred::types::Expiration;
use lycoris_backend::app::{AppState, build_router};
use lycoris_backend::config::Config;
use lycoris_backend::modules::markers::cache::MarkerCache;
use lycoris_backend::modules::markers::localization::source_hash_components;
use serde_json::{Value, json};
use sqlx::PgPool;

/// Java `MarkerSourceHash` 的已知向量：控制字符、引号、反斜杠、换行与 emoji。
const CONTROL_TITLE: &str = "中\"文\\\n😀";
const CONTROL_DESCRIPTION: &str = "line\t\u{1f}";
const CONTROL_TITLE_HASH: &str = "69041ef21862545c32d414958ea2e68ef0287b0b67807d93ebfce3179dae8e87";

const MARKER_KEYS: [&str; 23] = [
    "id",
    "version",
    "lat",
    "lng",
    "category",
    "title",
    "description",
    "sourceLanguage",
    "contentLanguage",
    "isPublic",
    "username",
    "userPublicId",
    "clientRequestId",
    "isActive",
    "openTimeStart",
    "openTimeEnd",
    "reviewStatus",
    "lastEditedBy",
    "lastEditedByPublicId",
    "lastEditedByOwner",
    "markImage",
    "createdAt",
    "updatedAt",
];

#[derive(Clone)]
struct Seed {
    lat: f64,
    lng: f64,
    category: String,
    title: String,
    description: Option<String>,
    source_language: String,
    is_public: bool,
    review_status: String,
    is_active: bool,
    open_time_start: Option<String>,
    open_time_end: Option<String>,
    version: i64,
    username: String,
    user_public_id: Option<String>,
    mark_image: Option<String>,
}

impl Default for Seed {
    fn default() -> Self {
        Self {
            lat: 0.0,
            lng: 0.0,
            category: "accessible_toilet".to_string(),
            title: "marker".to_string(),
            description: None,
            source_language: "zh".to_string(),
            is_public: true,
            review_status: "APPROVED".to_string(),
            is_active: true,
            open_time_start: None,
            open_time_end: None,
            version: 0,
            username: "tester".to_string(),
            user_public_id: None,
            mark_image: None,
        }
    }
}

async fn insert(pool: &PgPool, seed: Seed) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO map_markers (
            lat, lng, category, title, description, source_language, is_public, is_active,
            open_time_start, open_time_end, review_status, username, user_public_id,
            mark_image, last_edited_by_owner, version, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15,now(),now())
         RETURNING id",
    )
    .bind(seed.lat)
    .bind(seed.lng)
    .bind(seed.category)
    .bind(seed.title)
    .bind(seed.description)
    .bind(seed.source_language)
    .bind(seed.is_public)
    .bind(seed.is_active)
    .bind(seed.open_time_start)
    .bind(seed.open_time_end)
    .bind(seed.review_status)
    .bind(seed.username)
    .bind(seed.user_public_id)
    .bind(seed.mark_image)
    .bind(seed.version)
    .fetch_one(pool)
    .await
    .expect("插入点位失败")
}

async fn insert_translation(
    pool: &PgPool,
    marker_id: i64,
    language: &str,
    title: &str,
    description: Option<&str>,
    source_hash: &str,
) {
    sqlx::query(
        "INSERT INTO map_marker_translations (marker_id, language, title, description, source_hash)
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(marker_id)
    .bind(language)
    .bind(title)
    .bind(description)
    .bind(source_hash)
    .execute(pool)
    .await
    .expect("插入译文失败");
}

fn app_with(
    pool: PgPool,
    redis: Client,
    db_url: &str,
    namespace: &str,
    cache_enabled: bool,
) -> Router {
    let mut config = Config::new(db_url, test_redis_url());
    config.marker_cache_namespace = namespace.to_string();
    config.marker_cache_enabled = cache_enabled;
    build_router(AppState::new(pool, redis, config))
}

fn parse(body: &[u8]) -> Value {
    serde_json::from_slice(body).expect("响应不是合法 JSON")
}

fn assert_vary(headers: &HeaderMap) {
    let vary = headers
        .get(header::VARY)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert_eq!(vary, "Accept-Language, X-App-Language", "缺少 Vary 头");
}

fn expect_marker(array: &Value, id: i64) -> &Value {
    array
        .as_array()
        .expect("响应应为 JSON 数组")
        .iter()
        .find(|marker| marker["id"] == json!(id))
        .unwrap_or_else(|| panic!("响应中缺少点位 {id}"))
}

fn count_id(array: &Value, id: i64) -> usize {
    array
        .as_array()
        .expect("响应应为 JSON 数组")
        .iter()
        .filter(|marker| marker["id"] == json!(id))
        .count()
}

#[tokio::test]
async fn public_list_filters_visibility_and_matches_java_shape() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let namespace = unique_cache_namespace();
    let app = app_with(pool.clone(), redis, temp.url(), &namespace, true);

    let visible = insert(
        &pool,
        Seed {
            lat: 1.5,
            lng: 2.5,
            title: "公开无障碍卫生间".to_string(),
            description: Some("靠近地铁".to_string()),
            is_active: false,
            open_time_start: None,
            mark_image: Some("/uploads/markers/a.png".to_string()),
            user_public_id: Some("owner-public".to_string()),
            username: "nora".to_string(),
            version: 3,
            ..Default::default()
        },
    )
    .await;
    let always_open = insert(
        &pool,
        Seed {
            title: "全天开放".to_string(),
            is_active: false,
            open_time_start: Some("00:00".to_string()),
            open_time_end: Some("00:00".to_string()),
            ..Default::default()
        },
    )
    .await;
    insert(
        &pool,
        Seed {
            is_public: false,
            ..Default::default()
        },
    )
    .await;
    insert(
        &pool,
        Seed {
            review_status: "PENDING".to_string(),
            ..Default::default()
        },
    )
    .await;
    insert(
        &pool,
        Seed {
            review_status: "REJECTED".to_string(),
            ..Default::default()
        },
    )
    .await;
    let legacy = insert(
        &pool,
        Seed {
            category: "safe_place".to_string(),
            title: "历史类别".to_string(),
            ..Default::default()
        },
    )
    .await;

    let (status, headers, body) = call(&app, "/api/markers/public").await;
    assert_eq!(status, StatusCode::OK);
    assert_vary(&headers);
    let array = parse(&body);
    assert_eq!(
        array.as_array().unwrap().len(),
        3,
        "只应返回 is_public+APPROVED 的点位"
    );

    let marker = expect_marker(&array, visible);
    for key in MARKER_KEYS {
        assert!(marker.get(key).is_some(), "响应缺少字段 {key}");
    }
    assert_eq!(marker["version"], json!(3));
    assert_eq!(marker["lat"], json!(1.5));
    assert_eq!(marker["lng"], json!(2.5));
    assert_eq!(marker["category"], json!("accessible_toilet"));
    assert_eq!(marker["sourceLanguage"], json!("zh"));
    assert_eq!(marker["contentLanguage"], json!("zh"));
    assert_eq!(marker["isPublic"], json!(true));
    assert_eq!(marker["reviewStatus"], json!("APPROVED"));
    assert_eq!(marker["markImage"], json!("/uploads/markers/a.png"));
    assert_eq!(marker["userPublicId"], json!("owner-public"));
    assert_eq!(
        marker["isActive"],
        json!(false),
        "无开放时间时回退数据库 is_active"
    );
    assert_eq!(
        expect_marker(&array, always_open)["isActive"],
        json!(true),
        "00:00-00:00 应视为全天"
    );
    assert_eq!(
        expect_marker(&array, legacy)["category"],
        json!("self_definition")
    );
    assert_eq!(
        expect_marker(&array, visible)["clientRequestId"],
        Value::Null
    );

    pool.close().await;
}

#[tokio::test]
async fn detail_visibility_returns_404_for_non_public() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(
        pool.clone(),
        redis,
        temp.url(),
        &unique_cache_namespace(),
        true,
    );

    let public = insert(
        &pool,
        Seed {
            title: "公开详情".to_string(),
            ..Default::default()
        },
    )
    .await;
    let private = insert(
        &pool,
        Seed {
            is_public: false,
            title: "私有".to_string(),
            ..Default::default()
        },
    )
    .await;
    let pending = insert(
        &pool,
        Seed {
            review_status: "PENDING".to_string(),
            title: "待审".to_string(),
            ..Default::default()
        },
    )
    .await;
    let rejected = insert(
        &pool,
        Seed {
            review_status: "REJECTED".to_string(),
            title: "驳回".to_string(),
            ..Default::default()
        },
    )
    .await;

    let (status, headers, body) = call(&app, &format!("/api/markers/{public}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_vary(&headers);
    let marker = parse(&body);
    assert_eq!(marker["id"], json!(public));
    assert!(marker.is_object());

    for hidden in [private, pending, rejected, 999_999] {
        let (status, _, body) = call(&app, &format!("/api/markers/{hidden}")).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "点位 {hidden} 应 404");
        assert!(body.is_empty(), "404 应为空体");
    }

    let (status, _, _) = call(&app, "/api/markers/abc").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    pool.close().await;
}

#[tokio::test]
async fn language_selection_matches_contract_including_bad_headers() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(
        pool.clone(),
        redis,
        temp.url(),
        &unique_cache_namespace(),
        true,
    );

    let marker = insert(
        &pool,
        Seed {
            title: CONTROL_TITLE.to_string(),
            description: Some(CONTROL_DESCRIPTION.to_string()),
            ..Default::default()
        },
    )
    .await;
    insert_translation(
        &pool,
        marker,
        "en",
        "English control",
        Some("English description"),
        CONTROL_TITLE_HASH,
    )
    .await;

    let english = |body: &[u8]| {
        let value = parse(body);
        let marker = &value.as_array().unwrap()[0];
        assert_eq!(marker["title"], json!("English control"));
        assert_eq!(marker["contentLanguage"], json!("en"));
        assert_eq!(marker["sourceLanguage"], json!("zh"));
    };
    let chinese = |body: &[u8]| {
        let value = parse(body);
        let marker = &value.as_array().unwrap()[0];
        assert_eq!(marker["title"], json!(CONTROL_TITLE));
        assert_eq!(marker["contentLanguage"], json!("zh"));
    };

    // 显式 lang 优先。
    let (_, headers, body) = call(&app, "/api/markers/public?lang=en").await;
    assert_vary(&headers);
    english(&body);
    chinese(&call(&app, "/api/markers/public?lang=zh").await.2);
    english(&call(&app, "/api/markers/public?lang=EN").await.2);

    // Accept-Language 权重与精确前缀。
    let accept = [("accept-language", "en-US,en;q=0.9")];
    english(
        &call_with_headers(&app, "/api/markers/public", &accept)
            .await
            .2,
    );
    let accept = [("accept-language", "fr, zh;q=0, en-US;q=0.7")];
    english(
        &call_with_headers(&app, "/api/markers/public", &accept)
            .await
            .2,
    );

    // 非空但不支持 / 非法的 Accept-Language 直接 zh，不回退 X-App-Language。
    let unsupported = [("accept-language", "fr"), ("x-app-language", "en")];
    chinese(
        &call_with_headers(&app, "/api/markers/public", &unsupported)
            .await
            .2,
    );
    let malformed = [("accept-language", "en;q=broken"), ("x-app-language", "en")];
    chinese(
        &call_with_headers(&app, "/api/markers/public", &malformed)
            .await
            .2,
    );

    // Java LanguageRange.parse 实际规则：非法 range / 未知参数 / 重复 q / 整项解析错误
    // 一律回 zh；重复语言范围以首次权重为准。
    for header in [
        "en--x",
        "en;garbage",
        "en;q=0.5;q=0.7",
        "en;q=1.1",
        "en,,zh",
        "en;q=0,zh;q=0.5,en;q=1",
    ] {
        chinese(
            &call_with_headers(&app, "/api/markers/public", &[("accept-language", header)])
                .await
                .2,
        );
    }
    english(
        &call_with_headers(
            &app,
            "/api/markers/public",
            &[("accept-language", "zh;q=0.2,en;q=0.9")],
        )
        .await
        .2,
    );

    // Accept-Language 缺失或空白时才用 X-App-Language。
    let xapp = [("x-app-language", "en-US")];
    english(
        &call_with_headers(&app, "/api/markers/public", &xapp)
            .await
            .2,
    );
    let blank_accept = [("accept-language", "   "), ("x-app-language", "en")];
    english(
        &call_with_headers(&app, "/api/markers/public", &blank_accept)
            .await
            .2,
    );
    let invalid_xapp = [("x-app-language", "system")];
    chinese(
        &call_with_headers(&app, "/api/markers/public", &invalid_xapp)
            .await
            .2,
    );

    // 显式空串 / 不受支持值也不回退。
    chinese(
        &call_with_headers(
            &app,
            "/api/markers/public?lang=",
            &[("accept-language", "en")],
        )
        .await
        .2,
    );
    chinese(
        &call_with_headers(
            &app,
            "/api/markers/public?lang=fr",
            &[("accept-language", "en")],
        )
        .await
        .2,
    );

    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT title FROM map_markers WHERE id = $1")
            .bind(marker)
            .fetch_one(&pool)
            .await
            .unwrap(),
        CONTROL_TITLE,
        "读取本地化不得修改原文"
    );

    pool.close().await;
}

#[tokio::test]
async fn stale_translation_falls_back_to_source_language() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(
        pool.clone(),
        redis,
        temp.url(),
        &unique_cache_namespace(),
        true,
    );

    let stale = insert(
        &pool,
        Seed {
            title: "源标题".to_string(),
            description: Some("源描述".to_string()),
            ..Default::default()
        },
    )
    .await;
    insert_translation(&pool, stale, "en", "过期英文", Some("stale"), "deadbeef").await;

    let (_, _, body) = call(&app, &format!("/api/markers/{stale}?lang=en")).await;
    let marker = parse(&body);
    assert_eq!(marker["title"], json!("源标题"));
    assert_eq!(marker["contentLanguage"], json!("zh"));
    assert_eq!(marker["sourceLanguage"], json!("zh"));

    // 英文原文 + 有效中文译文：sourceLanguage/contentLanguage 正确。
    let english_source = insert(
        &pool,
        Seed {
            title: "English original".to_string(),
            source_language: "en".to_string(),
            ..Default::default()
        },
    )
    .await;
    let hash = source_hash_components("en", Some("English original"), None);
    insert_translation(&pool, english_source, "zh", "中文译文", None, &hash).await;

    let (_, _, body) = call(&app, &format!("/api/markers/{english_source}?lang=zh")).await;
    let marker = parse(&body);
    assert_eq!(marker["title"], json!("中文译文"));
    assert_eq!(marker["sourceLanguage"], json!("en"));
    assert_eq!(marker["contentLanguage"], json!("zh"));

    pool.close().await;
}

#[tokio::test]
async fn search_merges_source_translation_and_coordinates_without_duplicates() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(
        pool.clone(),
        redis,
        temp.url(),
        &unique_cache_namespace(),
        true,
    );

    let coffee = insert(
        &pool,
        Seed {
            title: "Coffee Clinic".to_string(),
            ..Default::default()
        },
    )
    .await;
    let by_source = insert(
        &pool,
        Seed {
            title: "无关联标题".to_string(),
            description: Some("unique-source-token".to_string()),
            ..Default::default()
        },
    )
    .await;
    let by_translation = insert(
        &pool,
        Seed {
            title: "译文命中源".to_string(),
            ..Default::default()
        },
    )
    .await;
    let hash = source_hash_components("zh", Some("译文命中源"), None);
    insert_translation(
        &pool,
        by_translation,
        "en",
        "unique-translation-token",
        None,
        &hash,
    )
    .await;
    let private = insert(
        &pool,
        Seed {
            title: "私有点".to_string(),
            is_public: false,
            ..Default::default()
        },
    )
    .await;
    let private_hash = source_hash_components("zh", Some("私有点"), None);
    insert_translation(
        &pool,
        private,
        "en",
        "unique-translation-token",
        None,
        &private_hash,
    )
    .await;
    let coordinate = insert(
        &pool,
        Seed {
            lat: 31.2304,
            lng: 121.4737,
            title: "坐标点".to_string(),
            ..Default::default()
        },
    )
    .await;
    let dedup = insert(
        &pool,
        Seed {
            title: "dup-token".to_string(),
            ..Default::default()
        },
    )
    .await;
    let dedup_hash = source_hash_components("zh", Some("dup-token"), None);
    insert_translation(&pool, dedup, "en", "dup-token", None, &dedup_hash).await;
    let wildcard = insert(
        &pool,
        Seed {
            title: "zzqqxx".to_string(),
            ..Default::default()
        },
    )
    .await;

    let (status, headers, body) = call(&app, "/api/markers/search?q=").await;
    assert_eq!(status, StatusCode::OK);
    assert_vary(&headers);
    assert_eq!(parse(&body).as_array().unwrap().len(), 0);
    let (status, _, body) = call(&app, "/api/markers/search?q=%20").await;
    assert_eq!(status, StatusCode::OK, "空白 q 返回 []");
    assert_eq!(parse(&body).as_array().unwrap().len(), 0);
    // 与 Java 一致：`q` 完全缺失属于参数解析层错误。
    let (status, _, body) = call(&app, "/api/markers/search").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "缺少 q 应 400");
    assert_eq!(body, "缺少 q 参数".as_bytes());

    for query in ["coffee", "COFFEE"] {
        let body = call(&app, &format!("/api/markers/search?q={query}"))
            .await
            .2;
        assert_eq!(
            expect_marker(&parse(&body), coffee)["title"],
            json!("Coffee Clinic")
        );
    }

    let body = call(&app, "/api/markers/search?q=unique-source-token")
        .await
        .2;
    let array = parse(&body);
    assert_eq!(array.as_array().unwrap().len(), 1);
    expect_marker(&array, by_source);

    let body = call(
        &app,
        "/api/markers/search?q=unique-translation-token&lang=en",
    )
    .await
    .2;
    let array = parse(&body);
    assert_eq!(array.as_array().unwrap().len(), 1);
    expect_marker(&array, by_translation);
    assert_eq!(count_id(&array, private), 0, "私有译文命中必须被过滤");
    assert_eq!(
        expect_marker(&array, by_translation)["contentLanguage"],
        json!("en")
    );

    let body = call(&app, "/api/markers/search?q=31.2304%2C121.4737")
        .await
        .2;
    expect_marker(&parse(&body), coordinate);

    let body = call(&app, "/api/markers/search?q=dup-token").await.2;
    assert_eq!(count_id(&parse(&body), dedup), 1, "原文与译文命中应去重");

    // `%` / `_` 保留既有通配行为。
    expect_marker(
        &parse(&call(&app, "/api/markers/search?q=zz%25xx").await.2),
        wildcard,
    );
    assert_eq!(
        count_id(
            &parse(&call(&app, "/api/markers/search?q=zz_xx").await.2),
            wildcard
        ),
        0
    );

    pool.close().await;
}

#[tokio::test]
async fn nearby_defaults_and_validation() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(
        pool.clone(),
        redis,
        temp.url(),
        &unique_cache_namespace(),
        true,
    );

    let toilet = insert(
        &pool,
        Seed {
            title: "默认类别".to_string(),
            ..Default::default()
        },
    )
    .await;
    insert(
        &pool,
        Seed {
            category: "baby_room".to_string(),
            title: "其他类别".to_string(),
            ..Default::default()
        },
    )
    .await;
    insert(
        &pool,
        Seed {
            is_public: false,
            title: "私有".to_string(),
            ..Default::default()
        },
    )
    .await;
    insert(
        &pool,
        Seed {
            review_status: "PENDING".to_string(),
            title: "待审".to_string(),
            ..Default::default()
        },
    )
    .await;
    let beyond = insert(
        &pool,
        Seed {
            lat: 0.00901,
            lng: 0.0,
            title: "默认半径外".to_string(),
            ..Default::default()
        },
    )
    .await;
    let legacy = insert(
        &pool,
        Seed {
            category: "self_definition".to_string(),
            title: "自定义".to_string(),
            ..Default::default()
        },
    )
    .await;

    let (status, _, body) = call(&app, "/api/markers/nearby?lat=0&lng=0").await;
    assert_eq!(status, StatusCode::OK);
    let array = parse(&body);
    assert_eq!(
        array.as_array().unwrap().len(),
        1,
        "默认类别/半径只应返回中心的无障碍卫生间"
    );
    assert_eq!(
        expect_marker(&array, toilet)["category"],
        json!("accessible_toilet")
    );

    let array = parse(
        &call(&app, "/api/markers/nearby?lat=0&lng=0&radius=5000")
            .await
            .2,
    );
    assert_eq!(
        count_id(&array, beyond),
        1,
        "放大半径后应包含默认半径外的点"
    );

    let (status, _, body) = call(&app, "/api/markers/nearby?lng=0").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, "缺少 lat/lng 参数".as_bytes());

    for uri in [
        "/api/markers/nearby?lat=91&lng=0",
        "/api/markers/nearby?lat=0&lng=181",
        "/api/markers/nearby?lat=NaN&lng=0",
    ] {
        let (status, _, body) = call(&app, uri).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(body, "lat/lng 不合法".as_bytes());
    }

    let (status, _, _) = call(&app, "/api/markers/nearby?lat=0&lng=0&category=unknown").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let array = parse(
        &call(&app, "/api/markers/nearby?lat=0&lng=0&category=safe_place")
            .await
            .2,
    );
    assert_eq!(
        expect_marker(&array, legacy)["category"],
        json!("self_definition")
    );

    pool.close().await;
}

#[tokio::test]
async fn nearby_orders_by_distance_and_stabilizes_ties() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(
        pool.clone(),
        redis,
        temp.url(),
        &unique_cache_namespace(),
        true,
    );

    let center = insert(
        &pool,
        Seed {
            title: "中心".to_string(),
            ..Default::default()
        },
    )
    .await;
    let tie_a = insert(
        &pool,
        Seed {
            lat: 0.0,
            lng: 0.002,
            title: "同距A".to_string(),
            ..Default::default()
        },
    )
    .await;
    let tie_b = insert(
        &pool,
        Seed {
            lat: 0.0,
            lng: -0.002,
            title: "同距B".to_string(),
            ..Default::default()
        },
    )
    .await;
    let farther = insert(
        &pool,
        Seed {
            lat: 0.0,
            lng: 0.004,
            title: "更远".to_string(),
            ..Default::default()
        },
    )
    .await;

    let body = call(
        &app,
        "/api/markers/nearby?lat=0&lng=0&radius=5000&category=accessible_toilet",
    )
    .await
    .2;
    let array = parse(&body);
    let ids: Vec<i64> = array
        .as_array()
        .unwrap()
        .iter()
        .map(|marker| marker["id"].as_i64().unwrap())
        .collect();
    assert_eq!(
        ids,
        vec![center, tie_a, tie_b, farther],
        "按距离升序、同距按 ID 稳定"
    );

    pool.close().await;
}

#[tokio::test]
async fn nearby_radius_boundary_and_clamp() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(
        pool.clone(),
        redis,
        temp.url(),
        &unique_cache_namespace(),
        true,
    );

    let center = insert(
        &pool,
        Seed {
            title: "中心".to_string(),
            ..Default::default()
        },
    )
    .await;
    let inside = insert(
        &pool,
        Seed {
            lat: crate::common::destination(0.0, 0.0, 995.0, 0.0).0,
            lng: 0.0,
            title: "边界内".to_string(),
            ..Default::default()
        },
    )
    .await;
    let outside = insert(
        &pool,
        Seed {
            lat: crate::common::destination(0.0, 0.0, 1005.0, 0.0).0,
            lng: 0.0,
            title: "边界外".to_string(),
            ..Default::default()
        },
    )
    .await;

    let body = call(
        &app,
        "/api/markers/nearby?lat=0&lng=0&radius=1000&category=accessible_toilet",
    )
    .await
    .2;
    let array = parse(&body);
    assert_eq!(count_id(&array, center), 1);
    assert_eq!(count_id(&array, inside), 1, "995m 应在 1000m 半径内");
    assert_eq!(count_id(&array, outside), 0, "1005m 应在 1000m 半径外");

    // radius=0 夹取为 1：只保留 0 距离点。
    let array = parse(
        &call(&app, "/api/markers/nearby?lat=0&lng=0&radius=0")
            .await
            .2,
    );
    assert_eq!(count_id(&array, center), 1);
    assert_eq!(count_id(&array, inside), 0);

    // 大半径夹取到 50000：40km 点被包含。
    let far = crate::common::destination(0.0, 0.0, 40_000.0, 0.0);
    let far_id = insert(
        &pool,
        Seed {
            lat: far.0,
            lng: far.1,
            title: "40km".to_string(),
            ..Default::default()
        },
    )
    .await;
    let array = parse(
        &call(&app, "/api/markers/nearby?lat=0&lng=0&radius=100000")
            .await
            .2,
    );
    assert_eq!(count_id(&array, far_id), 1);

    pool.close().await;
}

#[tokio::test]
async fn nearby_handles_dateline_and_poles() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(
        pool.clone(),
        redis,
        temp.url(),
        &unique_cache_namespace(),
        true,
    );

    let center = insert(
        &pool,
        Seed {
            lat: 0.0,
            lng: 179.999,
            title: "日界线中心".to_string(),
            ..Default::default()
        },
    )
    .await;
    let east = insert(
        &pool,
        Seed {
            lat: 0.0,
            lng: 179.998,
            title: "东侧".to_string(),
            ..Default::default()
        },
    )
    .await;
    let west = insert(
        &pool,
        Seed {
            lat: 0.0,
            lng: -179.998,
            title: "西侧".to_string(),
            ..Default::default()
        },
    )
    .await;
    let opposite = insert(
        &pool,
        Seed {
            lat: 0.0,
            lng: 0.0,
            title: "对面".to_string(),
            ..Default::default()
        },
    )
    .await;
    let positive_180 = insert(
        &pool,
        Seed {
            lat: 0.0,
            lng: 180.0,
            title: "+180".to_string(),
            ..Default::default()
        },
    )
    .await;
    let negative_180 = insert(
        &pool,
        Seed {
            lat: 0.0,
            lng: -180.0,
            title: "-180".to_string(),
            ..Default::default()
        },
    )
    .await;

    let array = parse(
        &call(&app, "/api/markers/nearby?lat=0&lng=179.999&radius=1000")
            .await
            .2,
    );
    for id in [center, east, west] {
        assert_eq!(count_id(&array, id), 1, "跨日界线应命中点位 {id}");
    }
    assert_eq!(count_id(&array, opposite), 0);

    let array = parse(
        &call(&app, "/api/markers/nearby?lat=0&lng=180&radius=1000")
            .await
            .2,
    );
    assert_eq!(count_id(&array, positive_180), 1);
    assert_eq!(count_id(&array, negative_180), 1, "±180 两种表示都应命中");

    // 极点：半径 50km 内不受经度限制。
    let pole_in = insert(
        &pool,
        Seed {
            lat: 89.6,
            lng: -120.0,
            title: "极区内".to_string(),
            ..Default::default()
        },
    )
    .await;
    let pole_out = insert(
        &pool,
        Seed {
            lat: 89.5,
            lng: 0.0,
            title: "极区外".to_string(),
            ..Default::default()
        },
    )
    .await;
    let array = parse(
        &call(&app, "/api/markers/nearby?lat=90&lng=75&radius=50000")
            .await
            .2,
    );
    assert_eq!(count_id(&array, pole_in), 1);
    assert_eq!(count_id(&array, pole_out), 0);

    pool.close().await;
}

#[tokio::test]
async fn viewport_bounds_and_category_whitelist() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(
        pool.clone(),
        redis,
        temp.url(),
        &unique_cache_namespace(),
        true,
    );

    let toilet = insert(
        &pool,
        Seed {
            lat: 1.0,
            lng: 1.0,
            title: "视口内卫生间".to_string(),
            ..Default::default()
        },
    )
    .await;
    let baby = insert(
        &pool,
        Seed {
            lat: 1.5,
            lng: 1.5,
            category: "baby_room".to_string(),
            title: "视口内育婴室".to_string(),
            ..Default::default()
        },
    )
    .await;
    let custom = insert(
        &pool,
        Seed {
            lat: 1.2,
            lng: 1.2,
            category: "self_definition".to_string(),
            title: "视口内自定义".to_string(),
            ..Default::default()
        },
    )
    .await;
    insert(
        &pool,
        Seed {
            lat: 50.0,
            lng: 50.0,
            title: "视口外".to_string(),
            ..Default::default()
        },
    )
    .await;
    insert(
        &pool,
        Seed {
            lat: 1.0,
            lng: 1.0,
            is_public: false,
            title: "视口内私有".to_string(),
            ..Default::default()
        },
    )
    .await;
    insert(
        &pool,
        Seed {
            lat: 1.0,
            lng: 1.0,
            review_status: "PENDING".to_string(),
            title: "视口内待审".to_string(),
            ..Default::default()
        },
    )
    .await;

    let base = "/api/markers/viewport?minLat=0&maxLat=2&minLng=0&maxLng=2";
    let (status, headers, body) = call(&app, base).await;
    assert_eq!(status, StatusCode::OK);
    assert_vary(&headers);
    let array = parse(&body);
    assert_eq!(
        array.as_array().unwrap().len(),
        3,
        "只返回视口内公开已审核点位"
    );
    for id in [toilet, baby, custom] {
        assert_eq!(count_id(&array, id), 1);
    }

    let filtered = parse(
        &call(&app, &format!("{base}&categories=accessible_toilet"))
            .await
            .2,
    );
    assert_eq!(filtered.as_array().unwrap().len(), 1);
    assert_eq!(
        expect_marker(&filtered, toilet)["category"],
        json!("accessible_toilet")
    );

    let legacy = parse(&call(&app, &format!("{base}&categories=safe_place")).await.2);
    assert_eq!(legacy.as_array().unwrap().len(), 1);
    expect_marker(&legacy, custom);

    let two = parse(
        &call(
            &app,
            &format!("{base}&categories=accessible_toilet,baby_room"),
        )
        .await
        .2,
    );
    assert_eq!(two.as_array().unwrap().len(), 2);

    let (status, _, _) = call(&app, &format!("{base}&categories=unknown")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _, body) = call(
        &app,
        "/api/markers/viewport?minLat=2&maxLat=0&minLng=0&maxLng=2",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, "边界参数不合法".as_bytes());
    let (status, _, body) = call(
        &app,
        "/api/markers/viewport?minLat=0&maxLat=2&minLng=2&maxLng=0",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, "边界参数不合法".as_bytes());

    for uri in [
        "/api/markers/viewport?minLat=-91&maxLat=2&minLng=0&maxLng=2",
        "/api/markers/viewport?minLat=0&maxLat=2&minLng=0&maxLng=181",
    ] {
        let (status, _, body) = call(&app, uri).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(body, "边界超出合法经纬度范围".as_bytes());
    }

    let (status, _, body) = call(&app, "/api/markers/viewport?minLat=0&maxLat=2&minLng=0").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, "缺少视口边界参数".as_bytes());

    pool.close().await;
}

#[tokio::test]
async fn cache_hit_rechecks_visibility_and_refreshes_content() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let namespace = unique_cache_namespace();
    let app = app_with(pool.clone(), redis.clone(), temp.url(), &namespace, true);

    let marker = insert(
        &pool,
        Seed {
            lat: 10.0,
            lng: 10.0,
            title: "old-title".to_string(),
            ..Default::default()
        },
    )
    .await;
    let nearby = "/api/markers/nearby?lat=10&lng=10&radius=1000&category=accessible_toilet";

    let body = call(&app, nearby).await.2;
    assert_eq!(parse(&body).as_array().unwrap().len(), 1);

    let cache = MarkerCache::new(redis.clone(), true, &namespace);
    let generation = cache.current_generation().await.unwrap();
    let key = cache.nearby_key(generation, 10.0, 10.0, 1000, "accessible_toilet");
    assert!(
        cache.read_ids(&key).await.unwrap().contains(&marker),
        "首次查询后应写入缓存 ID"
    );

    // 内容修改：命中缓存仍读取最新内容。
    sqlx::query("UPDATE map_markers SET title = 'new-title' WHERE id = $1")
        .bind(marker)
        .execute(&pool)
        .await
        .unwrap();
    let body = call(&app, nearby).await.2;
    assert_eq!(
        expect_marker(&parse(&body), marker)["title"],
        json!("new-title")
    );

    // 转私有立即隐藏。
    sqlx::query("UPDATE map_markers SET is_public = false WHERE id = $1")
        .bind(marker)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        parse(&call(&app, nearby).await.2).as_array().unwrap().len(),
        0
    );

    // 转 REJECTED 立即隐藏。
    sqlx::query(
        "UPDATE map_markers SET is_public = true, review_status = 'REJECTED' WHERE id = $1",
    )
    .bind(marker)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        parse(&call(&app, nearby).await.2).as_array().unwrap().len(),
        0
    );

    // 恢复后，缓存 ID 集合仍生效：新增点位在失效前不出现。
    sqlx::query("UPDATE map_markers SET review_status = 'APPROVED' WHERE id = $1")
        .bind(marker)
        .execute(&pool)
        .await
        .unwrap();
    let new_marker = insert(
        &pool,
        Seed {
            lat: 10.0001,
            lng: 10.0,
            title: "new-marker".to_string(),
            ..Default::default()
        },
    )
    .await;
    let array = parse(&call(&app, nearby).await.2);
    assert_eq!(
        count_id(&array, new_marker),
        0,
        "缓存命中时不应包含新增点位"
    );

    // 生成版本失效后回源，新点位出现。
    cache.invalidate().await.unwrap();
    let array = parse(&call(&app, nearby).await.2);
    assert_eq!(count_id(&array, new_marker), 1);

    // 清理本用例自己的 generation 键（定向 DEL，不使用 KEYS/FLUSHALL）。
    let _: i64 = redis.del(format!("{namespace}:gen")).await.unwrap();

    pool.close().await;
}

#[tokio::test]
async fn cache_bad_json_and_redis_failure_fall_back_to_database() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let namespace = unique_cache_namespace();
    let app = app_with(pool.clone(), redis.clone(), temp.url(), &namespace, true);

    let marker = insert(
        &pool,
        Seed {
            lat: 20.0,
            lng: 20.0,
            title: "坏缓存回源".to_string(),
            ..Default::default()
        },
    )
    .await;
    let nearby = "/api/markers/nearby?lat=20&lng=20&radius=1000&category=accessible_toilet";

    let cache = MarkerCache::new(redis.clone(), true, &namespace);
    let generation = cache.current_generation().await.unwrap();
    let key = cache.nearby_key(generation, 20.0, 20.0, 1000, "accessible_toilet");
    redis
        .set::<(), _, _>(
            key.clone(),
            "{not-json".to_string(),
            Some(Expiration::EX(30)),
            None,
            false,
        )
        .await
        .unwrap();

    let body = call(&app, nearby).await.2;
    assert_eq!(count_id(&parse(&body), marker), 1);
    assert!(
        cache.read_ids(&key).await.is_some(),
        "坏 JSON 回源后应用有效缓存覆盖"
    );

    // Redis 完全不可用：直接回源数据库，接口仍 200。
    let broken_app = app_with(
        pool.clone(),
        unreachable_redis(),
        temp.url(),
        &unique_cache_namespace(),
        true,
    );
    let result = tokio::time::timeout(Duration::from_secs(10), call(&broken_app, nearby))
        .await
        .expect("Redis 故障时请求不应挂起");
    assert_eq!(result.0, StatusCode::OK);
    assert_eq!(count_id(&parse(&result.2), marker), 1);

    let viewport = "/api/markers/viewport?minLat=19&maxLat=21&minLng=19&maxLng=21";
    let result = tokio::time::timeout(Duration::from_secs(10), call(&broken_app, viewport))
        .await
        .expect("Redis 故障时请求不应挂起");
    assert_eq!(result.0, StatusCode::OK);

    pool.close().await;
}

#[tokio::test]
async fn reads_do_not_advance_version_or_persist_availability() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let app = app_with(
        pool.clone(),
        redis,
        temp.url(),
        &unique_cache_namespace(),
        true,
    );

    let marker = insert(
        &pool,
        Seed {
            lat: 5.0,
            lng: 5.0,
            category: "legacy-category".to_string(),
            title: "只读".to_string(),
            is_active: false,
            open_time_start: Some("08:00".to_string()),
            open_time_end: Some("20:00".to_string()),
            version: 7,
            ..Default::default()
        },
    )
    .await;

    let before = sqlx::query_as::<_, (i64, bool, String, chrono::DateTime<chrono::Utc>)>(
        "SELECT version, is_active, category, updated_at FROM map_markers WHERE id = $1",
    )
    .bind(marker)
    .fetch_one(&pool)
    .await
    .unwrap();

    for uri in [
        "/api/markers/public".to_string(),
        "/api/markers/search?q=%E5%8F%AA%E8%AF%BB".to_string(),
        "/api/markers/nearby?lat=5&lng=5&radius=1000&category=self_definition".to_string(),
        "/api/markers/viewport?minLat=4&maxLat=6&minLng=4&maxLng=6".to_string(),
        format!("/api/markers/{marker}"),
    ] {
        let (status, _, _) = call(&app, &uri).await;
        assert_eq!(status, StatusCode::OK, "{uri}");
    }

    let after = sqlx::query_as::<_, (i64, bool, String, chrono::DateTime<chrono::Utc>)>(
        "SELECT version, is_active, category, updated_at FROM map_markers WHERE id = $1",
    )
    .bind(marker)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        before, after,
        "读取不得修改 version/is_active/category/updated_at"
    );

    // 读取响应中的类别已归一，但数据库保持原值。
    let (_, _, body) = call(&app, &format!("/api/markers/{marker}")).await;
    assert_eq!(parse(&body)["category"], json!("self_definition"));

    pool.close().await;
}

#[tokio::test]
async fn invalidate_advances_generation_and_exposes_new_points() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let namespace = unique_cache_namespace();
    let app = app_with(pool.clone(), redis.clone(), temp.url(), &namespace, true);

    let first = insert(
        &pool,
        Seed {
            lat: 30.0,
            lng: 30.0,
            title: "first".to_string(),
            ..Default::default()
        },
    )
    .await;
    let nearby = "/api/markers/nearby?lat=30&lng=30&radius=1000&category=accessible_toilet";
    assert_eq!(
        parse(&call(&app, nearby).await.2).as_array().unwrap().len(),
        1
    );

    let cache = MarkerCache::new(redis.clone(), true, &namespace);
    let generation_key = format!("{namespace}:gen");
    assert_eq!(
        cache.current_generation().await,
        Some(0),
        "缺失 generation 时缺省代次为 0"
    );

    // 第一次 INCR：缺 key 得到 1，命名空间确实变化，预热后新增点立即出现。
    let second = insert(
        &pool,
        Seed {
            lat: 30.0001,
            lng: 30.0,
            title: "second".to_string(),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(cache.invalidate().await.unwrap(), 1);
    let array = parse(&call(&app, nearby).await.2);
    assert_eq!(count_id(&array, first), 1);
    assert_eq!(count_id(&array, second), 1, "第一次失效后新增点应出现");

    // 第二次 INCR：1 → 2，再次失效。
    let third = insert(
        &pool,
        Seed {
            lat: 30.0002,
            lng: 30.0,
            title: "third".to_string(),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(cache.invalidate().await.unwrap(), 2);
    let array = parse(&call(&app, nearby).await.2);
    assert_eq!(count_id(&array, third), 1, "第二次失效后新增点应出现");

    // generation 不自动过期：永续键，TTL 为 -1。
    let ttl: i64 = redis.ttl(generation_key.clone()).await.unwrap();
    assert_eq!(ttl, -1, "generation key 不应带 TTL");

    // 清理本用例自己的 generation 键（定向 DEL，不使用 KEYS/FLUSHALL）。
    let deleted: i64 = redis.del(generation_key).await.unwrap();
    assert_eq!(deleted, 1);

    // 禁用缓存时失效无需 Redis：即使客户端不可用也能成功返回。
    let disabled = MarkerCache::new(unreachable_redis(), false, unique_cache_namespace());
    assert_eq!(disabled.invalidate().await.unwrap(), 0);

    pool.close().await;
}

#[tokio::test]
async fn nearby_cache_distinguishes_requests_differing_at_fifth_decimal() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let namespace = unique_cache_namespace();
    let app = app_with(pool.clone(), redis.clone(), temp.url(), &namespace, true);

    // 距原点约 1.11m：半径 1m 时从 (0,0) 看不到，从 (0.00001,0) 自身能看到。
    let marker = insert(
        &pool,
        Seed {
            lat: 0.00001,
            lng: 0.0,
            title: "tiny".to_string(),
            ..Default::default()
        },
    )
    .await;

    let cache = MarkerCache::new(redis.clone(), true, &namespace);
    let generation = cache.current_generation().await.unwrap();
    let key_a = cache.nearby_key(generation, 0.0, 0.0, 1, "accessible_toilet");
    let key_b = cache.nearby_key(generation, 0.00001, 0.0, 1, "accessible_toilet");
    assert_ne!(key_a, key_b, "第 5 位小数必须产生不同缓存 key");

    let query_a = "/api/markers/nearby?lat=0&lng=0&radius=1&category=accessible_toilet";
    let query_b = "/api/markers/nearby?lat=0.00001&lng=0&radius=1&category=accessible_toilet";
    assert_eq!(count_id(&parse(&call(&app, query_a).await.2), marker), 0);
    assert_eq!(
        count_id(&parse(&call(&app, query_b).await.2), marker),
        1,
        "只差小数第 5 位的邻近请求不得共享缓存结果"
    );

    let _: i64 = redis.del(format!("{namespace}:gen")).await.unwrap();
    pool.close().await;
}

#[tokio::test]
async fn viewport_cache_distinguishes_requests_differing_at_fifth_decimal() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let redis = connect_redis().await;
    let namespace = unique_cache_namespace();
    let app = app_with(pool.clone(), redis.clone(), temp.url(), &namespace, true);

    let marker = insert(
        &pool,
        Seed {
            lat: 0.000015,
            lng: 0.0,
            title: "narrow".to_string(),
            ..Default::default()
        },
    )
    .await;

    let cache = MarkerCache::new(redis.clone(), true, &namespace);
    let generation = cache.current_generation().await.unwrap();
    let key_a = cache.viewport_key(generation, 0.0, 0.00001, -1.0, 1.0, "all");
    let key_b = cache.viewport_key(generation, 0.0, 0.00002, -1.0, 1.0, "all");
    assert_ne!(key_a, key_b, "窄视口第 5 位小数必须产生不同缓存 key");

    let query_a = "/api/markers/viewport?minLat=0&maxLat=0.00001&minLng=-1&maxLng=1";
    let query_b = "/api/markers/viewport?minLat=0&maxLat=0.00002&minLng=-1&maxLng=1";
    assert_eq!(count_id(&parse(&call(&app, query_a).await.2), marker), 0);
    assert_eq!(
        count_id(&parse(&call(&app, query_b).await.2), marker),
        1,
        "只差小数第 5 位的视口请求不得共享缓存结果"
    );

    let _: i64 = redis.del(format!("{namespace}:gen")).await.unwrap();
    pool.close().await;
}

#[tokio::test]
async fn redis_outage_is_bounded_and_falls_back_to_database() {
    let (temp, pool) = TempDatabase::create_migrated().await;
    let marker = insert(
        &pool,
        Seed {
            lat: 40.0,
            lng: 40.0,
            title: "bounded".to_string(),
            ..Default::default()
        },
    )
    .await;
    let nearby = "/api/markers/nearby?lat=40&lng=40&radius=1000&category=accessible_toilet";
    let viewport = "/api/markers/viewport?minLat=39&maxLat=41&minLng=39&maxLng=41";

    for (label, redis) in [
        ("未连接客户端", unreachable_redis()),
        ("已断开客户端", disconnected_redis().await),
    ] {
        let app = app_with(
            pool.clone(),
            redis,
            temp.url(),
            &unique_cache_namespace(),
            true,
        );

        let started = Instant::now();
        let (status, _, body) = call(&app, nearby).await;
        let elapsed = started.elapsed();
        assert_eq!(status, StatusCode::OK, "{label}: nearby 应回源成功");
        assert_eq!(
            count_id(&parse(&body), marker),
            1,
            "{label}: nearby 数据正确"
        );
        assert!(
            elapsed < Duration::from_secs(3),
            "{label}: nearby 等待受限，实际 {elapsed:?}"
        );

        let started = Instant::now();
        let (status, _, _) = call(&app, viewport).await;
        let elapsed = started.elapsed();
        assert_eq!(status, StatusCode::OK, "{label}: viewport 应回源成功");
        assert!(
            elapsed < Duration::from_secs(3),
            "{label}: viewport 等待受限，实际 {elapsed:?}"
        );
    }

    pool.close().await;
}
