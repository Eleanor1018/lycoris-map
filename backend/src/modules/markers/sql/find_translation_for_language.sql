SELECT marker_id, language, title, description, source_hash
FROM map_marker_translations
WHERE marker_id = $1
  AND language = $2
