SELECT
    id, marker_id, marker_title, proposer_username, proposer_public_id,
    image_url, status, reviewed_by, reviewed_at, created_at
FROM marker_image_proposals
WHERE id = $1
FOR UPDATE
