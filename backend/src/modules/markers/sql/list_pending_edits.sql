SELECT
    id, marker_id, marker_title, marker_lat, marker_lng, category, title, description,
    language, is_public, is_active, open_time_start, open_time_end,
    proposer_username, proposer_public_id, proposer_is_owner, status,
    base_marker_version, created_at
FROM marker_edit_proposals
WHERE status = 'PENDING'
ORDER BY created_at DESC
