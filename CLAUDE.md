# technologyfoc.us — Claude notes

Platform context for AI assistants working on this repo.

## Layout

- This repo is the **platform**. It hosts an admin + N sites.
- Platform root in production: `/var/www/technologyfoc.us/`
- Each site lives at `sites/<domain>/` and runs as its own systemd service.
- The admin (`admin/`) manages domains, content for any site, nginx configs, certs.

## Server

- Host: server02.andresanz.com / 45.33.73.105 (Linode, Ubuntu 24.04, Node 22)
- Root SSH: `ssh root@45.33.73.105`
- Admin URL: https://admin.technologyfoc.us  (password in `/var/www/technologyfoc.us/.env` → ADMIN_PASSWORD)
- Process user: `www-data`
- Permissions: ACLs + setgid + UMask 002 ensure `www-data` always has rwx under `/var/www/technologyfoc.us/`

## Sources of truth

| What | Where |
|---|---|
| Domains, redirects, ports, SSL state | `admin/data/domains.db` (SQLite) |
| Content per site | `sites/<domain>/content/{posts,pages,…}` (markdown + YAML front matter) |
| Site env (port, ADMIN_KEY, S3, GA) | `sites/<domain>/.env` |
| Admin env (ADMIN_PASSWORD, LINODE_TOKEN, etc.) | `/var/www/technologyfoc.us/.env` |
| nginx configs | `/etc/nginx/sites-available/<domain>` — symlinked in `sites-enabled/` |
| SSL certs | `/etc/letsencrypt/live/<domain>/` |

## Service map

| Service | Port | Notes |
|---|---|---|
| `andresanz-admin` | 4000 | The admin. Read-write needs ACL'd dir. |
| `andresanz` | 3000 | Main blog (legacy name, no `-com` suffix). nginx_managed=0 — handcrafted nginx config (S3 image proxy, 30M body). |
| `914-io` | 4090 | |
| `randomcategory-com` | 4091 | |
| `andresanz-deploy` | — | GitHub webhook listener |

Service naming convention: `<domain-dashed>` (e.g. `914-io`, `randomcategory-com`). `andresanz` is the only exception.

## Deploy workflow

- Push to `main` → GitHub webhook → `andresanz-deploy.service` pulls + restarts touched services
- Manual: `ssh root@45.33.73.105 'cd /var/www/technologyfoc.us && git pull && systemctl restart <svc>'`
- The Mac dev clone is at `~/Development/github/technologyfoc.us/`

## Domain workflow

1. Add domain in admin `/sites` (state: parked / redirect / live)
2. **Live sites:** use the "⚡ Provision new live sub-site" form — creates dir, app.js, .env, systemd unit, nginx config, SSL cert in one shot
3. **Redirects:** add domain, set state=redirect, fill target URL, click Sync (writes nginx 301)
4. Point DNS A record to 45.33.73.105 (Linode API helper is wired in admin)

## Editing content

The admin has a **site switcher** in the topbar. Pick the active site — all editors (Write, Posts, Pages, Media, Nav, Gratitude) then operate on that site's content dir.

## ModSecurity

- Rules loaded **once** at `http{}` scope in `/etc/nginx/nginx.conf` (`modsecurity_rules_file /etc/nginx/modsec/main.conf;`)
- Per-server-block: only `modsecurity on;` toggle (never `modsecurity_rules_file` — duplicates rule IDs and breaks nginx -t)
- Custom block rules live in `/etc/nginx/modsec/block-rules.conf`, managed by `/server/waf` admin route

## What NOT to do

- Don't `git init` a nested repo inside `sites/<domain>/` — the parent repo tracks everything
- Don't add `modsecurity_rules_file` to per-server-block nginx configs (breaks nginx -t)
- Don't write to `/etc/nginx/sites-available/<domain>` for a domain marked `nginx_managed=0` (e.g. `andresanz.com`)
- Don't run services as root — `www-data` only, with sudo grants for nginx/certbot/systemctl
- Don't put generic `.env` at the repo root expecting site apps to read it — each site has its own
- Don't reference `/var/www/andresanz.com` — that path is gone. Use `/var/www/technologyfoc.us` (or `PLATFORM_ROOT`).

## Cross-references

- AWS: account 141067832210, IAM user `server02`, key prefix `AKIASBWCMJOJIEEIAVCK`, region us-east-1, bucket `andresanz-com`
- DNS: most via Linode (LINODE_TOKEN in admin .env), some via Cloudflare
- Backups: **not yet automated** (TODO)
