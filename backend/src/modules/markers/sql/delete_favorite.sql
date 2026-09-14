DELETE FROM marker_favorites
WHERE user_public_id = $1
  AND marker_id = $2
