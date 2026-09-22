SELECT
    t.marker_id, t.language, t.title, t.description, t.source_hash
FROM map_marker_translations t
JOIN map_markers m ON m.id = t.marker_id
WHERE m.is_public = true
  AND m.review_status = 'APPROVED'
  AND m.deactivated = false
  AND t.language IN ('en', 'zh')
  AND (
    lower(t.title) LIKE lower('%' || $1 || '%')
    OR lower(t.description) LIKE lower('%' || $1 || '%')
  )
ORDER BY t.id ASC
