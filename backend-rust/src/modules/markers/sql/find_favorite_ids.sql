SELECT marker_id
FROM marker_favorites
WHERE user_public_id = $1
ORDER BY id ASC
