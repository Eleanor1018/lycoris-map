SELECT deleted, row_version
FROM users
WHERE id = $1
