SELECT marker_id, language, title, description, source_hash
FROM map_marker_translations
WHERE marker_id = ANY($1::int8[])
  AND language = $2
