#!/usr/bin/env python3
"""Verify and warm currently PUBLIC image copies through the authorized Pages Worker.

Run only after binding a private MEDIA_BUCKET and deploying the new Worker/backend.
No login cookie is sent; private/pending/disabled media is never made public.
The file-backed origin remains intact. A completed report can be resumed safely.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--site', required=True, help='Deployed Lycoris HTTPS origin')
parser.add_argument('--report', required=True, type=Path, help='Local JSON checkpoint (outside Git)')
parser.add_argument('--limit', type=int, default=0, help='Optional number of public image URLs')
args = parser.parse_args()
site = urllib.parse.urlsplit(args.site)
if site.scheme != 'https' or site.username or site.password or site.query or site.fragment or site.path not in ('', '/') or site.port:
    parser.error('--site must be an HTTPS origin without credentials, path or port')
if site.hostname not in ('lycoris-map.com', 'lycoris-main.pages.dev') and not (site.hostname or '').endswith('.lycoris-main.pages.dev'):
    parser.error('--site must belong to the Lycoris Pages project')
origin = args.site.rstrip('/')

def request(path, method='GET'):
    return urllib.request.urlopen(urllib.request.Request(origin + path, method=method, headers={'User-Agent': 'Lycoris-Media-Migration/1.0'}), timeout=40)

with request('/api/markers/public') as response:
    markers = json.load(response)
paths = sorted({row['markImage'] for row in markers if isinstance(row.get('markImage'), str) and re.fullmatch(r'/uploads/markers/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp|gif)', row['markImage'], flags=re.I)})
if args.limit > 0:
    paths = paths[:args.limit]
report = json.loads(args.report.read_text()) if args.report.exists() else {'site': origin, 'completed': {}, 'errors': {}}
if report['site'] != origin:
    parser.error('checkpoint belongs to a different site')

def save():
    args.report.parent.mkdir(parents=True, exist_ok=True)
    temp = args.report.with_suffix('.tmp')
    temp.write_text(json.dumps(report, indent=2) + '\n')
    temp.replace(args.report)

for path in paths:
    for variant in ('original', 'thumb', 'detail'):
        target = path + '?variant=' + variant
        if target in report['completed']:
            continue
        try:
            with request(target) as response:
                source = response.headers.get('X-Lycoris-Media-Source')
                if source not in ('origin', 'r2', 'edge'):
                    raise RuntimeError('R2-enabled Worker missing; stop before warming the wrong deployment')
                digest = hashlib.sha256()
                size = 0
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    digest.update(chunk)
                    size += len(chunk)
                expected = response.headers.get('ETag', '').strip('"')
                if digest.hexdigest() != expected:
                    raise RuntimeError('image checksum mismatch')
                report['completed'][target] = {'sha256': expected, 'bytes': size, 'source': source}
                report['errors'].pop(target, None)
        except urllib.error.HTTPError as error:
            # A place can legitimately become private/deactivated during the run.
            report['errors'][target] = {'status': error.code}
        except (OSError, RuntimeError) as error:
            report['errors'][target] = {'error': str(error)}
            save()
            raise SystemExit(str(error)) from error
        save()
        time.sleep(0.15)
print(json.dumps({'completed': len(report['completed']), 'errors': len(report['errors']), 'report': str(args.report)}))
if report['errors']:
    raise SystemExit(1)
