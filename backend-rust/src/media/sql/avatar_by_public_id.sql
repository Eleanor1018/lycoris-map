SELECT avatar_url
FROM users
WHERE public_id = $1
  AND deleted = false
