UPDATE map_markers
SET mark_image = NULL,
    version = version + 1,
    updated_at = now()
WHERE id = $1
  AND version = $2
  AND mark_image = $3
  AND deactivated = false
