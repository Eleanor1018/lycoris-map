//! 已审查基线（`migrations/0001_baseline.sql`）的结构期望。
//!
//! 这里是代码定义的期望清单，逐项对应基线 DDL；`tests/baseline_adoption.rs` 在由基线
//! 迁移出来的空库上核对本清单，保证期望不会与已审查基线漂移。检查目标库时只读取
//! 系统目录，**不会**在目标库执行基线 DDL 来比较。

/// 被接管的基线迁移版本号。
pub const BASELINE_VERSION: i64 = 1;

/// 6 张业务表名（与基线一致）。
pub const BASELINE_TABLES: [&str; 6] = [
    "map_markers",
    "map_marker_translations",
    "marker_edit_proposals",
    "marker_favorites",
    "marker_image_proposals",
    "users",
];

/// 接管加锁的固定顺序（按名称排序），所有接管者一致以避免死锁。
pub const TABLE_LOCK_ORDER: [&str; 6] = [
    "map_marker_translations",
    "map_markers",
    "marker_edit_proposals",
    "marker_favorites",
    "marker_image_proposals",
    "users",
];

#[derive(Clone, Copy)]
pub struct ColumnSpec {
    pub name: &'static str,
    pub data_type: &'static str,
    pub max_length: Option<i32>,
    pub nullable: bool,
    pub default: Option<&'static str>,
    pub identity: bool,
    pub datetime_precision: Option<i32>,
}

#[derive(Clone, Copy)]
pub struct FkSpec {
    pub name: &'static str,
    pub columns: &'static [&'static str],
    pub ref_table: &'static str,
    pub ref_columns: &'static [&'static str],
    pub on_delete_cascade: bool,
}

#[derive(Clone, Copy)]
pub struct SeqSpec {
    pub name: &'static str,
    pub data_type: &'static str,
    pub start: i64,
    pub min: i64,
    pub max: i64,
    pub increment: i64,
    pub cache: i64,
    pub owned_table: &'static str,
    pub owned_column: &'static str,
}

#[derive(Clone, Copy)]
pub struct TableSpec {
    pub name: &'static str,
    pub columns: &'static [ColumnSpec],
    pub primary_key: &'static [&'static str],
    pub uniques: &'static [(&'static str, &'static [&'static str])],
    pub foreign_keys: &'static [FkSpec],
    pub sequence: SeqSpec,
}

const BIGINT_MAX: i64 = i64::MAX;
const INTEGER_MAX: i64 = i32::MAX as i64;

const fn varchar(name: &'static str, len: i32, nullable: bool) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "character varying",
        max_length: Some(len),
        nullable,
        default: None,
        identity: false,
        datetime_precision: None,
    }
}

const fn varchar_default(name: &'static str, len: i32, default: &'static str) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "character varying",
        max_length: Some(len),
        nullable: false,
        default: Some(default),
        identity: false,
        datetime_precision: None,
    }
}

const fn text(name: &'static str, nullable: bool) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "text",
        max_length: None,
        nullable,
        default: None,
        identity: false,
        datetime_precision: None,
    }
}

const fn bigint(name: &'static str, nullable: bool) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "bigint",
        max_length: None,
        nullable,
        default: None,
        identity: false,
        datetime_precision: None,
    }
}

const fn bigint_default(name: &'static str, default: &'static str) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "bigint",
        max_length: None,
        nullable: false,
        default: Some(default),
        identity: false,
        datetime_precision: None,
    }
}

const fn double(name: &'static str, nullable: bool) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "double precision",
        max_length: None,
        nullable,
        default: None,
        identity: false,
        datetime_precision: None,
    }
}

const fn boolean(name: &'static str, nullable: bool) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "boolean",
        max_length: None,
        nullable,
        default: None,
        identity: false,
        datetime_precision: None,
    }
}

const fn boolean_default(name: &'static str, default: &'static str) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "boolean",
        max_length: None,
        nullable: false,
        default: Some(default),
        identity: false,
        datetime_precision: None,
    }
}

const fn uuid(name: &'static str) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "uuid",
        max_length: None,
        nullable: false,
        default: None,
        identity: false,
        datetime_precision: None,
    }
}

const fn timestamptz(name: &'static str, nullable: bool) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "timestamp with time zone",
        max_length: None,
        nullable,
        default: None,
        identity: false,
        datetime_precision: Some(6),
    }
}

const fn timestamptz_default(name: &'static str, default: &'static str) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "timestamp with time zone",
        max_length: None,
        nullable: false,
        default: Some(default),
        identity: false,
        datetime_precision: Some(6),
    }
}

const fn identity_bigint(name: &'static str) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "bigint",
        max_length: None,
        nullable: false,
        default: None,
        identity: true,
        datetime_precision: None,
    }
}

const fn identity_integer(name: &'static str) -> ColumnSpec {
    ColumnSpec {
        name,
        data_type: "integer",
        max_length: None,
        nullable: false,
        default: None,
        identity: true,
        datetime_precision: None,
    }
}

static MAP_MARKERS_COLUMNS: &[ColumnSpec] = &[
    identity_bigint("id"),
    varchar("category", 64, false),
    timestamptz("created_at", false),
    text("description", true),
    boolean("is_active", false),
    boolean("is_public", false),
    varchar("last_edited_by", 64, true),
    boolean("last_edited_by_owner", false),
    varchar("last_edited_by_public_id", 64, true),
    double("lat", false),
    double("lng", false),
    varchar("mark_image", 512, true),
    varchar("open_time_end", 5, true),
    varchar("open_time_start", 5, true),
    varchar("review_status", 16, false),
    varchar("title", 120, false),
    timestamptz("updated_at", false),
    varchar("user_public_id", 64, true),
    varchar("username", 64, false),
    varchar("client_request_id", 64, true),
    bigint_default("version", "0"),
    varchar_default("source_language", 2, "'zh'::character varying"),
];

static MAP_MARKER_TRANSLATIONS_COLUMNS: &[ColumnSpec] = &[
    identity_bigint("id"),
    bigint("marker_id", false),
    varchar("language", 2, false),
    varchar("title", 120, false),
    text("description", true),
    varchar("source_hash", 64, false),
    varchar_default("origin", 16, "'MACHINE'::character varying"),
    timestamptz_default("updated_at", "now()"),
];

static MARKER_EDIT_PROPOSALS_COLUMNS: &[ColumnSpec] = &[
    identity_bigint("id"),
    varchar("category", 64, false),
    timestamptz("created_at", false),
    text("description", true),
    boolean("is_active", false),
    boolean("is_public", false),
    bigint("marker_id", false),
    double("marker_lat", false),
    double("marker_lng", false),
    varchar("marker_title", 120, false),
    varchar("open_time_end", 5, true),
    varchar("open_time_start", 5, true),
    boolean("proposer_is_owner", false),
    varchar("proposer_public_id", 64, true),
    varchar("proposer_username", 64, false),
    timestamptz("reviewed_at", true),
    varchar("reviewed_by", 64, true),
    varchar("status", 16, false),
    varchar("title", 120, false),
    bigint_default("version", "0"),
    bigint("base_marker_version", true),
    varchar_default("language", 2, "'zh'::character varying"),
];

static MARKER_FAVORITES_COLUMNS: &[ColumnSpec] = &[
    identity_bigint("id"),
    timestamptz("created_at", false),
    bigint("marker_id", false),
    varchar("user_public_id", 64, false),
];

static MARKER_IMAGE_PROPOSALS_COLUMNS: &[ColumnSpec] = &[
    identity_bigint("id"),
    timestamptz("created_at", false),
    varchar("image_url", 512, false),
    bigint("marker_id", false),
    varchar("marker_title", 120, false),
    varchar("proposer_public_id", 64, true),
    varchar("proposer_username", 64, false),
    timestamptz("reviewed_at", true),
    varchar("reviewed_by", 64, true),
    varchar("status", 16, false),
];

static USERS_COLUMNS: &[ColumnSpec] = &[
    identity_integer("id"),
    varchar("avatar_url", 255, true),
    varchar("email", 255, true),
    varchar("nickname", 255, true),
    varchar("password", 255, true),
    varchar("pronouns", 64, true),
    uuid("public_id"),
    varchar("role", 32, false),
    varchar("signature", 200, true),
    varchar("username", 255, true),
    boolean_default("deleted", "false"),
    timestamptz("deleted_at", true),
    bigint_default("session_version", "0"),
    bigint_default("row_version", "0"),
];

static MAP_MARKER_TRANSLATIONS_FK: &[FkSpec] = &[FkSpec {
    name: "map_marker_translations_marker_id_fkey",
    columns: &["marker_id"],
    ref_table: "map_markers",
    ref_columns: &["id"],
    on_delete_cascade: true,
}];

static NO_FKS: &[FkSpec] = &[];

static MAP_MARKERS_UNIQUES: &[(&str, &[&str])] = &[(
    "uk_map_markers_user_client_request",
    &["user_public_id", "client_request_id"],
)];
static MAP_MARKER_TRANSLATIONS_UNIQUES: &[(&str, &[&str])] = &[(
    "uk_map_marker_translation_language",
    &["marker_id", "language"],
)];
static MARKER_FAVORITES_UNIQUES: &[(&str, &[&str])] = &[(
    "uq_marker_fav_user_marker",
    &["user_public_id", "marker_id"],
)];
static USERS_UNIQUES: &[(&str, &[&str])] = &[("uks24bux761rbgowsl7a4b386ba", &["public_id"])];
static NO_UNIQUES: &[(&str, &[&str])] = &[];

pub static TABLES: &[TableSpec] = &[
    TableSpec {
        name: "map_markers",
        columns: MAP_MARKERS_COLUMNS,
        primary_key: &["id"],
        uniques: MAP_MARKERS_UNIQUES,
        foreign_keys: NO_FKS,
        sequence: SeqSpec {
            name: "map_markers_id_seq",
            data_type: "bigint",
            start: 1,
            min: 1,
            max: BIGINT_MAX,
            increment: 1,
            cache: 1,
            owned_table: "map_markers",
            owned_column: "id",
        },
    },
    TableSpec {
        name: "map_marker_translations",
        columns: MAP_MARKER_TRANSLATIONS_COLUMNS,
        primary_key: &["id"],
        uniques: MAP_MARKER_TRANSLATIONS_UNIQUES,
        foreign_keys: MAP_MARKER_TRANSLATIONS_FK,
        sequence: SeqSpec {
            name: "map_marker_translations_id_seq",
            data_type: "bigint",
            start: 1,
            min: 1,
            max: BIGINT_MAX,
            increment: 1,
            cache: 1,
            owned_table: "map_marker_translations",
            owned_column: "id",
        },
    },
    TableSpec {
        name: "marker_edit_proposals",
        columns: MARKER_EDIT_PROPOSALS_COLUMNS,
        primary_key: &["id"],
        uniques: NO_UNIQUES,
        foreign_keys: NO_FKS,
        sequence: SeqSpec {
            name: "marker_edit_proposals_id_seq",
            data_type: "bigint",
            start: 1,
            min: 1,
            max: BIGINT_MAX,
            increment: 1,
            cache: 1,
            owned_table: "marker_edit_proposals",
            owned_column: "id",
        },
    },
    TableSpec {
        name: "marker_favorites",
        columns: MARKER_FAVORITES_COLUMNS,
        primary_key: &["id"],
        uniques: MARKER_FAVORITES_UNIQUES,
        foreign_keys: NO_FKS,
        sequence: SeqSpec {
            name: "marker_favorites_id_seq",
            data_type: "bigint",
            start: 1,
            min: 1,
            max: BIGINT_MAX,
            increment: 1,
            cache: 1,
            owned_table: "marker_favorites",
            owned_column: "id",
        },
    },
    TableSpec {
        name: "marker_image_proposals",
        columns: MARKER_IMAGE_PROPOSALS_COLUMNS,
        primary_key: &["id"],
        uniques: NO_UNIQUES,
        foreign_keys: NO_FKS,
        sequence: SeqSpec {
            name: "marker_image_proposals_id_seq",
            data_type: "bigint",
            start: 1,
            min: 1,
            max: BIGINT_MAX,
            increment: 1,
            cache: 1,
            owned_table: "marker_image_proposals",
            owned_column: "id",
        },
    },
    TableSpec {
        name: "users",
        columns: USERS_COLUMNS,
        primary_key: &["id"],
        uniques: USERS_UNIQUES,
        foreign_keys: NO_FKS,
        sequence: SeqSpec {
            name: "users_id_seq",
            data_type: "integer",
            start: 1,
            min: 1,
            max: INTEGER_MAX,
            increment: 1,
            cache: 1,
            owned_table: "users",
            owned_column: "id",
        },
    },
];

/// SQLx `_sqlx_migrations` 表的列名与 `information_schema` 数据类型。
pub static SQLX_HISTORY_COLUMNS: &[(&str, &str)] = &[
    ("version", "bigint"),
    ("description", "text"),
    ("installed_on", "timestamp with time zone"),
    ("success", "boolean"),
    ("checksum", "bytea"),
    ("execution_time", "bigint"),
];
