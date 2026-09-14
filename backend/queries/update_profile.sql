UPDATE users
SET nickname = $1, pronouns = $2, signature = $3, row_version = row_version + 1
WHERE id = $4 AND deleted = false AND row_version = $5
RETURNING id, public_id, username, nickname, email, password, avatar_url, pronouns, signature,
          role, deleted, deleted_at, session_version, row_version
