INSERT INTO marker_image_proposals
    (marker_id, marker_title, proposer_username, proposer_public_id, image_url, status, created_at)
VALUES ($1, $2, $3, $4, $5, 'PENDING', now())
RETURNING id
