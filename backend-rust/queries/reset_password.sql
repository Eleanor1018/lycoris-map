UPDATE users
SET password = $1, session_version = session_version + 1, row_version = row_version + 1
WHERE id = $2 AND deleted = false AND row_version = $3
RETURNING session_version, row_version
