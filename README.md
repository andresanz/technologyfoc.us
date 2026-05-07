# andresanz-sites

Monorepo for all sites and services running on server02 (45.33.73.105 / Ubuntu 24.04).

## Structure

```
packages/
  blog-core/          # Shared blog engine (views, middleware, helpers)
  blog-admin/         # Admin panel — port 4098
  redirect-service/   # Domain redirect handler — port 4099

sites/
  914.io/             # port 4090
  andresanz.com/      # port 4091
  randomcategory.com/ # port 4092
  samsanz.info/       # port 4093
  sanz.me/            # port 4094
  therandomactofwriting.com/ # port 4095

scripts/
  webhook-deploy.js   # GitHub webhook handler — port 4101
  .env.deploy         # Webhook + Telegram config (gitignored)
```

## Services

All services are managed by systemd. Each site and package has its own service unit.

| Service | Port | Unit |
|---|---|---|
| blog-admin | 4098 | blog-admin.service |
| redirect-service | 4099 | redirect-service.service |
| 914.io | 4090 | blog-914-io.service |
| andresanz.com | 4091 | blog-andresanz-com.service |
| randomcategory.com | 4092 | blog-randomcategory-com.service |
| samsanz.info | 4093 | blog-samsanz-info.service |
| sanz.me | 4094 | blog-sanz-me.service |
| therandomactofwriting.com | 4095 | blog-therandomactofwriting-com.service |
| webhook deploy | 4101 | monorepo-deploy.service |

```bash
# Check all services
systemctl is-active blog-admin redirect-service blog-914-io blog-andresanz-com

# Restart a service
systemctl restart blog-admin
```

## Deploy

Push to `main` → GitHub webhook → `git pull` → targeted service restarts → Telegram notification.

The webhook server (`scripts/webhook-deploy.js`) maps changed file paths to services:
- `packages/blog-core/**` → restarts all 6 site services
- `packages/blog-admin/**` → restarts blog-admin
- `packages/redirect-service/**` → restarts redirect-service
- `sites/andresanz.com/**` → restarts blog-andresanz-com only
- etc.

Webhook URL: `https://admin.server02.andresanz.com/webhook/deploy`

## nginx

Each domain has a vhost in `/etc/nginx/sites-available/`. All SSL certs managed by certbot (Let's Encrypt), auto-renewing via systemd timer.

Domain redirects (e.g. sanzarts.com → sanzdesign.com) are handled by redirect-service reading `packages/blog-admin/data/redirects.json`.

## Runtime Data (gitignored)

These files are managed at runtime and are **not tracked in git**:

```
packages/blog-admin/data/redirects.json
packages/blog-admin/data/links.json
packages/blog-admin/data/gratitude-prompts.json
packages/blog-admin/data/gratitude-state.json
packages/blog-admin/data/overthinking-config.json
packages/blog-admin/data/post-templates.json
packages/blog-admin/data/quickref-notes.txt
```

Edit redirects via the admin panel: `https://admin.server02.andresanz.com/redirects`

## Environment Files

Each package and site has a `.env` file (gitignored). If lost, restore from `/var/www/<site>/.env` on the old per-site directories (still present on disk as backup).

## Cron Jobs

| Schedule | Job |
|---|---|
| Daily 2am | `git-push-all.sh` — auto-commits and pushes monorepo |
| Every 10 min | Gratitude reply check |
| 9–9:30pm ET (random) | Gratitude prompt send |
| Every 10 min, 9am–9pm | Overthinking send |
| Mon 3am | Weekly reboot |
| Mon 2am | apt update/upgrade |
| Every 2h | Log collection, maintenance |

## Telegram

Deploy notifications sent via [@andresanz_server01_bot](https://t.me/andresanz_server01_bot) to chat ID `7868137008`.

