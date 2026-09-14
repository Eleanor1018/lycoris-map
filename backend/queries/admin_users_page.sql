SELECT id, public_id, username, nickname, email, password, avatar_url, pronouns, signature,
       role, deleted, deleted_at, session_version, row_version
FROM users
WHERE ($1 = '' OR username ILIKE '%' || $1 || '%' OR nickname ILIKE '%' || $1 || '%'
       OR email ILIKE '%' || $1 || '%')
ORDER BY id DESC
LIMIT $2 OFFSET $3
