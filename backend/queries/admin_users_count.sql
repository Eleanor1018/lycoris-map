SELECT count(*)
FROM users
WHERE ($1 = '' OR username ILIKE '%' || $1 || '%' OR nickname ILIKE '%' || $1 || '%'
       OR email ILIKE '%' || $1 || '%')
