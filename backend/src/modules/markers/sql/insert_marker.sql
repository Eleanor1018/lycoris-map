INSERT INTO map_markers (
    lat, lng, category, title, description, source_language, is_public, is_active,
    open_time_start, open_time_end, mark_image, username, user_public_id, client_request_id,
    review_status, last_edited_by, last_edited_by_public_id, last_edited_by_owner,
    created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        'PENDING', $15, $16, true, now(), now())
RETURNING
    id, version, lat, lng, category, title, description, source_language,
    is_public, username, user_public_id, client_request_id, is_active,
    open_time_start, open_time_end, review_status, last_edited_by,
    last_edited_by_public_id, last_edited_by_owner, mark_image, deactivated, created_at, updated_at
