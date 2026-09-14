INSERT INTO map_marker_translations (
    marker_id, language, title, description, source_hash, origin, updated_at)
VALUES ($1, $2, $3, $4, $5, 'MANUAL', now())
ON CONFLICT (marker_id, language)
DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    source_hash = EXCLUDED.source_hash,
    origin = 'MANUAL',
    updated_at = now()
