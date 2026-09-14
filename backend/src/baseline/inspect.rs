//! 目标库系统目录核对：结构差异、发布决策计数、SQLx 历史只读读取。
//!
//! 只读取 `information_schema` / `pg_catalog`，不执行任何 DDL。差异项只包含对象名与
//! 属性（表、列、约束、序列、扩展、schema），不包含业务行值或连接串。

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use sqlx::Row as _;
use sqlx::migrate::Migrator;
use sqlx::postgres::PgConnection;

use crate::baseline::expected::{self, ColumnSpec, TableSpec};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BaselineDiff {
    MissingTable(String),
    UnexpectedRelationKind {
        table: String,
        kind: &'static str,
    },
    MissingColumn {
        table: String,
        column: String,
    },
    UnexpectedColumn {
        table: String,
        column: String,
    },
    ColumnMismatch {
        table: String,
        column: String,
        attr: &'static str,
        expected: String,
        actual: String,
    },
    ColumnGenerated {
        table: String,
        column: String,
        generated: &'static str,
    },
    MissingConstraint {
        table: String,
        name: String,
        kind: char,
    },
    UnexpectedConstraint {
        table: String,
        name: String,
        kind: char,
    },
    ConstraintMismatch {
        table: String,
        name: String,
        expected: String,
        actual: String,
    },
    ConstraintNotValidated {
        table: String,
        name: String,
    },
    ConstraintDeferrable {
        table: String,
        name: String,
    },
    IndexNotUsable {
        table: String,
        name: String,
    },
    MissingSequence(String),
    SequenceMismatch {
        name: String,
        attr: &'static str,
        expected: String,
        actual: String,
    },
    MissingExtension(String),
    SchemaNotPublic(String),
    HistoryTableMismatch,
}

fn constraint_kind(kind: char) -> &'static str {
    match kind {
        'p' => "主键",
        'u' => "唯一",
        'f' => "外键",
        _ => "未知",
    }
}

fn relation_kind_label(kind: char) -> &'static str {
    match kind {
        'r' => "普通表",
        'p' => "分区表",
        'v' => "视图",
        'm' => "物化视图",
        'f' => "外部表",
        'S' => "序列",
        _ => "非常规关系",
    }
}

impl fmt::Display for BaselineDiff {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BaselineDiff::MissingTable(t) => write!(f, "缺少表 {t}"),
            BaselineDiff::UnexpectedRelationKind { table, kind } => {
                write!(f, "{table} 不是普通表（{kind}）")
            }
            BaselineDiff::MissingColumn { table, column } => {
                write!(f, "{table}.{column} 列缺失")
            }
            BaselineDiff::UnexpectedColumn { table, column } => {
                write!(f, "{table}.{column} 为多余列")
            }
            BaselineDiff::ColumnMismatch {
                table,
                column,
                attr,
                expected,
                actual,
            } => write!(
                f,
                "{table}.{column} 的 {attr} 期望 {expected}，实际 {actual}"
            ),
            BaselineDiff::ColumnGenerated {
                table,
                column,
                generated,
            } => write!(f, "{table}.{column} 不应为生成列，实际 {generated}"),
            BaselineDiff::MissingConstraint { table, name, kind } => {
                write!(f, "{table} 缺少{}约束 {name}", constraint_kind(*kind))
            }
            BaselineDiff::UnexpectedConstraint { table, name, kind } => {
                write!(f, "{table} 存在多余{}约束 {name}", constraint_kind(*kind))
            }
            BaselineDiff::ConstraintMismatch {
                table,
                name,
                expected,
                actual,
            } => write!(f, "{table} 约束 {name} 期望 {expected}，实际 {actual}"),
            BaselineDiff::ConstraintNotValidated { table, name } => {
                write!(f, "{table} 约束 {name} 未验证（NOT VALID）")
            }
            BaselineDiff::ConstraintDeferrable { table, name } => {
                write!(f, "{table} 约束 {name} 为可延迟（DEFERRABLE）")
            }
            BaselineDiff::IndexNotUsable { table, name } => {
                write!(f, "{table} 约束 {name} 的索引缺失或不可用")
            }
            BaselineDiff::MissingSequence(name) => write!(f, "缺少序列 {name}"),
            BaselineDiff::SequenceMismatch {
                name,
                attr,
                expected,
                actual,
            } => write!(f, "序列 {name} 的 {attr} 期望 {expected}，实际 {actual}"),
            BaselineDiff::MissingExtension(name) => write!(f, "缺少扩展 {name}"),
            BaselineDiff::SchemaNotPublic(detail) => {
                write!(f, "schema/search_path 未明确 public：{detail}")
            }
            BaselineDiff::HistoryTableMismatch => {
                write!(f, "_sqlx_migrations 历史表格式与 SQLx 期望不一致")
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaselineMismatch {
    pub diffs: Vec<BaselineDiff>,
}

impl fmt::Display for BaselineMismatch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "基线结构不符合期望（{} 项）：", self.diffs.len())?;
        let shown = self.diffs.iter().take(20);
        for (index, diff) in shown.enumerate() {
            if index > 0 {
                write!(f, "；")?;
            }
            write!(f, "{diff}")?;
        }
        if self.diffs.len() > 20 {
            write!(f, "；…")?;
        }
        Ok(())
    }
}

impl std::error::Error for BaselineMismatch {}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DataCounts {
    pub duplicate_username_groups: i64,
    pub duplicate_normalized_email_groups: i64,
    pub invalid_coordinate_rows: i64,
    pub non_finite_coordinate_rows: i64,
    pub nan_coordinate_rows: i64,
    pub infinite_coordinate_rows: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryIssue {
    Failed(i64),
    UnknownApplied(i64),
    ChecksumMismatch(i64),
    TableFormat,
}

impl fmt::Display for HistoryIssue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HistoryIssue::Failed(v) => write!(f, "迁移 {v} 未成功完成"),
            HistoryIssue::UnknownApplied(v) => write!(f, "存在未知的已应用迁移 {v}"),
            HistoryIssue::ChecksumMismatch(v) => write!(f, "迁移 {v} 校验和不一致"),
            HistoryIssue::TableFormat => write!(f, "_sqlx_migrations 历史表格式异常"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HistoryReport {
    Absent,
    Consistent { applied: Vec<i64> },
    Inconsistent { issue: HistoryIssue },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaselineReport {
    pub schema_ok: bool,
    pub diffs: Vec<BaselineDiff>,
    pub history: HistoryReport,
    pub counts: DataCounts,
    /// 计数是否真正执行；结构不兼容时为 false，报告中的 0 不代表已测量。
    pub counts_available: bool,
}

impl BaselineReport {
    pub fn into_result(self) -> Result<Self, crate::migrate::MigrationError> {
        use crate::migrate::MigrationError;
        if !self.diffs.is_empty() {
            return Err(MigrationError::BaselineMismatch(BaselineMismatch {
                diffs: self.diffs,
            }));
        }
        match &self.history {
            HistoryReport::Inconsistent { issue } => Err(issue.to_migration_error()),
            _ => Ok(self),
        }
    }
}

impl HistoryIssue {
    pub fn to_migration_error(&self) -> crate::migrate::MigrationError {
        use crate::migrate::MigrationError;
        match self {
            HistoryIssue::Failed(v) => MigrationError::Failed(*v),
            HistoryIssue::UnknownApplied(v) => MigrationError::UnknownApplied(*v),
            HistoryIssue::ChecksumMismatch(v) => MigrationError::ChecksumMismatch(*v),
            HistoryIssue::TableFormat => MigrationError::HistoryTableMismatch,
        }
    }
}

struct ActualColumn {
    data_type: String,
    max_length: Option<i32>,
    nullable: bool,
    default: Option<String>,
    identity: bool,
    identity_generation: Option<String>,
    datetime_precision: Option<i32>,
    generated: Option<&'static str>,
}

pub async fn inspect_schema(conn: &mut PgConnection) -> Result<Vec<BaselineDiff>, sqlx::Error> {
    let mut diffs = Vec::new();

    let table_names: Vec<String> = expected::BASELINE_TABLES
        .iter()
        .map(|s| s.to_string())
        .collect();

    let relations = load_relations(conn, &table_names).await?;
    let mut columns = load_columns(conn, &table_names).await?;
    mark_generated_columns(conn, &table_names, &mut columns).await?;
    let constraints = load_constraints(conn, &table_names).await?;
    for table in expected::TABLES {
        match relations.get(table.name) {
            None => {
                diffs.push(BaselineDiff::MissingTable(table.name.to_string()));
                continue;
            }
            Some(kind) if *kind != 'r' => {
                diffs.push(BaselineDiff::UnexpectedRelationKind {
                    table: table.name.to_string(),
                    kind: relation_kind_label(*kind),
                });
                continue;
            }
            Some(_) => {}
        }
        compare_columns(table, columns.get(table.name), &mut diffs);
        compare_constraints(table, &constraints, &mut diffs);
    }

    compare_indexes(conn, &table_names, &mut diffs).await?;
    compare_sequences(conn, &mut diffs).await?;
    compare_extension_and_schema(conn, &mut diffs).await?;
    if history_shape_bad(conn).await? {
        diffs.push(BaselineDiff::HistoryTableMismatch);
    }
    Ok(diffs)
}

async fn load_relations(
    conn: &mut PgConnection,
    tables: &[String],
) -> Result<BTreeMap<String, char>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT c.relname AS name, c.relkind::text AS kind \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = 'public' AND c.relname = ANY($1)",
    )
    .bind(tables)
    .fetch_all(&mut *conn)
    .await?;
    let mut out = BTreeMap::new();
    for row in rows {
        let name: String = row.try_get("name")?;
        let kind: String = row.try_get("kind")?;
        out.insert(name, kind.chars().next().unwrap_or('?'));
    }
    Ok(out)
}

/// 六个业务对象的“存在且为普通表”预检：缺表或视图/分区表/外部表都返回明确差异。
/// 供接管在加业务表锁之前调用；不执行任何 DDL。
pub async fn relation_shape_diffs(
    conn: &mut PgConnection,
) -> Result<Vec<BaselineDiff>, sqlx::Error> {
    let table_names: Vec<String> = expected::BASELINE_TABLES
        .iter()
        .map(|s| s.to_string())
        .collect();
    let relations = load_relations(conn, &table_names).await?;
    let mut diffs = Vec::new();
    for table in expected::TABLES {
        match relations.get(table.name) {
            None => diffs.push(BaselineDiff::MissingTable(table.name.to_string())),
            Some(kind) if *kind != 'r' => diffs.push(BaselineDiff::UnexpectedRelationKind {
                table: table.name.to_string(),
                kind: relation_kind_label(*kind),
            }),
            Some(_) => {}
        }
    }
    Ok(diffs)
}

async fn load_columns(
    conn: &mut PgConnection,
    tables: &[String],
) -> Result<BTreeMap<String, BTreeMap<String, ActualColumn>>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, \
                column_default, is_identity, identity_generation, datetime_precision \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = ANY($1)",
    )
    .bind(tables)
    .fetch_all(&mut *conn)
    .await?;

    let mut out: BTreeMap<String, BTreeMap<String, ActualColumn>> = BTreeMap::new();
    for row in rows {
        let table: String = row.try_get("table_name")?;
        let name: String = row.try_get("column_name")?;
        let column = ActualColumn {
            data_type: row.try_get("data_type")?,
            max_length: row.try_get("character_maximum_length")?,
            nullable: row.try_get::<String, _>("is_nullable")? == "YES",
            default: row.try_get("column_default")?,
            identity: row.try_get::<String, _>("is_identity")? == "YES",
            identity_generation: row.try_get("identity_generation")?,
            datetime_precision: row.try_get("datetime_precision")?,
            generated: None,
        };
        out.entry(table).or_default().insert(name, column);
    }
    Ok(out)
}

async fn mark_generated_columns(
    conn: &mut PgConnection,
    tables: &[String],
    columns: &mut BTreeMap<String, BTreeMap<String, ActualColumn>>,
) -> Result<(), sqlx::Error> {
    let rows = sqlx::query(
        "SELECT c.relname AS table_name, a.attname AS column_name, a.attgenerated::text AS generated \
         FROM pg_attribute a \
         JOIN pg_class c ON c.oid = a.attrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = 'public' AND c.relname = ANY($1) \
           AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated <> ''",
    )
    .bind(tables)
    .fetch_all(&mut *conn)
    .await?;
    for row in rows {
        let table: String = row.try_get("table_name")?;
        let column: String = row.try_get("column_name")?;
        let generated: String = row.try_get("generated")?;
        let label = match generated.as_str() {
            "s" => "STORED",
            "v" => "VIRTUAL",
            _ => "GENERATED",
        };
        if let Some(found) = columns.get_mut(&table).and_then(|map| map.get_mut(&column)) {
            found.generated = Some(label);
        }
    }
    Ok(())
}

fn compare_columns(
    table: &TableSpec,
    actual: Option<&BTreeMap<String, ActualColumn>>,
    diffs: &mut Vec<BaselineDiff>,
) {
    let Some(actual) = actual else {
        return;
    };
    let expected_names: BTreeSet<&str> = table.columns.iter().map(|c| c.name).collect();
    for name in actual.keys() {
        if !expected_names.contains(name.as_str()) {
            diffs.push(BaselineDiff::UnexpectedColumn {
                table: table.name.to_string(),
                column: name.clone(),
            });
        }
    }
    for spec in table.columns {
        let Some(column) = actual.get(spec.name) else {
            diffs.push(BaselineDiff::MissingColumn {
                table: table.name.to_string(),
                column: spec.name.to_string(),
            });
            continue;
        };
        compare_column(table.name, spec, column, diffs);
    }
}

fn compare_column(
    table: &str,
    spec: &ColumnSpec,
    actual: &ActualColumn,
    diffs: &mut Vec<BaselineDiff>,
) {
    if let Some(generated) = actual.generated {
        diffs.push(BaselineDiff::ColumnGenerated {
            table: table.to_string(),
            column: spec.name.to_string(),
            generated,
        });
    }
    let mut push = |attr: &'static str, expected: String, actual: String| {
        diffs.push(BaselineDiff::ColumnMismatch {
            table: table.to_string(),
            column: spec.name.to_string(),
            attr,
            expected,
            actual,
        });
    };
    if actual.data_type != spec.data_type {
        push("类型", spec.data_type.to_string(), actual.data_type.clone());
    }
    if actual.max_length != spec.max_length {
        push(
            "长度",
            opt_display(spec.max_length),
            opt_display(actual.max_length),
        );
    }
    if actual.nullable != spec.nullable {
        push(
            "可空",
            bool_display(spec.nullable),
            bool_display(actual.nullable),
        );
    }
    if actual.default.as_deref() != spec.default {
        push(
            "默认值",
            spec.default.unwrap_or("<无>").to_string(),
            actual.default.clone().unwrap_or_else(|| "<无>".to_string()),
        );
    }
    if actual.identity != spec.identity {
        push(
            "identity",
            bool_display(spec.identity),
            bool_display(actual.identity),
        );
    }
    if spec.identity && actual.identity_generation.as_deref() != Some("BY DEFAULT") {
        push(
            "identity 生成方式",
            "BY DEFAULT".to_string(),
            actual
                .identity_generation
                .clone()
                .unwrap_or_else(|| "<无>".to_string()),
        );
    }
    if actual.datetime_precision != spec.datetime_precision {
        push(
            "时间精度",
            opt_display(spec.datetime_precision),
            opt_display(actual.datetime_precision),
        );
    }
}

fn opt_display(value: Option<i32>) -> String {
    value.map_or_else(|| "<无>".to_string(), |v| v.to_string())
}

fn bool_display(value: bool) -> String {
    if value {
        "是".to_string()
    } else {
        "否".to_string()
    }
}

struct ActualConstraint {
    kind: char,
    def: String,
    validated: bool,
    deferrable: bool,
    deferred: bool,
}

async fn load_constraints(
    conn: &mut PgConnection,
    tables: &[String],
) -> Result<BTreeMap<(String, String), ActualConstraint>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT t.relname AS table_name, c.conname, c.contype::text AS contype, \
                pg_get_constraintdef(c.oid) AS def, c.convalidated, c.condeferrable, c.condeferred \
         FROM pg_constraint c \
         JOIN pg_class t ON t.oid = c.conrelid \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         WHERE n.nspname = 'public' AND c.contype IN ('p', 'u', 'f') AND t.relname = ANY($1)",
    )
    .bind(tables)
    .fetch_all(&mut *conn)
    .await?;

    let mut out = BTreeMap::new();
    for row in rows {
        let table: String = row.try_get("table_name")?;
        let name: String = row.try_get("conname")?;
        let kind: String = row.try_get("contype")?;
        let def: String = row.try_get("def")?;
        out.insert(
            (table, name),
            ActualConstraint {
                kind: kind.chars().next().unwrap_or('?'),
                def: normalize_definition(&def),
                validated: row.try_get("convalidated")?,
                deferrable: row.try_get("condeferrable")?,
                deferred: row.try_get("condeferred")?,
            },
        );
    }
    Ok(out)
}

fn compare_constraints(
    table: &TableSpec,
    actual: &BTreeMap<(String, String), ActualConstraint>,
    diffs: &mut Vec<BaselineDiff>,
) {
    let mut expected: BTreeMap<String, (char, String)> = BTreeMap::new();
    let pk_name = format!("{}_pkey", table.name);
    expected.insert(
        pk_name,
        (
            'p',
            format!("PRIMARY KEY ({})", join_columns(table.primary_key)),
        ),
    );
    for (name, columns) in table.uniques {
        expected.insert(
            (*name).to_string(),
            ('u', format!("UNIQUE ({})", join_columns(columns))),
        );
    }
    for fk in table.foreign_keys {
        let mut def = format!(
            "FOREIGN KEY ({}) REFERENCES {}({})",
            join_columns(fk.columns),
            fk.ref_table,
            join_columns(fk.ref_columns)
        );
        if fk.on_delete_cascade {
            def.push_str(" ON DELETE CASCADE");
        }
        expected.insert(fk.name.to_string(), ('f', def));
    }

    for (name, (kind, def)) in &expected {
        match actual.get(&(table.name.to_string(), name.clone())) {
            None => diffs.push(BaselineDiff::MissingConstraint {
                table: table.name.to_string(),
                name: name.clone(),
                kind: *kind,
            }),
            Some(found) => {
                if found.kind != *kind || found.def != *def {
                    diffs.push(BaselineDiff::ConstraintMismatch {
                        table: table.name.to_string(),
                        name: name.clone(),
                        expected: def.clone(),
                        actual: format!("({}) {}", constraint_kind(found.kind), found.def),
                    });
                }
                if !found.validated {
                    diffs.push(BaselineDiff::ConstraintNotValidated {
                        table: table.name.to_string(),
                        name: name.clone(),
                    });
                }
                if found.deferrable || found.deferred {
                    diffs.push(BaselineDiff::ConstraintDeferrable {
                        table: table.name.to_string(),
                        name: name.clone(),
                    });
                }
            }
        }
    }

    for ((table_name, name), found) in actual {
        if table_name == table.name && !expected.contains_key(name) {
            diffs.push(BaselineDiff::UnexpectedConstraint {
                table: table_name.clone(),
                name: name.clone(),
                kind: found.kind,
            });
        }
    }
}

fn join_columns(columns: &[&str]) -> String {
    columns.join(", ")
}

fn normalize_definition(def: &str) -> String {
    def.replace("public.", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

async fn compare_indexes(
    conn: &mut PgConnection,
    tables: &[String],
    diffs: &mut Vec<BaselineDiff>,
) -> Result<(), sqlx::Error> {
    let rows = sqlx::query(
        "SELECT t.relname AS table_name, c.conname, i.indisvalid, i.indisready, i.indisunique \
         FROM pg_constraint c \
         JOIN pg_class t ON t.oid = c.conrelid \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         JOIN pg_index i ON i.indexrelid = c.conindid \
         WHERE n.nspname = 'public' AND c.contype IN ('p', 'u') AND t.relname = ANY($1)",
    )
    .bind(tables)
    .fetch_all(&mut *conn)
    .await?;

    let mut usable: BTreeSet<(String, String)> = BTreeSet::new();
    for row in rows {
        let table: String = row.try_get("table_name")?;
        let name: String = row.try_get("conname")?;
        let valid: bool = row.try_get("indisvalid")?;
        let ready: bool = row.try_get("indisready")?;
        let unique: bool = row.try_get("indisunique")?;
        if valid && ready && unique {
            usable.insert((table, name));
        }
    }

    for table in expected::TABLES {
        let mut names: Vec<String> = vec![format!("{}_pkey", table.name)];
        names.extend(table.uniques.iter().map(|(name, _)| (*name).to_string()));
        for name in names {
            if !usable.contains(&(table.name.to_string(), name.clone())) {
                diffs.push(BaselineDiff::IndexNotUsable {
                    table: table.name.to_string(),
                    name,
                });
            }
        }
    }
    Ok(())
}

struct ActualSequence {
    data_type: String,
    start: i64,
    min: i64,
    max: i64,
    increment: i64,
    cache: i64,
    cycle: bool,
    owned_table: Option<String>,
    owned_column: Option<String>,
}

async fn compare_sequences(
    conn: &mut PgConnection,
    diffs: &mut Vec<BaselineDiff>,
) -> Result<(), sqlx::Error> {
    let names: Vec<String> = expected::TABLES
        .iter()
        .map(|t| t.sequence.name.to_string())
        .collect();
    let rows = sqlx::query(
        "SELECT c.relname AS seq, s.seqtypid::regtype::text AS seq_type, s.seqstart, s.seqmin, \
                s.seqmax, s.seqincrement, s.seqcache, s.seqcycle \
         FROM pg_class c JOIN pg_sequence s ON s.seqrelid = c.oid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = 'public' AND c.relname = ANY($1)",
    )
    .bind(&names)
    .fetch_all(&mut *conn)
    .await?;
    let mut sequences: BTreeMap<String, ActualSequence> = BTreeMap::new();
    for row in rows {
        let name: String = row.try_get("seq")?;
        sequences.insert(
            name,
            ActualSequence {
                data_type: row.try_get("seq_type")?,
                start: row.try_get("seqstart")?,
                min: row.try_get("seqmin")?,
                max: row.try_get("seqmax")?,
                increment: row.try_get("seqincrement")?,
                cache: row.try_get("seqcache")?,
                cycle: row.try_get("seqcycle")?,
                owned_table: None,
                owned_column: None,
            },
        );
    }

    let owner_rows = sqlx::query(
        "SELECT c.relname AS seq, t.relname AS owned_table, a.attname AS owned_column \
         FROM pg_class c \
         JOIN pg_depend d ON d.objid = c.oid AND d.classid = 'pg_class'::regclass \
              AND d.refclassid = 'pg_class'::regclass AND d.deptype = 'i' \
         JOIN pg_class t ON t.oid = d.refobjid \
         JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid \
         WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)",
    )
    .bind(&names)
    .fetch_all(&mut *conn)
    .await?;
    for row in owner_rows {
        let name: String = row.try_get("seq")?;
        if let Some(seq) = sequences.get_mut(&name) {
            seq.owned_table = Some(row.try_get("owned_table")?);
            seq.owned_column = Some(row.try_get("owned_column")?);
        }
    }

    for table in expected::TABLES {
        let spec = &table.sequence;
        let Some(found) = sequences.get(spec.name) else {
            diffs.push(BaselineDiff::MissingSequence(spec.name.to_string()));
            continue;
        };
        let mut push = |attr: &'static str, expected: String, actual: String| {
            diffs.push(BaselineDiff::SequenceMismatch {
                name: spec.name.to_string(),
                attr,
                expected,
                actual,
            });
        };
        if found.data_type != spec.data_type {
            push("类型", spec.data_type.to_string(), found.data_type.clone());
        }
        if found.start != spec.start {
            push("起始值", spec.start.to_string(), found.start.to_string());
        }
        if found.min != spec.min {
            push("最小值", spec.min.to_string(), found.min.to_string());
        }
        if found.max != spec.max {
            push("最大值", spec.max.to_string(), found.max.to_string());
        }
        if found.increment != spec.increment {
            push(
                "步长",
                spec.increment.to_string(),
                found.increment.to_string(),
            );
        }
        if found.cache != spec.cache {
            push("缓存", spec.cache.to_string(), found.cache.to_string());
        }
        if found.cycle {
            push("循环", "否".to_string(), "是".to_string());
        }
        if found.owned_table.as_deref() != Some(spec.owned_table)
            || found.owned_column.as_deref() != Some(spec.owned_column)
        {
            push(
                "归属",
                format!("{}.{}", spec.owned_table, spec.owned_column),
                format!(
                    "{}.{}",
                    found.owned_table.as_deref().unwrap_or("<无>"),
                    found.owned_column.as_deref().unwrap_or("<无>")
                ),
            );
        }
    }
    Ok(())
}

async fn compare_extension_and_schema(
    conn: &mut PgConnection,
    diffs: &mut Vec<BaselineDiff>,
) -> Result<(), sqlx::Error> {
    let postgis: i64 =
        sqlx::query_scalar("SELECT count(*) FROM pg_extension WHERE extname = 'postgis'")
            .fetch_one(&mut *conn)
            .await?;
    if postgis == 0 {
        diffs.push(BaselineDiff::MissingExtension("postgis".to_string()));
    }

    let row = sqlx::query(
        "SELECT current_schema() AS schema, current_setting('search_path') AS search_path",
    )
    .fetch_one(&mut *conn)
    .await?;
    let schema: Option<String> = row.try_get("schema")?;
    let search_path: String = row.try_get("search_path")?;
    let has_public = search_path
        .split(',')
        .map(|part| part.trim().trim_matches('"').to_ascii_lowercase())
        .any(|part| part == "public");
    if schema.as_deref() != Some("public") || !has_public {
        diffs.push(BaselineDiff::SchemaNotPublic(format!(
            "current_schema={}, search_path={search_path}",
            schema.as_deref().unwrap_or("<无>")
        )));
    }
    Ok(())
}

async fn history_column_types(
    conn: &mut PgConnection,
) -> Result<Vec<(String, String)>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT column_name, data_type FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = '_sqlx_migrations'",
    )
    .fetch_all(&mut *conn)
    .await?;
    rows.into_iter()
        .map(|row| Ok((row.try_get("column_name")?, row.try_get("data_type")?)))
        .collect()
}

async fn history_shape_bad(conn: &mut PgConnection) -> Result<bool, sqlx::Error> {
    let present: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations')::text")
            .fetch_one(&mut *conn)
            .await?;
    if present.is_none() {
        return Ok(false);
    }
    let columns = history_column_types(conn).await?;
    let actual: BTreeMap<String, String> = columns.into_iter().collect();
    let expected: BTreeMap<String, String> = expected::SQLX_HISTORY_COLUMNS
        .iter()
        .map(|(name, ty)| ((*name).to_string(), (*ty).to_string()))
        .collect();
    Ok(actual != expected)
}

/// 聚合发布决策计数。返回 `(计数, 是否真正执行)`：只有当 `users`/`map_markers` 都是普通表且
/// 计数所需列类型兼容时才执行；否则返回 `(默认零, false)`，避免在不兼容结构上执行 SQL 报错并
/// 抹去可读的结构报告（未执行的 0 不当作真实测量）。
pub async fn inspect_data(conn: &mut PgConnection) -> Result<(DataCounts, bool), sqlx::Error> {
    let ready: i64 = sqlx::query_scalar(
        "SELECT (
           (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
              JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped \
             WHERE n.nspname = 'public' AND c.relname = 'users' AND c.relkind = 'r' \
               AND a.attname IN ('username', 'email') \
               AND format_type(a.atttypid, NULL) IN ('character varying', 'text', 'bpchar')) \
         + (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
              JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped \
             WHERE n.nspname = 'public' AND c.relname = 'map_markers' AND c.relkind = 'r' \
               AND a.attname IN ('lat', 'lng') \
               AND format_type(a.atttypid, NULL) = 'double precision')
         )",
    )
    .fetch_one(&mut *conn)
    .await?;
    if ready < 4 {
        return Ok((DataCounts::default(), false));
    }

    let row = sqlx::query(
        "SELECT \
         (SELECT count(*) FROM (SELECT username FROM users \
            WHERE username IS NOT NULL AND btrim(username) <> '' \
            GROUP BY username HAVING count(*) > 1) AS du) AS duplicate_username_groups, \
         (SELECT count(*) FROM (SELECT lower(btrim(email)) FROM users \
            WHERE email IS NOT NULL AND btrim(email) <> '' \
            GROUP BY lower(btrim(email)) HAVING count(*) > 1) AS de) AS duplicate_email_groups, \
         (SELECT count(*) FROM map_markers WHERE (lat = 'NaN'::float8 OR lng = 'NaN'::float8) \
            OR (lat IN ('Infinity'::float8, '-Infinity'::float8) \
                OR lng IN ('Infinity'::float8, '-Infinity'::float8)) \
            OR NOT (lat BETWEEN -90 AND 90) OR NOT (lng BETWEEN -180 AND 180)) AS invalid_rows, \
         (SELECT count(*) FROM map_markers WHERE (lat = 'NaN'::float8 OR lng = 'NaN'::float8) \
            OR (lat IN ('Infinity'::float8, '-Infinity'::float8) \
                OR lng IN ('Infinity'::float8, '-Infinity'::float8))) AS non_finite_rows, \
         (SELECT count(*) FROM map_markers WHERE lat = 'NaN'::float8 OR lng = 'NaN'::float8) \
            AS nan_rows, \
         (SELECT count(*) FROM map_markers WHERE lat IN ('Infinity'::float8, '-Infinity'::float8) \
            OR lng IN ('Infinity'::float8, '-Infinity'::float8)) AS infinite_rows",
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok((
        DataCounts {
            duplicate_username_groups: row.try_get("duplicate_username_groups")?,
            duplicate_normalized_email_groups: row.try_get("duplicate_email_groups")?,
            invalid_coordinate_rows: row.try_get("invalid_rows")?,
            non_finite_coordinate_rows: row.try_get("non_finite_rows")?,
            nan_coordinate_rows: row.try_get("nan_rows")?,
            infinite_coordinate_rows: row.try_get("infinite_rows")?,
        },
        true,
    ))
}

pub async fn read_history(
    conn: &mut PgConnection,
    migrator: &Migrator,
) -> Result<HistoryReport, sqlx::Error> {
    let present: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations')::text")
            .fetch_one(&mut *conn)
            .await?;
    if present.is_none() {
        return Ok(HistoryReport::Absent);
    }
    if history_shape_bad(conn).await? {
        return Ok(HistoryReport::Inconsistent {
            issue: HistoryIssue::TableFormat,
        });
    }

    let rows =
        sqlx::query("SELECT version, success, checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&mut *conn)
            .await?;
    let mut entries: Vec<(i64, bool, Vec<u8>)> = Vec::with_capacity(rows.len());
    for row in rows {
        entries.push((
            row.try_get("version")?,
            row.try_get("success")?,
            row.try_get("checksum")?,
        ));
    }
    for (version, success, _) in &entries {
        if !success {
            return Ok(HistoryReport::Inconsistent {
                issue: HistoryIssue::Failed(*version),
            });
        }
    }
    let applied: Vec<(i64, Vec<u8>)> = entries.iter().map(|(v, _, c)| (*v, c.clone())).collect();
    match validate_applied(&applied, migrator) {
        Ok(()) => Ok(HistoryReport::Consistent {
            applied: applied.iter().map(|(v, _)| *v).collect(),
        }),
        Err(issue) => Ok(HistoryReport::Inconsistent { issue }),
    }
}

pub fn validate_applied(
    applied: &[(i64, Vec<u8>)],
    migrator: &Migrator,
) -> Result<(), HistoryIssue> {
    for (version, _) in applied {
        if !migrator.version_exists(*version) {
            return Err(HistoryIssue::UnknownApplied(*version));
        }
    }
    for migration in migrator.iter() {
        if let Some((_, checksum)) = applied.iter().find(|(v, _)| *v == migration.version)
            && checksum.as_slice() != migration.checksum.as_ref()
        {
            return Err(HistoryIssue::ChecksumMismatch(migration.version));
        }
    }
    Ok(())
}
