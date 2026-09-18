SELECT f.marker_id
FROM marker_favorites f
JOIN map_markers m ON m.id = f.marker_id
WHERE f.user_public_id = $1 AND m.deactivated = false
ORDER BY f.id ASC
