SELECT id, version, COALESCE(mark_image, '') AS mark_image
FROM map_markers
WHERE mark_image IS NOT NULL
  AND mark_image LIKE '/uploads/markers/%'
ORDER BY id ASC
