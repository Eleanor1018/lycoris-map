SELECT
    id, marker_id, marker_title, proposer_username, proposer_public_id,
    image_url, status, created_at
FROM marker_image_proposals
WHERE status = 'PENDING'
ORDER BY created_at DESC, id DESC
