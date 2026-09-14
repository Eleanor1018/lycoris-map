UPDATE users
SET deleted = false, deleted_at = NULL, session_version = session_version + 1,
    row_version = row_version + 1
WHERE id = $1 AND deleted = true AND row_version = $2
