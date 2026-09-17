UPDATE map_markers
SET deactivated = $2, version = version + 1, updated_at = now()
WHERE id = $1 AND deactivated <> $2
