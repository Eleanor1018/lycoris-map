SELECT
    id, version, lat, lng, category, title, description, source_language,
    is_public, username, user_public_id, client_request_id, is_active,
    open_time_start, open_time_end, review_status, last_edited_by,
    last_edited_by_public_id, last_edited_by_owner, mark_image, created_at, updated_at
FROM map_markers m
WHERE m.is_public = true
  AND m.review_status = 'APPROVED'
  AND m.category::text = $4::text
  AND (
    $5::boolean = false
    OR m.lat NOT BETWEEN -90 AND 90
    OR m.lng NOT BETWEEN -180 AND 180
    OR (
      m.lat BETWEEN $6::double precision AND $7::double precision
      AND (
        $10::boolean = true
        OR ($8::double precision <= $9::double precision
            AND m.lng BETWEEN $8::double precision AND $9::double precision)
        OR ($8::double precision > $9::double precision
            AND (m.lng >= $8::double precision OR m.lng <= $9::double precision))
      )
    )
  )
  AND (
    6371000 * 2 * asin(sqrt(
      power(sin(radians((m.lat - $1::double precision) / 2)), 2)
      + cos(radians($1::double precision)) * cos(radians(m.lat))
      * power(sin(radians((m.lng - $2::double precision) / 2)), 2)
    ))
  ) <= $3::double precision
ORDER BY (
    6371000 * 2 * asin(sqrt(
      power(sin(radians((m.lat - $1::double precision) / 2)), 2)
      + cos(radians($1::double precision)) * cos(radians(m.lat))
      * power(sin(radians((m.lng - $2::double precision) / 2)), 2)
    ))
  ) ASC,
  m.id ASC
