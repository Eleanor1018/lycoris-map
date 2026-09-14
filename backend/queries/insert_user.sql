INSERT INTO users (public_id, username, nickname, email, password, role, deleted,
                   session_version, row_version)
VALUES ($1, $2, $3, $4, $5, 'USER', false, 0, 0)
RETURNING id, public_id, username, nickname, email, password, avatar_url, pronouns, signature,
          role, deleted, deleted_at, session_version, row_version
