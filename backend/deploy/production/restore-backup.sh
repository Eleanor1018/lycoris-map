#!/bin/bash
# Restore only into an empty destination and compare every original business row.
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")"
backup="$(realpath "${1:?Pass a private backup directory}")"
database="${2:?Pass lycoris_review or lycoris}"
case "$database" in lycoris_review|lycoris) ;; *) exit 2 ;; esac
(cd "$backup" && sha256sum --check SHA256SUMS)
psql_db() { docker compose exec -T postgres psql -XqAt -U postgres -d "$1" -v ON_ERROR_STOP=1 "${@:2}"; }
if test "$(psql_db postgres -c "SELECT count(*) FROM pg_database WHERE datname='$database'")" = 0; then
    psql_db postgres -c "CREATE DATABASE $database OWNER lycoris TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.utf8' LC_CTYPE 'en_US.utf8'"
fi
if test "$(psql_db "$database" -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> 'spatial_ref_sys'")" != 0; then
    echo 'Destination contains application tables; refusing restoration.' >&2
    exit 1
fi
psql_db "$database" -c 'CREATE EXTENSION IF NOT EXISTS postgis'
docker compose exec -T postgres pg_restore -U postgres -d "$database" \
    --no-owner --no-acl --exit-on-error < "$backup/database.dump"
python3 - "$backup" "$database" <<'PY'
import hashlib, json, pathlib, subprocess, sys
backup, database = pathlib.Path(sys.argv[1]), sys.argv[2]
expected = json.loads((backup / 'table-fingerprints.json').read_text())
tables = ('users', 'map_markers', 'marker_favorites', 'marker_edit_proposals',
          'marker_image_proposals', 'map_marker_translations')
assert set(expected) == set(tables), 'Unexpected backup table inventory'
prefix = ['docker', 'compose', 'exec', '-T', 'postgres', 'psql', '-XqAt', '-U',
          'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c']
for table in tables:
    raw = subprocess.check_output(prefix + [f'COPY (SELECT row_to_json(t) FROM public.{table} t ORDER BY id) TO STDOUT'])
    actual = {'rows': len(raw.splitlines()), 'sha256': hashlib.sha256(raw).hexdigest()}
    assert actual == expected[table], f'Fingerprint mismatch: {table}'
    subprocess.run(prefix + [f'ALTER TABLE public.{table} OWNER TO lycoris'], check=True)
    print(f'{table}: {actual["rows"]} rows, fingerprint OK')
subprocess.run(prefix + [f'ALTER DATABASE {database} OWNER TO lycoris'], check=True)
print(f'{database}: restoration verified; migrations have not run yet.')
PY
