-- Soft deletion is independent of is_active (opening-hours availability).
-- Preserve marker records and all related favorites, translations and proposals.
ALTER TABLE map_markers ADD COLUMN deactivated boolean NOT NULL DEFAULT false;
