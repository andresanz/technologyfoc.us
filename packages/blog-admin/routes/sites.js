'use strict';

const express      = require('express');
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');
const sitesLib     = require('../lib/sites');
const gitLib       = require('../lib/git');
const router       = express.Router();

const SITES_ROOT = process.env.SITES_ROOT || '/var/www';
const CORE_DIR   = '/var/www/blog-core';

// GET /sites — dashboard
router.get('/', (req, res) => {
  const sites = sitesLib.getAll();
  res.render('dashboard', { sites, flash: req.flash() });
});

// !! These must come BEFORE /:domain routes to avoid being swallowed by the wildcard

// GET /sites/new/site — new site form
router.get('/new/site', (req, res) => {
  res.render('site-new', { flash: req.flash() });
});

// POST /sites/new/create — provision a new blog site
router.post('/new/create', (req, res) => {
  const { domain, port, title, description, author, email,
          awsKey, awsSecret, awsRegion, s3Bucket } = req.body;

  if (!domain || !port || !email) {
    req.flash('error', 'Domain, port, and email are required');
    return res.redirect('/sites/new/site');
  }

  const siteDir  = path.join(SITES_ROOT, domain);
  const svcName  = `blog-${domain.replace(/\./g, '-')}`;
  const nodePath = execSync('which node').toString().trim();
  const adminKey = execSync('openssl rand -hex 24').toString().trim();
  const siteTitle = title || domain;

  if (fs.existsSync(siteDir)) {
    req.flash('error', `Directory already exists: ${siteDir}`);
    return res.redirect('/sites/new/site');
  }

  try {
    // ── Directory structure ──────────────────────────────────────────────────
    fs.mkdirSync(path.join(siteDir, 'content', 'posts'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'content', 'pages'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'views'),            { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'public', 'css'),    { recursive: true });

    // ── app.js ───────────────────────────────────────────────────────────────
    fs.writeFileSync(path.join(siteDir, 'app.js'), `'use strict';
require('dotenv').config();
const createApp = require('${CORE_DIR}/app-factory');
const app  = createApp(__dirname);
const PORT = process.env.PORT || ${port};
app.listen(PORT, '127.0.0.1', () => {
  console.log(\`[\${process.env.SITE_TITLE}] listening on http://127.0.0.1:\${PORT}\`);
});
`);

    // ── .env ─────────────────────────────────────────────────────────────────
    fs.writeFileSync(path.join(siteDir, '.env'), `NODE_ENV=production
PORT=${port}
SITE_URL=https://${domain}
SITE_TITLE=${siteTitle}
SITE_DESCRIPTION=${description || ''}
SITE_AUTHOR=${author || ''}

AWS_ACCESS_KEY_ID=${awsKey || 'REPLACE_ME'}
AWS_SECRET_ACCESS_KEY=${awsSecret || 'REPLACE_ME'}
AWS_REGION=${awsRegion || 'us-east-1'}
S3_BUCKET=${s3Bucket || ''}

ADMIN_KEY=${adminKey}
`, { mode: 0o600 });

    // ── package.json ─────────────────────────────────────────────────────────
    fs.writeFileSync(path.join(siteDir, 'package.json'), JSON.stringify({
      name: domain.replace(/\./g, '-'),
      version: '1.0.0',
      main: 'app.js',
      scripts: { start: 'node app.js' },
      dependencies: { dotenv: '^16.4.0' },
    }, null, 2));

    // ── Sample post ──────────────────────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    fs.writeFileSync(path.join(siteDir, 'content', 'posts', 'hello-world.md'),
`---
title: Hello World
date: ${today}
slug: hello-world
tags: [intro]
excerpt: First post on ${siteTitle}.
draft: false
---

Welcome to **${siteTitle}**.
`);

    // ── npm install ───────────────────────────────────────────────────────────
    execSync('npm install --omit=dev --silent', { cwd: siteDir, timeout: 60000 });

    // ── Permissions ───────────────────────────────────────────────────────────
    execSync(`chown -R www-data:www-data ${siteDir} && chmod -R 750 ${siteDir}`);

    // ── systemd service ───────────────────────────────────────────────────────
    fs.writeFileSync(`/etc/systemd/system/${svcName}.service`, `[Unit]
Description=Blog: ${domain}
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=${siteDir}
EnvironmentFile=${siteDir}/.env
ExecStart=${nodePath} app.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${svcName}

[Install]
WantedBy=multi-user.target
`);
    execSync(`systemctl daemon-reload && systemctl enable ${svcName} && systemctl start ${svcName}`);

    // ── nginx vhost (HTTP only until cert issued) ─────────────────────────────
    const nginxConf = `/etc/nginx/sites-available/${domain}`;
    fs.writeFileSync(nginxConf, `server {
    listen 80; listen [::]:80;
    server_name ${domain} www.${domain};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location /admin { return 301 https://admin.server02.andresanz.com; }
    location / {
        proxy_pass         http://127.0.0.1:${port};
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
`);
    execSync(`ln -sf ${nginxConf} /etc/nginx/sites-enabled/${domain} && nginx -t && systemctl reload nginx`);

    req.flash('success', `Site ${domain} created on port ${port}. Point DNS to this server then use "Get SSL" to enable HTTPS.`);
    res.redirect(`/sites/${domain}`);
  } catch (e) {
    try { execSync(`systemctl stop ${svcName} 2>/dev/null; rm -rf ${siteDir}`); } catch (_) {}
    const msg = (e.stderr ? e.stderr.toString() : e.message).slice(0, 400);
    console.error('[new-site] error:', msg);
    req.flash('error', `Failed: ${msg}`);
    res.redirect('/sites/new/site');
  }
});


function getSslInfo(domain) {
  try {
    const fs = require('fs');
    const { execSync } = require('child_process');
    const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
    if (!fs.existsSync(certPath)) return null;
    const out = execSync(`openssl x509 -enddate -startdate -noout -in ${certPath} 2>/dev/null`).toString();
    const expMatch   = out.match(/notAfter=(.+)/);
    const startMatch = out.match(/notBefore=(.+)/);
    if (!expMatch) return null;
    const expDate   = new Date(expMatch[1].trim());
    const startDate = startMatch ? new Date(startMatch[1].trim()) : null;
    const daysLeft  = Math.ceil((expDate - Date.now()) / 86400000);
    return {
      expires:  expDate.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }),
      issued:   startDate ? startDate.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : null,
      daysLeft,
      status:   daysLeft <= 7 ? 'critical' : daysLeft <= 21 ? 'warning' : 'ok',
    };
  } catch { return null; }
}

// GET /sites/:domain — site detail
router.get('/:domain', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });
  const logs = sitesLib.serviceLogs(req.params.domain, 30);
  const sslInfo = getSslInfo(req.params.domain);
  res.render('site', { site, logs, sslInfo, flash: req.flash() });
});

// POST /sites/:domain/restart
router.post('/:domain/restart', (req, res) => {
  try {
    sitesLib.restartService(req.params.domain);
    req.flash('success', 'Service restarted');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect(`/sites/${req.params.domain}`);
});

// POST /sites/:domain/stop
router.post('/:domain/stop', (req, res) => {
  try {
    sitesLib.stopService(req.params.domain);
    req.flash('success', 'Service stopped');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect(`/sites/${req.params.domain}`);
});

// POST /sites/:domain/start
router.post('/:domain/start', (req, res) => {
  try {
    sitesLib.startService(req.params.domain);
    req.flash('success', 'Service started');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect(`/sites/${req.params.domain}`);
});

// POST /sites/:domain/bust — bust post cache
router.post('/:domain/bust', async (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).json({ error: 'Not found' });
  try {
    await sitesLib.bustCache(site);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /sites/:domain/settings — settings form
router.get('/:domain/settings', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });
  res.render('site-settings', { site, flash: req.flash() });
});

// POST /sites/:domain/settings — save settings
router.post('/:domain/settings', async (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  const { title, description, author, hideAuthor, siteUrl, awsKey, awsSecret, awsRegion, s3Bucket, gaId } = req.body;

  try {
    sitesLib.saveSettings(req.params.domain, {
      SITE_TITLE:            title       || '',
      SITE_DESCRIPTION:      description || '',
      SITE_AUTHOR:           author      || '',
      HIDE_AUTHOR:           hideAuthor === 'true' ? 'true' : 'false',
      SITE_URL:              siteUrl     || '',
      AWS_ACCESS_KEY_ID:     awsKey      || '',
      AWS_SECRET_ACCESS_KEY: awsSecret   || '',
      AWS_REGION:            awsRegion   || 'us-east-1',
      S3_BUCKET:             s3Bucket    || '',
      GA_ID:                 gaId        || '',
    });
    sitesLib.restartService(req.params.domain);
    req.flash('success', 'Settings saved and service restarted');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect(`/sites/${req.params.domain}/settings`);
});

// POST /sites/:domain/ssl — issue Let's Encrypt cert and flip to HTTPS
router.post('/:domain/ssl', (req, res) => {
  const { domain } = req.params;
  const site = sitesLib.getSite(domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  try {
    // Issue cert
    execSync(
      `certbot certonly --webroot -w /var/www/certbot -d ${domain} -d www.${domain} ` +
      `--email andre@andresanz.com --agree-tos --no-eff-email --non-interactive`,
      { timeout: 120000 }
    );

    // Write HTTPS nginx config
    const nginxConf = `/etc/nginx/sites-available/${domain}`;
    fs.writeFileSync(nginxConf, `server {
    listen 80; listen [::]:80;
    server_name ${domain} www.${domain};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2; listen [::]:443 ssl http2;
    server_name ${domain} www.${domain};

    ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    gzip on; gzip_vary on; gzip_proxied any;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    client_max_body_size 50m;

    location /admin { return 301 https://admin.server02.andresanz.com; }

    location / {
        proxy_pass         http://127.0.0.1:${site.port};
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    access_log /var/log/nginx/${domain}.access.log;
    error_log  /var/log/nginx/${domain}.error.log;
}
`);
    execSync('nginx -t && systemctl reload nginx');
    req.flash('success', `SSL enabled for ${domain}`);
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).slice(0, 400);
    console.error('[ssl] error:', msg);
    req.flash('error', `SSL failed: ${msg}`);
  }
  res.redirect(`/sites/${domain}`);
});

// GET /sites/:domain/history — git history
router.get('/:domain/history', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });
  const commits = gitLib.log(site, 50);
  res.render('history', { site, commits, flash: req.flash() });
});

// GET /sites/:domain/history/:hash — show commit diff
router.get('/:domain/history/:hash', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });
  const { execSync } = require('child_process');
  let detail = '';
  let files  = [];
  try {
    detail = execSync(`git -C ${site.dir} show --stat ${req.params.hash}`, { timeout: 5000 }).toString();
    const nameOnly = execSync(`git -C ${site.dir} show --name-only --format="" ${req.params.hash}`, { timeout: 5000 }).toString();
    files = nameOnly.trim().split('\n').filter(Boolean);
  } catch {}
  res.render('history-commit', { site, hash: req.params.hash, detail, files, flash: req.flash() });
});

// POST /sites/:domain/history/:hash/restore — restore a file from a commit
router.post('/:domain/history/:hash/restore', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });
  const { file } = req.body;
  try {
    execSync(`git -C ${site.dir} checkout ${req.params.hash} -- ${file}`, { timeout: 5000 });
    gitLib.autoCommit(site, `Restore ${file} from ${req.params.hash}`);
    sitesLib.bustCache(site).catch(() => {});
    req.flash('success', `Restored: ${file}`);
  } catch (e) {
    req.flash('error', `Restore failed: ${e.message.split('\n')[0]}`);
  }
  res.redirect(`/sites/${req.params.domain}/history/${req.params.hash}`);
});

// GET /sites/:domain/css — CSS editor
router.get('/:domain/css', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });
  const cssFile = path.join(site.dir, 'public', 'css', 'custom.css');
  const css = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8') : '';
  res.render('css-edit', { site, css, flash: req.flash() });
});

// POST /sites/:domain/css — save CSS
router.post('/:domain/css', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });
  const cssFile = path.join(site.dir, 'public', 'css', 'custom.css');
  fs.mkdirSync(path.dirname(cssFile), { recursive: true });
  const cssTmp = cssFile + '.tmp';
  fs.writeFileSync(cssTmp, req.body.css || '', { mode: 0o640 });
  fs.renameSync(cssTmp, cssFile);
  try { require('child_process').execSync('chown www-data:www-data ' + cssFile); } catch {}
  gitLib.autoCommit(site, 'Update custom CSS');
  sitesLib.restartService(req.params.domain);
  req.flash('success', 'CSS saved — service restarted');
  res.redirect(`/sites/${req.params.domain}/css`);
});

// GET /sites/:domain/nav — nav editor
router.get('/:domain/nav', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  const navFile = path.join(site.dir, 'content', 'nav.json');
  let navItems;
  if (fs.existsSync(navFile)) {
    try { navItems = JSON.parse(fs.readFileSync(navFile, 'utf8')); }
    catch { navItems = defaultNav(); }
  } else {
    navItems = defaultNav();
  }
  res.render('nav', { site, navItems, flash: req.flash() });
});

// POST /sites/:domain/nav — save nav
router.post('/:domain/nav', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  let items = [];
  try { items = JSON.parse(req.body.nav || '[]'); } catch {}

  const navFile = path.join(site.dir, 'content', 'nav.json');
  fs.mkdirSync(path.dirname(navFile), { recursive: true });
  const navTmp = navFile + '.tmp';
  fs.writeFileSync(navTmp, JSON.stringify(items, null, 2), { mode: 0o640 });
  fs.renameSync(navTmp, navFile);
  try { require('child_process').execSync('chown www-data:www-data ' + navFile); } catch {}

  gitLib.autoCommit(site, 'Update navigation');
  sitesLib.bustCache(site).catch(() => {});

  req.flash('success', 'Navigation saved');
  res.redirect(`/sites/${req.params.domain}/nav`);
});

function defaultNav() {
  return [
    { label: 'Posts', url: '/',         enabled: true },
    { label: 'Tags',  url: '/tags',     enabled: true },
    { label: 'RSS',   url: '/feed/rss', enabled: true },
  ];
}

module.exports = router;
