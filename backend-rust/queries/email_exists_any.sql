SELECT EXISTS(SELECT 1 FROM users WHERE lower(email) = $1)
