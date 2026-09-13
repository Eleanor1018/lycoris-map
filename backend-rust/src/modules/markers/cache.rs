//! Redis 查询缓存：独立于 Java 的 Rust 命名空间，只缓存 ID 与缓存版本。
//!
//! 设计要点：
//! - 缓存值仅 `{"v":1,"ids":[...]}`，绝不缓存可见性结论或点位内容；
//! - 命中后仍回 PostgreSQL 重新校验 `is_public AND review_status='APPROVED'` 并读取最新内容，
//!   因此 Redis 故障、坏 JSON 或过期数据都不会被当作授权；
//! - 命名空间版本由 generation key 原子 `INCR` 维护，缓存 key 内嵌 generation；读取时
//!   每次读 generation，读取失败直接回源 PostgreSQL。generation 永不过期（每命名空间一个
//!   键），因此每次失效都会真正切换命名空间，不会回退复用旧代次；
//! - 不使用 `FLUSHALL` / `KEYS` 扫描，失效只通过 `INCR` 切换命名空间；旧 key 随自身短 TTL 过期。

use fred::clients::Client;
use fred::prelude::*;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::timeout;

/// `nearby` 缓存 TTL（秒）。
pub const NEARBY_TTL_SECONDS: u64 = 12;
/// `viewport` 缓存 TTL（秒）。
pub const VIEWPORT_TTL_SECONDS: u64 = 10;
/// 单条 Redis 命令的最长等待；超时按“不可用”处理，直接回源 PostgreSQL，
/// 不会排队到全局 HTTP 超时。写缓存失败也最多延迟这么长。
const REDIS_COMMAND_TIMEOUT: Duration = Duration::from_millis(500);

/// 缓存中仅保存的载荷。
#[derive(Debug, Serialize, Deserialize)]
struct CachedIds {
    v: u32,
    ids: Vec<i64>,
}

/// 查询缓存句柄；`enabled=false` 时所有操作退化为不缓存。
#[derive(Clone)]
pub struct MarkerCache {
    redis: Client,
    enabled: bool,
    namespace: String,
}

impl MarkerCache {
    pub fn new(redis: Client, enabled: bool, namespace: impl Into<String>) -> Self {
        Self {
            redis,
            enabled,
            namespace: namespace.into(),
        }
    }

    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    fn generation_key(&self) -> String {
        format!("{}:gen", self.namespace)
    }

    /// 当前命名空间版本。`None` 表示禁用或 Redis 不可用，调用方应直接回源。
    ///
    /// 缺失 generation key 时隐含版本 `0`；失效函数的 `INCR` 会把它提升为 `1`，
    /// 从而切换命名空间。
    pub async fn current_generation(&self) -> Option<i64> {
        if !self.enabled {
            return None;
        }
        match timeout(
            REDIS_COMMAND_TIMEOUT,
            self.redis.get::<Option<String>, _>(self.generation_key()),
        )
        .await
        {
            Ok(Ok(None)) => Some(0),
            Ok(Ok(Some(value))) => value.trim().parse::<i64>().ok(),
            _ => None,
        }
    }

    /// 读取缓存 ID 列表。miss / 坏 JSON / Redis 故障一律返回 `None`。
    pub async fn read_ids(&self, key: &str) -> Option<Vec<i64>> {
        if !self.enabled {
            return None;
        }
        let raw = timeout(
            REDIS_COMMAND_TIMEOUT,
            self.redis.get::<Option<String>, _>(key),
        )
        .await
        .ok()?
        .ok()??;
        serde_json::from_str::<CachedIds>(&raw)
            .ok()
            .filter(|cached| cached.v == 1)
            .map(|cached| cached.ids)
    }

    /// 写入缓存 ID 列表；写失败或超时不影响主流程。
    pub async fn write_ids(&self, key: &str, ids: &[i64], ttl_seconds: u64) {
        if !self.enabled {
            return;
        }
        let payload = match serde_json::to_string(&CachedIds {
            v: 1,
            ids: ids.to_vec(),
        }) {
            Ok(payload) => payload,
            Err(_) => return,
        };
        let _ = timeout(
            REDIS_COMMAND_TIMEOUT,
            self.redis.set::<(), _, _>(
                key,
                payload,
                Some(Expiration::EX(ttl_seconds as i64)),
                None,
                false,
            ),
        )
        .await;
    }

    /// 提交后失效（供阶段 3 写接口调用）：原子 `INCR` generation。缺失时从 `0` 提升为
    /// `1`，之后每次调用都继续递增，命名空间必然变化。禁用缓存时无需访问 Redis。
    pub async fn invalidate(&self) -> Result<i64, fred::error::Error> {
        if !self.enabled {
            return Ok(0);
        }
        self.redis.incr(self.generation_key()).await
    }

    /// `nearby` 缓存 key，包含全部影响结果的参数与 generation。
    ///
    /// 经纬度用 `f64::to_bits` 的固定宽度十六进制编码，精确保留请求值（可往返还原），
    /// 避免小数第 5 位等细微差异的请求共享缓存结果；不为迎合缓存而改动查询条件。
    pub fn nearby_key(
        &self,
        generation: i64,
        lat: f64,
        lng: f64,
        radius_meters: i32,
        category: &str,
    ) -> String {
        format!(
            "{}:nearby:v1:g{}:lat={:016x}|lng={:016x}|r={}|c={}",
            self.namespace,
            generation,
            lat.to_bits(),
            lng.to_bits(),
            radius_meters,
            category
        )
    }

    /// `viewport` 缓存 key，包含边界与已归一、排序、去重的类别集合；边界同样按
    /// `f64::to_bits` 精确编码。
    pub fn viewport_key(
        &self,
        generation: i64,
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
        category_part: &str,
    ) -> String {
        format!(
            "{}:viewport:v1:g{}:minLat={:016x}|maxLat={:016x}|minLng={:016x}|maxLng={:016x}|cat={}",
            self.namespace,
            generation,
            min_lat.to_bits(),
            max_lat.to_bits(),
            min_lng.to_bits(),
            max_lng.to_bits(),
            category_part
        )
    }
}
