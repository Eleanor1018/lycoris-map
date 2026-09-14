//! 显式基线接管（`--adopt-baseline`）与只读预检（`--check-baseline`）。
//!
//! 目标库已由 Java 版本（Hibernate）创建业务表、但没有 SQLx `_sqlx_migrations` 历史时，
//! 使用接管命令：先只读核对 6 张业务表的结构、约束、序列、PostGIS 与 schema，再在 SQLx
//! 迁移锁下登记**真实**基线校验和（不执行 `0001_baseline.sql` 的任何 DDL，不改业务行、
//! ID、序列值或结构）。只读预检不创建 `_sqlx_migrations`。
//!
//! 差异报告只包含对象名与属性；发布决策计数只输出组数/行数，不输出用户名、邮箱或坐标值。

mod adopt;
pub mod expected;
mod inspect;

pub use adopt::{DEFAULT_LOCK_TIMEOUT, adopt_baseline, adopt_baseline_with, check_baseline};
pub use expected::BASELINE_VERSION;
pub use inspect::{
    BaselineDiff, BaselineMismatch, BaselineReport, DataCounts, HistoryIssue, HistoryReport,
};

use tracing::{info, warn};

impl BaselineReport {
    /// 输出受控预检/接管摘要：只含结构差异对象名与计数，不含连接串或业务行值。
    pub fn log_summary(&self, title: &str) {
        if self.schema_ok {
            info!("{title}: 结构核对通过（6 张业务表 / 列 / 约束 / 序列 / PostGIS / schema）");
        } else {
            warn!("{title}: 结构核对发现 {} 项差异", self.diffs.len());
            for diff in self.diffs.iter().take(20) {
                warn!("{title}: 差异 {diff}");
            }
            if self.diffs.len() > 20 {
                warn!("{title}: 差异项过多，仅显示前 20 项");
            }
        }
        match &self.history {
            HistoryReport::Absent => {
                info!("{title}: 目标库尚无 _sqlx_migrations 迁移历史");
            }
            HistoryReport::Consistent { applied } => {
                info!("{title}: 迁移历史一致，已应用 {} 条", applied.len());
            }
            HistoryReport::Inconsistent { issue } => {
                warn!("{title}: 迁移历史异常：{issue}");
            }
        }
        let counts = self.counts;
        if self.counts_available {
            info!(
                "{title}: 发布决策计数（仅聚合，不输出身份值）重复用户名组 {}, 重复规范化邮箱组 {}, \
                 不合法坐标行 {}, 其中非有限 {}, NaN {}, Infinity {}",
                counts.duplicate_username_groups,
                counts.duplicate_normalized_email_groups,
                counts.invalid_coordinate_rows,
                counts.non_finite_coordinate_rows,
                counts.nan_coordinate_rows,
                counts.infinite_coordinate_rows,
            );
        } else {
            info!("{title}: 结构不兼容，未执行发布决策计数（报告中计数为占位 0，非测量结果）");
        }
    }
}
