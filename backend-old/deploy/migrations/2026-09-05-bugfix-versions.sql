-- Additive PostgreSQL migration for session revocation and review concurrency.
-- Run before deploying the corresponding backend when automatic schema update is disabled.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version bigint NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 0;
ALTER TABLE map_markers ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0;
ALTER TABLE marker_edit_proposals ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0;
ALTER TABLE marker_edit_proposals ADD COLUMN IF NOT EXISTS base_marker_version bigint;

-- Historical proposals intentionally keep a NULL baseline: their original snapshot
-- cannot be reconstructed safely, so reviewers must ask for a fresh submission.
COMMIT;
