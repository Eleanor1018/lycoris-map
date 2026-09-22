#!/usr/bin/env python3
"""Generate independent credentials once on a new Shanghai host; never print them."""

import json
import os
from pathlib import Path
import secrets

import bcrypt


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run as root on the new Shanghai host.")
    root = Path('/opt/lycoris')
    private = root / 'private'
    private.mkdir(mode=0o700, parents=True, exist_ok=True)
    private.chmod(0o700)
    names = ['postgres-password', 'app-db-password', 'app.env', 'smtp.env', 'bootstrap.json']
    if any((private / name).exists() for name in names):
        raise SystemExit('Configuration exists; refusing to regenerate any credentials.')
    if (root / 'data/postgres/PG_VERSION').exists():
        raise SystemExit('An initialized database exists; refusing fresh initialization.')

    postgres_password = secrets.token_hex(32)
    app_password = secrets.token_hex(32)
    second_password = secrets.token_urlsafe(24)
    reset_password = secrets.token_urlsafe(24)
    second_hash = bcrypt.hashpw(second_password.encode(), bcrypt.gensalt(rounds=12)).decode()
    env = {
        'DATABASE_URL': f'postgres://lycoris:{app_password}@127.0.0.1:15432/lycoris',
        'REDIS_URL': 'redis://127.0.0.1:16379',
        'WRITE_ALLOWED_ORIGINS': ','.join([
            'http://127.0.0.1:18080', 'http://localhost:18080',
            'https://lycoris-map.cn:18443', 'https://www.lycoris-map.cn:18443',
        ]),
        'CORS_ALLOWED_ORIGINS': '',
        # HTTP is restricted to loopback and transported through encrypted SSH.
        # Enable Secure and replace origins before publishing HTTPS after filing.
        'SESSION_COOKIE_NAME': 'LYCORIS_SHANGHAI_SESSION',
        'SESSION_COOKIE_SECURE': 'false',
        'SESSION_COOKIE_DOMAIN': '',
        'SESSION_COOKIE_SAME_SITE': 'lax',
        'SESSION_NAMESPACE': 'lycoris:shanghai:session:v1',
        'RATE_LIMIT_NAMESPACE': 'lycoris:shanghai:ratelimit:v1',
        'MARKER_CACHE_NAMESPACE': 'lycoris:shanghai:marker:v1',
        'APP_AVAILABILITY_ZONE': 'Asia/Shanghai',
        'ADMIN_SECOND_FACTOR_ENABLED': 'true',
        'ADMIN_SECOND_PASSWORD_HASH': second_hash,
        'ADMIN_DEFAULT_USER_PASSWORD': reset_password,
        'EMAIL_VERIFICATION_SECRET': secrets.token_hex(32),
        'RUST_LOG': 'info',
    }
    content = {
        'postgres-password': postgres_password + '\n',
        'app-db-password': app_password + '\n',
        'app.env': ''.join(f'{key}={value}\n' for key, value in env.items()),
        # No SMTP is configured by default. Registration remains verification-gated.
        'smtp.env': '# Configure the complete Shanghai mail transport before launch.\n',
        'bootstrap.json': json.dumps({
            'adminSecondPassword': second_password,
            'adminResetDefaultPassword': reset_password,
        }, indent=2) + '\n',
    }
    for name, value in content.items():
        fd = os.open(private / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as output:
            output.write(value)
    # Read-only secret mounts are consumed by the PostgreSQL UID. The containing
    # host directory remains root-only, so other host users cannot traverse it.
    for name in ['postgres-password', 'app-db-password']:
        (private / name).chmod(0o444)
    for name in ['postgres', 'redis', 'uploads', 'osm-cache']:
        (root / 'data' / name).mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(root / 'data/uploads', 10001, 10001)
    os.chown(root / 'data/osm-cache', 101, 101)
    print('Shanghai private configuration generated; no credentials printed.')


if __name__ == '__main__':
    main()
