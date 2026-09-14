INSERT INTO marker_favorites (user_public_id, marker_id, created_at)
VALUES ($1, $2, now())
ON CONFLICT (user_public_id, marker_id) DO NOTHING
