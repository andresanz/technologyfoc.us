---
title: Consolidate two admins + flatten redirects + restructure to platform layout
slug: platform-rebuild
status: done
started: 2026-05-25
updated: 2026-05-25
current_phase: completed
---

# Goal: Platform Rebuild

## Why
The setup had grown three separate admins (andresanz.com `/sites`, andresanz.com `/redirects`, technologyfoc.us Vue), three sources of truth for "what is this domain doing" (`sites.json`, `redirects.json`, tfus SQLite), and a redirect path that proxied 80+ domains through the andresanz.com process so it could read `redirects.json` and 301. Permission errors recurred constantly because files were created by `root`, `www-data`, and the user under different identities. And the repo named `andresanz.com` actually contained admin code + core engine + sub-sites in addition to the andresanz.com site itself — a misleading architecture.

## Success criteria
- [x] One admin URL: `admin.technologyfoc.us` on server02
- [x] One domain registry: SQLite (`admin/data/domains.db`)
- [x] All redirects served as direct nginx 301s — andresanz.com process no longer handles other domains' traffic
- [x] File permissions self-healing via ACLs (no more "chown www-data" cycles)
- [x] Repo + filesystem layout reflect the platform: `/var/www/technologyfoc.us/sites/<domain>/`
- [x] GitHub repo renamed `andresanz/andresanz.com` → `andresanz/technologyfoc.us`
- [x] server01 retired (zero domains pointing at the dead IP)

## Decisions made
- 2026-05-25: **Admin = andresanz.com admin (EJS), not the Vue tfus admin.** EJS one has mature post/page/media/gratitude editors; the Vue admin only had domain management. Cheaper to port the Vue's domain-manager ideas into EJS than rebuild content editors.
- 2026-05-25: **Single server (server02), not split.** server01 was killed; admin.technologyfoc.us DNS pointed to 45.33.73.105.
- 2026-05-25: **Flatten app-level redirects to nginx-level.** Frees andresanz.com process from being the redirect dispatcher for 80+ domains.
- 2026-05-25: **ModSec loaded once at `http{}` scope**, not per server block. Per-server-block loads caused duplicate rule-ID errors that broke nginx -t.
- 2026-05-25: **Filesystem ACLs + setgid + UMask=002** are the structural fix for permissions, not chmod/chown band-aids.
- 2026-05-25: **andresanz.com kept nginx_managed=0.** Its config has a custom S3 image proxy + 30M body limit; generator can't reproduce those yet.
- 2026-05-25: **`/r` shortlinks removed.** redirect URL is now a front-matter field on any post or page.
- 2026-05-25: **Platform restructure deferred until everything else worked.** Moving andresanz.com → `sites/andresanz.com/` was risky; did it last after the other refactors stabilized.

## Phases

### P1. Foundation  ✅
- [x] ACL + setgid + UMask=002 on `/var/www/andresanz.com`
- [x] Convert 38 `sites-enabled/*` regular files → symlinks of `sites-available/*`
- [x] Audit service names (already clean: `andresanz`, `914-io`, `randomcategory-com` — no `blog-*` legacy)
- [x] Add ModSecurity rules-file inclusion to `http{}` scope in `/etc/nginx/nginx.conf`

### P2. DNS & SSL for admin URL  ✅
- [x] Issue cert for `admin.technologyfoc.us` (webroot mode)
- [x] nginx config: 80→443 redirect, 443→`127.0.0.1:4000`
- [x] Verify admin loads at new URL

### P3. Unify domain registry  ✅
- [x] `admin/lib/domains-db.js` — SQLite schema for `domains` + `domain_events`
- [x] `admin/scripts/migrate-domains.js` — import from `sites.json` + `redirects.json`
- [x] `admin/routes/sites.js` — replace old route with SQLite-backed CRUD
- [x] `admin/views/sites.ejs` — new unified UI: stats cards, search, filter chips, sync, SSL
- [x] `admin/lib/nginx-build.js` — generator for nginx configs from DB rows
- [x] `nginx_managed` column added to DB; andresanz.com flagged 0 (hand-managed)

### P4. Flatten redirects  ✅
- [x] Dedupe ModSec block rule (id 9504 was used twice in `block-rules.conf`)
- [x] Strip `modsecurity_rules_file` from per-server-block configs
- [x] Drop stale `randomcategory.com`, `samsanz.info`, `therandomactofwriting.com`, `914.io` server blocks from `andresanz.com` and `samsanzportfolio.com` configs
- [x] Sync-all: write 39 managed domains' configs from DB → nginx reload (snapshot-restore safety net catches failures)
- [x] Verified `andresanz.blog`, `andresanz.consulting` etc. return nginx-level 301 (no `x-powered-by: Express`)

### P5. Retire old cruft  ✅
- [x] Remove `/redirects` admin route + views + lib
- [x] Archive `sites.json` and `redirects.json` to `_archive/`, later deleted
- [x] Redirect `admin.andresanz.com` → 301 → `admin.technologyfoc.us` (fresh SSL cert issued)
- [x] Strip `admin.andresanz.com` from `admin.server02.andresanz.com` config (was dup)
- [x] Remove nginx `.bak` files
- [x] Stop + disable + delete `redirect-service` (195 MB freed; was the dispatcher for app-level redirects)
- [x] Update Linode A records for 3 stale domains (consulting/help/lowcountrydead) from server01 IP → server02 IP
- [x] Confirm `/r` shortlinks route returns 404

### P6. Verify  ✅
- [x] All representative URLs return expected codes: andresanz.com 200, blog 301, 914.io 200, randomcategory.com 200, admin.andresanz.com 301→tfus, admin.tfus 302→login

### P7. Platform restructure (added late)  ✅
- [x] Rename GitHub repo `andresanz/andresanz.com` → `andresanz/technologyfoc.us` (old Vue tfus repo renamed to `technologyfoc.us-old-vue` first)
- [x] Branch `restructure-platform`: move `app.js`, `content/`, `public/` → `sites/andresanz.com/`; delete dead Hono experiment (`lib/`, `views.js`, `site.css`); update `app.js` require to `../../core/app-factory`
- [x] Update `admin/lib/sites.js` to discover under `PLATFORM_ROOT/sites/` (legacy paths kept as fallback)
- [x] Update `admin/routes/sites.js` provision to write into `PLATFORM_ROOT/sites/<domain>/`
- [x] Server migration: stop services → `mv /var/www/andresanz.com /var/www/technologyfoc.us` → `git fetch && git reset --hard origin/main` → copy `.env` to `sites/andresanz.com/.env` → update 5 systemd units' paths → npm install → re-apply ACLs → start services
- [x] All services back up, all public URLs verified
- [x] Local clone re-cloned to `~/Development/github/technologyfoc.us/`
- [x] README.md and CLAUDE.md rewritten to match new layout

## Resume notes
N/A — goal completed in a single push on 2026-05-25.

## Outcome
- One admin (admin.technologyfoc.us), one DB, one server, one repo
- 209 MB of dead code (`redirect-service` + analytics DB) deleted
- Permissions self-healing via ACLs — should never see another EACCES surprise from file ownership drift
- ModSec rules consistent and de-duplicated
- Repo name + filesystem path + GitHub URL all agree (`technologyfoc.us`)
- Sub-sites are first-class peers under `sites/`; adding a new one is one click in the admin (`⚡ Provision`)

## Known follow-ups (not part of this goal)
- Backup strategy (domains.db, content/, .env files → S3) — none yet, just an idea
- Per-site analytics surfacing in `/sites` UI
- Auto-create DNS A records via Linode API when adding a domain in admin
- Move andresanz.com's bespoke nginx config (S3 proxy, 30M body) into the generator so `nginx_managed` can be flipped back on
