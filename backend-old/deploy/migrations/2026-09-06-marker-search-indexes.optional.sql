-- Optional: apply after inspecting representative search EXPLAIN ANALYZE results.
-- Run outside a transaction. CONCURRENTLY permits writes while indexes build.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_public_marker_title_trgm
    ON map_markers USING gin (lower(title) gin_trgm_ops)
    WHERE is_public = true AND review_status = 'APPROVED';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_public_marker_description_trgm
    ON map_markers USING gin (lower(description) gin_trgm_ops)
    WHERE is_public = true AND review_status = 'APPROVED';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marker_translation_title_trgm
    ON map_marker_translations USING gin (lower(title) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marker_translation_description_trgm
    ON map_marker_translations USING gin (lower(description) gin_trgm_ops);
