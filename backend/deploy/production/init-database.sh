#!/bin/bash
set -Eeuo pipefail
# Only runs when the new PostgreSQL data directory is first initialized.
app_password="$(cat /run/secrets/app_db_password)"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 --set app_password="$app_password" <<'SQL'
CREATE ROLE lycoris LOGIN PASSWORD :'app_password';
ALTER DATABASE lycoris OWNER TO lycoris;
CREATE EXTENSION IF NOT EXISTS postgis;
SQL
unset app_password
