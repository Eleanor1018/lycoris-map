mod common;
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode},
};
use lycoris_backend::{
    app::{AppState, build_router},
    config::Config,
    email_verification::{CodeError, CodeMailer, Purpose, SendResult},
    users,
};
use serde_json::{Value, json};
use std::{
    net::SocketAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tower::ServiceExt;

#[derive(Default)]
struct Mailbox {
    codes: Mutex<Vec<(String, String)>>,
    fail: AtomicBool,
}
impl CodeMailer for Mailbox {
    fn send<'a>(
        &'a self,
        email: &'a str,
        _purpose: Purpose,
        code: &'a str,
        _chinese: bool,
    ) -> SendResult<'a> {
        Box::pin(async move {
            if self.fail.load(Ordering::SeqCst) {
                return Err(CodeError::Unavailable);
            }
            self.codes.lock().unwrap().push((email.into(), code.into()));
            Ok(())
        })
    }
}
struct TestEnv {
    state: AppState,
    mailbox: Arc<Mailbox>,
    _db: common::TempDatabase,
    _uploads: tempfile::TempDir,
}
impl TestEnv {
    async fn new() -> Self {
        let (db, pool) = common::TempDatabase::create_migrated().await;
        let uploads = tempfile::tempdir().unwrap();
        let mut config = Config::new("unused", common::test_redis_url());
        config.upload_dir = uploads.path().into();
        config.bcrypt_cost = 4;
        config.session_namespace = format!("email-http:{}", uuid::Uuid::new_v4());
        config.rate_limit_namespace = format!("{}:rate", config.session_namespace);
        config.email_verification_secret = Some("synthetic-only-email-key-at-least-32".into());
        let mut state = AppState::new(pool, common::connect_redis().await, config).unwrap();
        let mailbox = Arc::new(Mailbox::default());
        state.email_codes = state.email_codes.with_mailer(mailbox.clone());
        Self {
            state,
            mailbox,
            _db: db,
            _uploads: uploads,
        }
    }
    async fn call(
        &self,
        path: &str,
        body: Value,
        cookie: Option<&str>,
    ) -> (StatusCode, Value, Option<String>) {
        let mut req = Request::builder()
            .method(if body.is_null() { "GET" } else { "POST" })
            .uri(path)
            .header("content-type", "application/json");
        if let Some(cookie) = cookie {
            req = req.header("cookie", cookie);
        }
        let mut req = req.body(Body::from(body.to_string())).unwrap();
        req.extensions_mut().insert(ConnectInfo(
            "127.0.0.1:50000".parse::<SocketAddr>().unwrap(),
        ));
        let response = build_router(self.state.clone()).oneshot(req).await.unwrap();
        let status = response.status();
        let cookie = response
            .headers()
            .get("set-cookie")
            .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string());
        let body = to_bytes(response.into_body(), 100000).await.unwrap();
        (
            status,
            serde_json::from_slice(&body).unwrap_or(Value::Null),
            cookie,
        )
    }
    fn code(&self) -> String {
        self.mailbox.codes.lock().unwrap().last().unwrap().1.clone()
    }
}

#[tokio::test]
async fn registration_requires_a_delivered_code_and_sets_verification_only_for_new_account() {
    let env = TestEnv::new().await;
    let mut register =
        json!({"username":"new-user","email":"New@Example.test","password":"test-password"});
    let missing = env.call("/api/register", register.clone(), None).await;
    assert_eq!(missing.0, StatusCode::BAD_REQUEST);
    assert_eq!(missing.1["code"], 40021);
    let sent = env
        .call(
            "/api/auth/email-code",
            json!({"email":" NEW@example.test ","purpose":"register"}),
            None,
        )
        .await;
    assert_eq!(sent.0, StatusCode::OK);
    assert_eq!(env.mailbox.codes.lock().unwrap()[0].0, "new@example.test");
    assert_eq!(sent.1["data"]["expiresInSeconds"], 600);
    register["verificationCode"] = json!(env.code());
    let created = env.call("/api/register", register.clone(), None).await;
    assert_eq!(created.0, StatusCode::OK);
    assert!(created.2.is_some());
    let verified: bool = sqlx::query_scalar(
        "SELECT email_verified_at IS NOT NULL FROM users WHERE username='new-user'",
    )
    .fetch_one(&env.state.db)
    .await
    .unwrap();
    assert!(verified);
    assert_eq!(
        env.call("/api/register", register, None).await.0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn recovery_changes_password_revokes_every_old_session_and_never_logs_in() {
    let env = TestEnv::new().await;
    let hash = env
        .state
        .passwords
        .hash("old-password".into())
        .await
        .unwrap();
    users::insert_user(
        &env.state.db,
        "existing",
        "Existing",
        "existing@example.test",
        &hash,
    )
    .await
    .unwrap();
    let unverified: bool =
        sqlx::query_scalar("SELECT email_verified_at IS NULL FROM users WHERE username='existing'")
            .fetch_one(&env.state.db)
            .await
            .unwrap();
    assert!(unverified);
    let first = env
        .call(
            "/api/login",
            json!({"username":"existing","password":"old-password"}),
            None,
        )
        .await
        .2
        .unwrap();
    let second = env
        .call(
            "/api/login",
            json!({"username":"existing","password":"old-password"}),
            None,
        )
        .await
        .2
        .unwrap();
    assert_eq!(
        env.call(
            "/api/auth/email-code",
            json!({"email":"existing@example.test","purpose":"reset_password"}),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let reset = json!({"email":"existing@example.test","verificationCode":env.code(),"newPassword":"new-password"});
    let result = env
        .call("/api/auth/reset-password", reset.clone(), None)
        .await;
    assert_eq!(result.0, StatusCode::OK);
    assert!(result.2.is_none());
    for cookie in [&first, &second] {
        assert_eq!(
            env.call("/api/me", Value::Null, Some(cookie)).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        env.call("/api/auth/reset-password", reset, None).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        env.call(
            "/api/login",
            json!({"username":"existing","password":"old-password"}),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        env.call(
            "/api/login",
            json!({"username":"existing","password":"new-password"}),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
}
#[tokio::test]
async fn missing_account_has_same_send_response_and_cannot_be_created_by_recovery() {
    let env = TestEnv::new().await;
    assert_eq!(
        env.call(
            "/api/auth/email-code",
            json!({"email":"absent@example.test","purpose":"reset_password"}),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let result=env.call("/api/auth/reset-password",json!({"email":"absent@example.test","verificationCode":env.code(),"newPassword":"new-password"}),None).await;
    assert_eq!(result.0, StatusCode::BAD_REQUEST);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&env.state.db)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
#[tokio::test]
async fn smtp_failure_returns_retryable_error_and_resending_is_still_limited() {
    let env = TestEnv::new().await;
    env.mailbox.fail.store(true, Ordering::SeqCst);
    let input = json!({"email":"test@example.test","purpose":"register"});
    let failed = env.call("/api/auth/email-code", input.clone(), None).await;
    assert_eq!(failed.0, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(failed.1["code"], 50321);
    assert_eq!(
        env.call("/api/auth/email-code", input, None).await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[tokio::test]
async fn password_change_invalidates_an_older_recovery_challenge() {
    let env = TestEnv::new().await;
    let hash = env
        .state
        .passwords
        .hash("old-password".into())
        .await
        .unwrap();
    users::insert_user(
        &env.state.db,
        "changed-user",
        "Changed",
        "changed@example.test",
        &hash,
    )
    .await
    .unwrap();
    assert_eq!(
        env.call(
            "/api/auth/email-code",
            json!({"email":"changed@example.test","purpose":"reset_password"}),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let code = env.code();
    // The same session version advancement used by authenticated password changes.
    sqlx::query("UPDATE users SET session_version = session_version + 1, row_version = row_version + 1 WHERE username = 'changed-user'").execute(&env.state.db).await.unwrap();
    let rejected = env.call("/api/auth/reset-password", json!({"email":"changed@example.test","verificationCode":code,"newPassword":"unexpected-password"}), None).await;
    assert_eq!(rejected.0, StatusCode::BAD_REQUEST);
    assert_eq!(rejected.1["code"], 40021);
    assert_eq!(
        env.call(
            "/api/login",
            json!({"username":"changed-user","password":"old-password"}),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
}
