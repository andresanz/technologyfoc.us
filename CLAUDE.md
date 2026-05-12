# andresanz-sites

Monorepo for Andre Sanz's blog network. Node.js/Express, flat markdown files
with YAML front matter, AWS S3 for images, nginx reverse proxy on Linode VPS.

## Server
- Host: server02.andresanz.com (root SSH access)
- Monorepo clone on server: /var/www/server02
- Sites root: /var/www/ (each site is its own directory with app.js + .env)
- Admin panel runs from: /var/www/server02/packages/blog-admin
- Admin URL: https://admin.server02.andresanz.com

## Deploy workflow
- Push to `main` on GitHub → GitHub webhook → server auto-pulls → Telegram notification → service restart
- Webhook endpoint: POST /webhook (no auth required, HMAC verified)
- Webhook secret stored in /var/www/server02/packages/blog-admin/.env as GITHUB_WEBHOOK_SECRET
- Manual deploy: ssh root@server02.andresanz.com "cd /var/www/server02 && git pull && systemctl restart blog-admin"

## Port assignments
- blog-admin=4000, andresanz.com=3002, sanz.me=3009, samsanz.info=3010
- 914.io=3004, randomcategory.com=3003, therandomactofwriting.com=3005

## Sites
- andresanz.com, randomcategory.com, sanz.me, 914.io,
  therandomactofwriting.com, samsanz.info

## Stack
- Node.js/Express, EJS views, markdown+YAML front matter, AWS S3 images
- nginx reverse proxy, certbot SSL, systemd, Ubuntu (Linode)
- Shared middleware in packages/blog-core
- Admin panel in packages/blog-admin

## IAM
- AWS account: 141067832210 (root)
- IAM user `server02` has AmazonS3FullAccess, key ID: AKIASBWCMJOJIEEIAVCK

## Local dev
- Workspace: ~/Development/github/andresanz-sites
- Per-site .env files (not in git)
- Standalone blog-admin repo (github.com/andresanz/blog-admin) was deleted — use monorepo only

## Admin nav structure
- Top level: Sites, Write, Claude, Content ▾, Server ▾, Tools ▾
- Content: Templates, Redirects, Images, S3
- Server: Domains, Volume, Server, Shell, Logs
- Tools: Mac, Michele, Ports, Gratitude, Overthinking, GitHub, Links
