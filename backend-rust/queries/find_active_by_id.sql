SELECT id, public_id, username, nickname, email, password, avatar_url, pronouns, signature,
       role, deleted, deleted_at, session_version, row_version
FROM users
WHERE id = $1 AND deleted = false
