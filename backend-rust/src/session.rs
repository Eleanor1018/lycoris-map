//! 类型化 Redis 会话模块。
//!
//! 只提供本项目所需的五类操作：创建（可原子替换旧标识）、普通读取续期、
//! 删除、管理员二次验证状态写入/清除、以及当前会话版本推进。不引入通用记录协议，
//! 也不整份覆写身份对象（详见 `docs/rust-migration/auth-design.md`）。
//!
//! 设计要点：
//! - 标识是两份 `Uuid v4` 的连续十六进制文本（64 ASCII），Redis key 是标识的 SHA-256，
//!   因此 Cookie 不承载身份；日志也不会出现原始标识。
//! - 新记录只在 Lua 中确认 key 不存在后写入，TTL 与创建原子完成；重复时重新生成标识，
//!   绝不覆盖既有记录。替换已有会话时在同一 Lua 中删除旧 key。
//! - 普通读取只取字段并延续 TTL，不轮换标识、不回写整份身份。
//! - 所有字段级更新都在 Lua 中校验 key 存在且 `userId`/`sessionVersion`/观测角色
//!   与预期一致，更新失败不隐式创建 key，从而避免退出后被旧请求复活。

use std::collections::HashMap;
use std::time::Duration;

use fred::clients::Client;
use fred::prelude::*;
use sha2::{Digest, Sha256};
use uuid::Uuid;

const FIELD_USER_ID: &str = "userId";
const FIELD_SESSION_VERSION: &str = "sessionVersion";
const FIELD_ROLE: &str = "role";
const FIELD_CREATED_AT: &str = "createdAt";
const FIELD_SECOND_AT: &str = "secondAt";
const FIELD_PENDING_NONCE: &str = "pwNonce";
const FIELD_PENDING_UNTIL: &str = "pwPendingUntil";

/// 创建新会话：确认不存在后写入字段并原子设置 TTL；若 `KEYS[2] != KEYS[1]` 则删除旧记录。
/// ARGV: [ttl_ms, userId, sessionVersion, role, createdAt_ms]；返回 1 创建成功，0 已存在。
const CREATE_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
redis.call('HSET', KEYS[1],
  'userId', ARGV[2],
  'sessionVersion', ARGV[3],
  'role', ARGV[4],
  'createdAt', ARGV[5])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
if KEYS[2] ~= KEYS[1] then
  redis.call('DEL', KEYS[2])
end
return 1
"#;

/// 普通读取：取字段并延续 TTL，不轮换也不回写整份身份。
/// ARGV: [ttl_ms]；返回 HGETALL 扁平数组（key 不存在时为空）。
const READ_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 0 then
  return {}
end
local data = redis.call('HGETALL', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return data
"#;

/// 写入二次验证时间（epoch 毫秒）。要求 key 存在且身份字段完全匹配。
/// ARGV: [ttl_ms, userId, sessionVersion, role, secondAt_ms]。
const SET_SECOND_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[1], 'sessionVersion') ~= ARGV[3] then return 0 end
if redis.call('HGET', KEYS[1], 'role') ~= ARGV[4] then return 0 end
redis.call('HSET', KEYS[1], 'secondAt', ARGV[5])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1
"#;

/// 清除二次验证状态并延续 TTL。要求 key 存在且身份字段匹配。
/// ARGV: [ttl_ms, userId, sessionVersion, role]。
const CLEAR_SECOND_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[1], 'sessionVersion') ~= ARGV[3] then return 0 end
if redis.call('HGET', KEYS[1], 'role') ~= ARGV[4] then return 0 end
redis.call('HDEL', KEYS[1], 'secondAt')
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1
"#;

/// 观测到角色变化：更新会话中的观测角色并清除二次验证，避免继续授予旧权限状态。
/// ARGV: [ttl_ms, userId, sessionVersion, oldRole, newRole]。
const SYNC_ROLE_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[1], 'sessionVersion') ~= ARGV[3] then return 0 end
if redis.call('HGET', KEYS[1], 'role') ~= ARGV[4] then return 0 end
redis.call('HSET', KEYS[1], 'role', ARGV[5])
redis.call('HDEL', KEYS[1], 'secondAt')
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1
"#;

/// 开始改密转换：仅在 key 存在、身份与预期一致、且当前没有仍然有效的 pending 时，
/// 写入随机 `pwNonce` 与 `pwPendingUntil`（服务器毫秒时间）。已过期 pending 允许覆盖。
/// 返回：-1 会话缺失/身份不符；0 已有有效 pending；1 标记成功。
/// ARGV: [ttl_ms, userId, version, role, nonce, pendingUntilMs, nowMs]。
const BEGIN_PASSWORD_CHANGE_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[2] then return -1 end
if redis.call('HGET', KEYS[1], 'sessionVersion') ~= ARGV[3] then return -1 end
if redis.call('HGET', KEYS[1], 'role') ~= ARGV[4] then return -1 end
local until_raw = redis.call('HGET', KEYS[1], 'pwPendingUntil')
if until_raw then
  local until_ms = tonumber(until_raw)
  if until_ms and until_ms > tonumber(ARGV[7]) then return 0 end
end
redis.call('HSET', KEYS[1], 'pwNonce', ARGV[5], 'pwPendingUntil', ARGV[6])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1
"#;

/// 改密 PG 提交后：以 nonce 匹配为前提推进 sessionVersion、清 secondAt 与 pending。
/// 要求 key 仍存在且身份/旧版本一致；退出（key 已删）时返回 0，绝不复活会话。
/// ARGV: [ttl_ms, userId, oldVersion, role, nonce, newVersion]。
const COMPLETE_PASSWORD_CHANGE_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[1], 'sessionVersion') ~= ARGV[3] then return 0 end
if redis.call('HGET', KEYS[1], 'role') ~= ARGV[4] then return 0 end
if redis.call('HGET', KEYS[1], 'pwNonce') ~= ARGV[5] then return 0 end
redis.call('HSET', KEYS[1], 'sessionVersion', ARGV[6])
redis.call('HDEL', KEYS[1], 'secondAt', 'pwNonce', 'pwPendingUntil')
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1
"#;

/// PG 明确失败（版本冲突）时按 nonce 清除 pending；同样要求 key 存在、身份与 nonce 匹配，
/// 退出后不得写入。
/// ARGV: [ttl_ms, userId, version, role, nonce]。
const CANCEL_PASSWORD_CHANGE_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[1], 'sessionVersion') ~= ARGV[3] then return 0 end
if redis.call('HGET', KEYS[1], 'role') ~= ARGV[4] then return 0 end
if redis.call('HGET', KEYS[1], 'pwNonce') ~= ARGV[5] then return 0 end
redis.call('HDEL', KEYS[1], 'pwNonce', 'pwPendingUntil')
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1
"#;

/// 按读取快照 CAS 失效删除：仅当 key 仍存在、`userId`/`sessionVersion`/观测角色与预期
/// 快照完全一致，且**没有仍然有效的改密 pending** 时才删除。检查与删除在同一 Lua 内原子，
/// 避免检查后、删除前恰好建立 pending 的竞争。CAS 输给并发（推进/退出/新 pending）返回 0，
/// 由调用方重读新状态，绝不误删正在改密的当前登录。
/// ARGV: [userId, sessionVersion, role, nowMs]。
const INVALIDATE_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[1] then return 0 end
if redis.call('HGET', KEYS[1], 'sessionVersion') ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[1], 'role') ~= ARGV[3] then return 0 end
local until_raw = redis.call('HGET', KEYS[1], 'pwPendingUntil')
if until_raw then
  local until_ms = tonumber(until_raw)
  if until_ms and until_ms > tonumber(ARGV[4]) then return 0 end
end
redis.call('DEL', KEYS[1])
return 1
"#;

/// 新建会话所需的身份快照。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSession {
    pub user_id: i32,
    pub session_version: i64,
    pub role: String,
}

/// 从 Redis 读取到的会话记录；`second_at` 存在表示已通过管理员二次验证。
/// `pending_nonce`/`pending_until` 是改密转换的短期状态（见 `auth-design`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRecord {
    pub user_id: i32,
    pub session_version: i64,
    pub role: String,
    pub created_at: i64,
    pub second_at: Option<i64>,
    pub pending_nonce: Option<String>,
    pub pending_until: Option<i64>,
}

impl SessionRecord {
    /// pending 是否仍然有效（未过期）；`pending_until > now` 才算进行中。
    pub fn pending_active(&self, now_ms: i64) -> bool {
        self.pending_until.is_some_and(|until| until > now_ms)
    }
}

/// 开始改密转换的结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionState {
    /// 标记成功，可以进行 PG 写。
    Marked,
    /// 已有另一个改密转换进行中。
    AlreadyPending,
    /// 会话缺失或身份/版本不符（例如并发退出）。
    MissingOrMismatch,
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("Redis 会话命令失败")]
    Redis(#[from] fred::error::Error),
    #[error("会话数据损坏")]
    Corrupt,
    #[error("无法分配不碰撞的会话标识")]
    Collision,
    #[error("Redis 会话命令超时")]
    Timeout,
}

pub type SessionResult<T> = Result<T, SessionError>;

/// 会话存储句柄（克隆廉价）。
#[derive(Clone)]
pub struct SessionStore {
    redis: Client,
    namespace: String,
    ttl_ms: i64,
    command_timeout: Duration,
}

impl SessionStore {
    pub fn new(
        redis: Client,
        namespace: impl Into<String>,
        ttl: Duration,
        command_timeout: Duration,
    ) -> Self {
        Self {
            redis,
            namespace: namespace.into(),
            // 配置层已限制时长上限；这里再用饱和转换，杜绝 as 截断/溢出。
            ttl_ms: i64::try_from(ttl.as_millis()).unwrap_or(i64::MAX),
            command_timeout,
        }
    }

    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    /// 单条 Redis 命令带超时执行；依赖卡住时返回 [`SessionError::Timeout`]。
    async fn run<T>(
        &self,
        future: impl std::future::Future<Output = Result<T, fred::error::Error>>,
    ) -> SessionResult<T> {
        match tokio::time::timeout(self.command_timeout, future).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(SessionError::Redis(error)),
            Err(_) => Err(SessionError::Timeout),
        }
    }

    /// 生成两个 UUID v4 连续十六进制串（64 ASCII），作为不透明会话标识。
    pub fn generate_token() -> String {
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        format!("{}{}", first.simple(), second.simple())
    }

    /// 标识的 Redis key：`{namespace}:{sha256(token) hex}`。
    pub fn key_for(&self, token: &str) -> String {
        let digest = Sha256::digest(token.as_bytes());
        let mut hex = String::with_capacity(digest.len() * 2);
        for byte in digest {
            use std::fmt::Write as _;
            let _ = write!(hex, "{byte:02x}");
        }
        format!("{}:{}", self.namespace, hex)
    }

    /// 创建新会话；`old_token` 非空时在同一 Lua 中删除旧记录。碰撞自动重试。
    pub async fn create(
        &self,
        session: &NewSession,
        old_token: Option<&str>,
    ) -> SessionResult<String> {
        for _ in 0..8 {
            let token = Self::generate_token();
            let new_key = self.key_for(&token);
            let old_key = old_token
                .map(|token| self.key_for(token))
                .unwrap_or_else(|| new_key.clone());
            let created: i64 = self
                .run(self.redis.eval::<i64, _, _, _>(
                    CREATE_SCRIPT,
                    vec![new_key, old_key],
                    vec![
                        self.ttl_ms.to_string(),
                        session.user_id.to_string(),
                        session.session_version.to_string(),
                        session.role.clone(),
                        now_millis().to_string(),
                    ],
                ))
                .await?;
            if created == 1 {
                return Ok(token);
            }
        }
        Err(SessionError::Collision)
    }

    /// 普通读取：只取字段并延续 TTL；不存在返回 `None`。
    pub async fn read(&self, token: &str) -> SessionResult<Option<SessionRecord>> {
        let key = self.key_for(token);
        let fields: HashMap<String, String> = self
            .run(self.redis.eval::<HashMap<String, String>, _, _, _>(
                READ_SCRIPT,
                vec![key],
                vec![self.ttl_ms.to_string()],
            ))
            .await?;
        if fields.is_empty() {
            return Ok(None);
        }
        parse_record(&fields).map(Some)
    }

    /// 删除会话（退出）。已不存在也视为成功。
    pub async fn delete(&self, token: &str) -> SessionResult<()> {
        let key = self.key_for(token);
        self.run(self.redis.del::<i64, _>(key)).await?;
        Ok(())
    }

    /// 写入二次验证时间；身份或版本不匹配（含已退出）返回 `false`，不创建 key。
    pub async fn set_second_verified(
        &self,
        token: &str,
        session: &NewSession,
    ) -> SessionResult<bool> {
        let updated: i64 = self
            .run(self.redis.eval::<i64, _, _, _>(
                SET_SECOND_SCRIPT,
                vec![self.key_for(token)],
                vec![
                    self.ttl_ms.to_string(),
                    session.user_id.to_string(),
                    session.session_version.to_string(),
                    session.role.clone(),
                    now_millis().to_string(),
                ],
            ))
            .await?;
        Ok(updated == 1)
    }

    /// 原子清除二次验证状态（角色变化、过期、改密等）。
    pub async fn clear_second_verified(
        &self,
        token: &str,
        session: &NewSession,
    ) -> SessionResult<bool> {
        let updated: i64 = self
            .run(self.redis.eval::<i64, _, _, _>(
                CLEAR_SECOND_SCRIPT,
                vec![self.key_for(token)],
                vec![
                    self.ttl_ms.to_string(),
                    session.user_id.to_string(),
                    session.session_version.to_string(),
                    session.role.clone(),
                ],
            ))
            .await?;
        Ok(updated == 1)
    }

    /// 按读取快照 CAS 失效删除；仅当 Redis 当前身份与快照完全一致、且没有有效改密 pending
    /// 时才删除。`now_ms` 用于判断 pending 是否过期。
    pub async fn invalidate_if_matches(
        &self,
        token: &str,
        snapshot: &NewSession,
        now_ms: i64,
    ) -> SessionResult<bool> {
        let removed: i64 = self
            .run(self.redis.eval::<i64, _, _, _>(
                INVALIDATE_SCRIPT,
                vec![self.key_for(token)],
                vec![
                    snapshot.user_id.to_string(),
                    snapshot.session_version.to_string(),
                    snapshot.role.clone(),
                    now_ms.to_string(),
                ],
            ))
            .await?;
        Ok(removed == 1)
    }

    /// 角色变化时同步观测角色并清除二次验证状态。
    pub async fn sync_role(
        &self,
        token: &str,
        session: &NewSession,
        new_role: &str,
    ) -> SessionResult<bool> {
        let updated: i64 = self
            .run(self.redis.eval::<i64, _, _, _>(
                SYNC_ROLE_SCRIPT,
                vec![self.key_for(token)],
                vec![
                    self.ttl_ms.to_string(),
                    session.user_id.to_string(),
                    session.session_version.to_string(),
                    session.role.clone(),
                    new_role.to_string(),
                ],
            ))
            .await?;
        Ok(updated == 1)
    }

    /// 开始改密转换：写入 nonce 与有界 pending 期限。已有有效 pending 时返回
    /// [`TransitionState::AlreadyPending`]；会话缺失/身份不符返回 `MissingOrMismatch`。
    pub async fn begin_password_change(
        &self,
        token: &str,
        session: &NewSession,
        nonce: &str,
        pending_until_ms: i64,
        now_ms: i64,
    ) -> SessionResult<TransitionState> {
        let result: i64 = self
            .run(self.redis.eval::<i64, _, _, _>(
                BEGIN_PASSWORD_CHANGE_SCRIPT,
                vec![self.key_for(token)],
                vec![
                    self.ttl_ms.to_string(),
                    session.user_id.to_string(),
                    session.session_version.to_string(),
                    session.role.clone(),
                    nonce.to_string(),
                    pending_until_ms.to_string(),
                    now_ms.to_string(),
                ],
            ))
            .await?;
        Ok(match result {
            1 => TransitionState::Marked,
            0 => TransitionState::AlreadyPending,
            _ => TransitionState::MissingOrMismatch,
        })
    }

    /// PG 提交后：以 nonce 匹配为前提推进 sessionVersion、清 secondAt 与 pending。
    /// key 已删除（退出胜出）或 nonce/身份不符时返回 `false`，绝不复活会话。
    pub async fn complete_password_change(
        &self,
        token: &str,
        session: &NewSession,
        nonce: &str,
        new_version: i64,
    ) -> SessionResult<bool> {
        let updated: i64 = self
            .run(self.redis.eval::<i64, _, _, _>(
                COMPLETE_PASSWORD_CHANGE_SCRIPT,
                vec![self.key_for(token)],
                vec![
                    self.ttl_ms.to_string(),
                    session.user_id.to_string(),
                    session.session_version.to_string(),
                    session.role.clone(),
                    nonce.to_string(),
                    new_version.to_string(),
                ],
            ))
            .await?;
        Ok(updated == 1)
    }

    /// PG 明确失败（版本冲突）时按 nonce 清除 pending，便于用户重试。
    pub async fn cancel_password_change(
        &self,
        token: &str,
        session: &NewSession,
        nonce: &str,
    ) -> SessionResult<bool> {
        let updated: i64 = self
            .run(self.redis.eval::<i64, _, _, _>(
                CANCEL_PASSWORD_CHANGE_SCRIPT,
                vec![self.key_for(token)],
                vec![
                    self.ttl_ms.to_string(),
                    session.user_id.to_string(),
                    session.session_version.to_string(),
                    session.role.clone(),
                    nonce.to_string(),
                ],
            ))
            .await?;
        Ok(updated == 1)
    }
}

fn parse_record(fields: &HashMap<String, String>) -> SessionResult<SessionRecord> {
    let user_id = fields
        .get(FIELD_USER_ID)
        .and_then(|value| value.parse::<i32>().ok())
        .ok_or(SessionError::Corrupt)?;
    let session_version = fields
        .get(FIELD_SESSION_VERSION)
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or(SessionError::Corrupt)?;
    let role = fields
        .get(FIELD_ROLE)
        .cloned()
        .ok_or(SessionError::Corrupt)?;
    // createdAt 仅用于诊断；缺失时用 0 容忍旧记录，不据此授权。
    let created_at = fields
        .get(FIELD_CREATED_AT)
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    let second_at = fields
        .get(FIELD_SECOND_AT)
        .and_then(|value| value.parse::<i64>().ok());
    let pending_nonce = fields.get(FIELD_PENDING_NONCE).cloned();
    let pending_until = fields
        .get(FIELD_PENDING_UNTIL)
        .and_then(|value| value.parse::<i64>().ok());
    Ok(SessionRecord {
        user_id,
        session_version,
        role,
        created_at,
        second_at,
        pending_nonce,
        pending_until,
    })
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::{SessionStore, parse_record};
    use std::collections::HashMap;

    #[test]
    fn generated_token_is_64_ascii_hex() {
        let token = SessionStore::generate_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(token, SessionStore::generate_token());
    }

    #[test]
    fn parses_well_formed_record() {
        let mut fields = HashMap::new();
        fields.insert("userId".to_string(), "7".to_string());
        fields.insert("sessionVersion".to_string(), "3".to_string());
        fields.insert("role".to_string(), "ADMIN".to_string());
        fields.insert("createdAt".to_string(), "1000".to_string());
        fields.insert("secondAt".to_string(), "2000".to_string());
        let record = parse_record(&fields).expect("解析应成功");
        assert_eq!(record.user_id, 7);
        assert_eq!(record.session_version, 3);
        assert_eq!(record.role, "ADMIN");
        assert_eq!(record.second_at, Some(2000));
    }

    #[test]
    fn rejects_missing_identity_fields() {
        let mut fields = HashMap::new();
        fields.insert("role".to_string(), "USER".to_string());
        assert!(parse_record(&fields).is_err());
    }
}
