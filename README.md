# technologyfoc.us

Single-platform multi-site blog network. Markdown + EJS + Express + SQLite, hosted on a Linode VPS.

## Architecture

```
/var/www/technologyfoc.us/           ← platform root (this repo)
├── admin/                           ← unified admin (port 4000)
├── core/                            ← shared engine — app-factory, posts/pages libs, markdown renderer
├── scripts/                         ← deploy + utility scripts
└── sites/
    ├── andresanz.com/               (port 3000)
    ├── 914.io/                      (port 4090)
    └── randomcategory.com/          (port 4091)
```

Each `sites/<domain>/` is a self-contained Node app: `app.js`, `.env`, `content/`, optional `public/`.

## Domain & redirect management

- **Source of truth:** `admin/data/domains.db` (SQLite, `domains` table)
- **Admin UI:** https://admin.technologyfoc.us/sites
- All redirects are direct nginx 301s (no per-app interception)
- Adding a domain in the admin → optional nginx config write → optional SSL cert provisioning

## Production

- Host: server02 (Linode, 45.33.73.105, Ubuntu 24.04)
- DNS: most domains via Linode; some via Cloudflare. A records → 45.33.73.105
- nginx reverse proxy with ModSecurity (rules loaded once at `http{}` scope in `/etc/nginx/nginx.conf`)
- certbot for SSL (webroot mode, `/var/www/certbot`)
- Service user: `www-data`
- Filesystem ACLs ensure `www-data` always has rwx on `/var/www/technologyfoc.us/` no matter who creates files

## Service map

| Service | Port | Domain |
|---|---|---|
| `andresanz-admin` | 4000 | admin.technologyfoc.us |
| `andresanz` | 3000 | andresanz.com (+ technologyfoc.us, + 80 redirect targets) |
| `914-io` | 4090 | 914.io |
| `randomcategory-com` | 4091 | randomcategory.com |
| `andresanz-deploy` | — | GitHub webhook → `git pull` + restart |

Service names: `<domain-dashed>` for everything except `andresanz` (legacy).

## Deploy

```bash
ssh root@45.33.73.105
cd /var/www/technologyfoc.us
git pull
systemctl restart andresanz andresanz-admin   # or whichever is relevant
```

Or push to `main` → webhook does the pull + restart automatically.

## Local dev

```bash
git clone git@github.com:andresanz/technologyfoc.us.git ~/Development/github/technologyfoc.us
cd ~/Development/github/technologyfoc.us
npm install
cd admin && npm install
```

## Stack

- Node.js 22, Express 4, EJS, markdown-it
- better-sqlite3 for admin registry + analytics
- AWS S3 (us-east-1) for image storage
- ModSecurity v3 + OWASP CRS
- systemd, certbot, nginx 1.24+

## Editing content for a sub-site

The admin has a **site switcher** in the topbar — pick the site, and all editors (Write/Posts/Pages/Media/Nav/Gratitude) act on that site's content directory.
