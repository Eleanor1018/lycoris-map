UPDATE users
SET avatar_url = $1,
    row_version = row_version + 1
WHERE id = $2
  AND deleted = false
  AND row_version = $3
RETURNING avatar_url, row_version
