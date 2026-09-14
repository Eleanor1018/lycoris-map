SELECT avatar_url
FROM users
WHERE id = $1
  AND deleted = false
