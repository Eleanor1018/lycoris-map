UPDATE users
SET deleted = true, deleted_at = now(), session_version = session_version + 1,
    row_version = row_version + 1
WHERE id = $1 AND deleted = false AND row_version = $2
