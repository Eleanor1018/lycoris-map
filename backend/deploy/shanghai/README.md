# Shanghai deployment — lycoris-map.cn

The mainland site uses its own PostgreSQL/PostGIS, Redis, uploads, sessions and
secrets. It does not connect to or replicate the overseas account database.
The private gateway listens on `127.0.0.1:18080`; Rust on `127.0.0.1:18081`.
The supplied domain certificate is served over private HTTPS on `127.0.0.1:18443`.
Database/cache ports also bind only loopback. Initial ICP review must finish
before changing this to a public website.

## Release layout

- Source/build: `/opt/lycoris/releases/887ae40` (Web and backend from the same commit).
- Deployment configuration: `backend/deploy/shanghai` in that release.
- Web files: `frontend/dist` in that release.
- Secrets and deployment pins: `/opt/lycoris/private` (root-only).
- Persistent state: `/opt/lycoris/data`.
- Build logs and backups: `/opt/lycoris/backups` (root-only).

The resource limits target the 2 vCPU / 2 GB Shanghai host. Build Rust with one
Cargo job. Use Docker Engine and a Compose version supporting raw env files.
No Docker socket or daemon API is exposed over TCP.

## Prepare a new host

Build the backend runtime from `backend/Dockerfile`, tagging the exact revision.
Build `lycoris-postgres:17.11-3.6.4` using the existing production PostgreSQL
Dockerfile; it preserves the pinned major version and PostGIS package. Pull
the pinned Redis image and record the resolved nginx digest. Do not copy
production credentials, a live Redis dump, or run the production `prepare.sh`.

Run `sudo python3 initialize.py` once. It needs the Ubuntu `python3-bcrypt`
package and refuses an existing configuration/database. SMTP is deliberately
unconfigured initially; email-code endpoints return 503 and registration still
requires a valid code. Configure a reachable, complete mail transport before
launch; do not disable verification to get a successful registration response.

Keep `/opt/lycoris/private/deploy.env` mode 0600. Its non-secret pins are:

```dotenv
LYCORIS_APP_IMAGE=lycoris-backend:887ae40
LYCORIS_WEB_IMAGE=nginx@sha256:ef8676b33d681f272ba429b27658bdd7e640963279714c96bddf1dc76307f7b6
LYCORIS_WEB_ROOT=/opt/lycoris/releases/887ae40/frontend/dist
```

From the release's `backend/deploy/shanghai` directory:

```sh
sudo docker compose --env-file /opt/lycoris/private/deploy.env config --quiet
sudo docker compose --env-file /opt/lycoris/private/deploy.env up -d postgres redis
sudo docker compose --env-file /opt/lycoris/private/deploy.env run --rm --no-deps app --migrate
sudo docker compose --env-file /opt/lycoris/private/deploy.env up -d app web
```

Ordinary app startup validates migrations and does not execute them. Never run
an older binary against a database with unknown migrations. Before later
upgrades, retain the previous release/config and take a validated database/media
backup. Do not erase volumes as a repair or rollback step.

## Private access and verification

On the owner's Mac, using the supplied key (keep it mode 0600):

```sh
ssh -N -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -i '/Users/nora/Downloads/lycoris_map_sh1.pem' \
  -L 127.0.0.1:18080:127.0.0.1:18080 ubuntu@111.229.9.16
```

Open `http://127.0.0.1:18080`. Both local paths are loopback; the network leg
between the Mac and Shanghai is encrypted SSH. Private HTTP cookies use their
own name and explicit localhost Origin allowlist. Do not carry these settings
forward unchanged when enabling public HTTPS.

Check readiness, public/nearby/search responses, protected-route 401s, static
assets, `/admin` deep links, and an OSM tile twice (second request should HIT).
Validate that nginx does not send a missing API/asset request to the SPA fallback.
Confirm no HTTP listener exists on a non-loopback address. Authenticated flows
need an independently provisioned account; an empty initial database does not
contain the existing production users or places.

## Domain certificate

The owner's Nginx certificate bundle covers `lycoris-map.cn` and
`www.lycoris-map.cn`. Private TLS files are kept outside the release and Git:

```
/opt/lycoris/private/tls/lycoris-map.cn/fullchain.pem
/opt/lycoris/private/tls/lycoris-map.cn/privkey.pem
```

Keep the containing host directories root-only (0700); mount these two files
read-only individually. The private key is root-owned with group 101 and mode
0640 so the container's non-root nginx process can read its mounted copy.
Neither the source zip nor key belongs in frontend dist, Git or build contexts.

The certificate supplied on September 23 is valid until **2026-12-21 16:59:59
UTC (December 22 00:59:59 Asia/Shanghai)**. It is a manually supplied certificate;
this deployment does not configure automatic issuance/renewal. On renewal,
verify the hostname, validity and matching public keys first, retain the old
pair privately, and validate the nginx configuration. Because individual bind
mounts can retain old inodes after atomic file replacement, recreate the web
container after installing the renewed files rather than relying only on reload.

Before ICP approval, test the real hostname from the server without changing
public listeners or weakening certificate verification:

```sh
curl --noproxy '*' --resolve lycoris-map.cn:18443:127.0.0.1 \
  https://lycoris-map.cn:18443/health/ready
```

To make that same test on the Mac, also forward local `18443` to server
`127.0.0.1:18443` through SSH. Do not use `curl -k` for certificate validation.

## Map tiles

The Web uses the same OSM source and attribution as the existing site. Direct
Shanghai access to `tile.openstreetmap.org` timed out during preparation, while
`https://lycoris-map.com/tiles/osm/0/0/0.png` returned a valid PNG. The private
Shanghai gateway therefore fetches **only fixed OSM tile paths** through the
existing site's Worker, caches successful tiles locally, and revalidates them
according to upstream freshness. It rejects invalid coordinates, queries and
methods and does not forward user cookies or authorization to that upstream.
It does not proxy Shanghai account/API traffic to the overseas service.

This tile dependency must be considered when choosing the eventual mainland
map provider and confirming map-service requirements with the filing provider.
Bulk tile downloads/offline prefetch are not part of this deployment.

## Before public launch

1. Complete domain real-name verification and ICP filing for `lycoris-map.cn`.
   Confirm that the purchased resource is eligible in Tencent's filing console.
2. Confirm the mainland site's map provider, permitted service scope and
   submission/moderation requirements using the actual features. A foreign
   tile relay is not evidence of any regulatory exemption.
3. Configure and verify a mainland-reachable mail sender. Real email tests need
   an explicitly designated recipient; no delivery has been claimed by startup.
4. Decide initial public-place import, ongoing moderation-based synchronization
   and account behavior. This deployment does not implement two-way replication.
5. Confirm the installed domain certificate remains valid, change the gateway listeners and DNS intentionally,
   enable `SESSION_COOKIE_SECURE=true`, and replace write origins with the
   exact HTTPS origins in use. Keep PostgreSQL, Redis and Rust on loopback.
6. Display the issued ICP number/link, publish, then submit the public-security
   filing within the applicable deadline. Add its issued number/icon/link.

## Filing preparation (checked 2026-09-23)

Confirmed inputs: domain `lycoris-map.cn`; instance `lycoris`; Shanghai public
IP `111.229.9.16`. Registrant verification is in progress. The filing subject,
province, identity/contact materials and cloud resource term are not verified.
The server's region does not determine the applicant's filing province.

Suggested truthful service description, to review against the final feature set:

> Lycoris 无障碍设施信息查询服务，提供无障碍卫生间、母婴室等设施的地图检索、
> 详情展示和收藏；用户可注册账号并提交设施位置、文字和图片，投稿经管理员审核后发布。

This text is a draft, not a submitted declaration or an approved site name.
Ask the filing specialist to confirm the subject eligibility/service category
for these features rather than describing the service as a personal blog.

Start at [Tencent ICP console](https://console.cloud.tencent.com/beian), choose
**网站/域名**, enter the root domain, and follow **去备案 → 新增备案**. Supply
the real subject/province and select the eligible cloud resource. The owner
completes identity/video/SMS checks. No application has been submitted by this
deployment workflow.

- [Tencent resource eligibility](https://cloud.tencent.com/document/product/243/18908):
  qualifying mainland CVM/Lighthouse, prepaid total >= 3 months and at least
  1 month remaining during filing; confirm actual instance in the console.
- [Domain verification FAQ](https://cloud.tencent.com/document/faq/243/19627):
  after real-name verification, Tencent domains wait 3 calendar days; other
  registrars' domains wait 3 working days before submission/system validation.
- [First filing steps](https://cloud.tencent.com/document/product/243/97668)
  and [required materials](https://cloud.tencent.com/document/product/243/18914).
- [Public-security filing guide](https://cloud.tencent.com/document/product/243/19142):
  after ICP approval and public launch, submit within 30 days through
  [the national public-security platform](https://beian.mps.gov.cn/).
  It needs a reachable site and is not a substitute for initial ICP approval.
