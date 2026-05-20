'use strict';

const express         = require('express');
const fs              = require('fs');
const path            = require('path');
const { execSync, exec } = require('child_process');
const Database        = require('better-sqlite3');
const gitLib          = require('../lib/git');
const router          = express.Router();

const DATA_FILE = path.join(__dirname, '..', 'data', 'redirects.json');
const DB_PATH   = process.env.REDIRECTS_DB || path.join(__dirname, '..', 'data', 'redirects.db');

function getDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    return db;
  } catch { return null; }
}

function getStats(days = 30) {
  const db = getDb();
  if (!db) return {};
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  try {
    const rows = db.prepare(
      'SELECT domain, COUNT(*) as hits FROM hits WHERE ts >= ? GROUP BY domain'
    ).all(since);
    return Object.fromEntries(rows.map(r => [r.domain, r.hits]));
  } catch { return {}; }
}

function getCountryStats(days = 30) {
  const db = getDb();
  if (!db) return {};
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  try {
    const rows = db.prepare(`
      SELECT domain, country, COUNT(*) as hits
      FROM hits WHERE ts >= ? AND country IS NOT NULL
      GROUP BY domain, country ORDER BY hits DESC
    `).all(since);
    const result = {};
    rows.forEach(r => {
      if (!result[r.domain]) result[r.domain] = [];
      result[r.domain].push({ country: r.country, hits: r.hits });
    });
    return result;
  } catch { return {}; }
}

function getSslInfo(domain) {
  try {
    const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
    if (!fs.existsSync(certPath)) return null;
    const out      = execSync(`openssl x509 -enddate -noout -in ${certPath} 2>/dev/null`).toString();
    const match    = out.match(/notAfter=(.+)/);
    if (!match) return null;
    const expDate  = new Date(match[1].trim());
    const daysLeft = Math.ceil((expDate - Date.now()) / 86400000);
    return { expires: expDate.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }), daysLeft,
             status: daysLeft <= 7 ? 'critical' : daysLeft <= 21 ? 'warning' : 'ok' };
  } catch { return null; }
}

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function save(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2) + '\n');
}


const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function provisionSsl(domain) {
  try {
    execSync(
      `certbot certonly --webroot -w /var/www/certbot -d ${domain} -d www.${domain} ` +
      `--email sanz.andre@gmail.com --agree-tos --no-eff-email --non-interactive`,
      { timeout: 120000 }
    );
    const nginxConf = `/etc/nginx/sites-available/${domain}`;
    require('fs').writeFileSync(nginxConf, `server {
    listen 80; listen [::]:80;
    server_name ${domain} www.${domain};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2; listen [::]:443 ssl http2;
    server_name ${domain} www.${domain};

    ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    location / {
        proxy_pass         http://127.0.0.1:4099;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }
}
`);
    execSync(`ln -sf ${nginxConf} /etc/nginx/sites-enabled/${domain} && nginx -t && systemctl reload nginx`);
    return null; // success
  } catch (e) {
    return (e.stderr ? e.stderr.toString() : e.message).slice(0, 400);
  }
}

// GET /redirects
router.get('/', (req, res) => {
  const days      = parseInt(req.query.days) || 30;
  const redirects = load();
  const ssl       = Object.fromEntries(redirects.map(r => [r.domain, getSslInfo(r.domain)]));
  res.render('redirects', { redirects, stats: getStats(days), countryStats: getCountryStats(days), ssl, days, flash: req.flash() });
});

// GET /redirects/new
router.get('/new', (req, res) => {
  res.render('redirect-edit', { r: {}, action: '/redirects/new', flash: req.flash() });
});

// POST /redirects/new
router.post('/new', (req, res) => {
  const { domain, to, code, note, preservePath } = req.body;
  if (!domain || !to) {
    req.flash('error', 'Domain and destination are required');
    return res.redirect('/redirects/new');
  }
  if (!DOMAIN_RE.test(domain.trim())) {
    req.flash('error', 'Invalid domain name');
    return res.redirect('/redirects/new');
  }
  const list = load();
  if (list.find(r => r.domain === domain)) {
    req.flash('error', `${domain} already exists`);
    return res.redirect('/redirects/new');
  }
  list.push({
    domain:       domain.trim().toLowerCase(),
    to:           to.trim(),
    code:         parseInt(code) || 301,
    note:         note || '',
    preservePath: preservePath === 'on',
    updatedAt:    new Date().toISOString(),
  });
  save(list);
  gitLib.autoCommit(req.site, `Add redirect: ${domain}`);
  req.flash('success', `Redirect added for ${domain}`);
  res.redirect('/redirects');
});

// GET /redirects/:domain/edit
router.get('/:domain/edit', (req, res) => {
  const r = load().find(x => x.domain === req.params.domain);
  if (!r) return res.status(404).render('error', { code: 404, message: 'Redirect not found' });
  res.render('redirect-edit', { r, action: `/redirects/${r.domain}/edit`, flash: req.flash() });
});

// POST /redirects/:domain/edit
router.post('/:domain/edit', (req, res) => {
  const { to, code, note, preservePath } = req.body;
  const list = load();
  const idx  = list.findIndex(x => x.domain === req.params.domain);
  if (idx === -1) return res.status(404).render('error', { code: 404, message: 'Redirect not found' });
  list[idx] = {
    ...list[idx],
    to:           to.trim(),
    code:         parseInt(code) || 301,
    note:         note || '',
    preservePath: preservePath === 'on',
    updatedAt:    new Date().toISOString(),
  };
  save(list);
  gitLib.autoCommit(req.site, `Update redirect: ${req.params.domain}`);
  req.flash('success', 'Redirect updated');
  res.redirect('/redirects');
});

// POST /redirects/:domain/ssl
router.post('/:domain/ssl', (req, res) => {
  const { domain } = req.params;
  if (!DOMAIN_RE.test(domain)) {
    req.flash('error', 'Invalid domain');
    return res.redirect('/redirects');
  }
  if (!load().find(r => r.domain === domain)) {
    req.flash('error', 'Redirect not found');
    return res.redirect('/redirects');
  }
  try {
    execSync(
      `certbot certonly --webroot -w /var/www/certbot -d ${domain} -d www.${domain} ` +
      `--email andre@andresanz.com --agree-tos --no-eff-email --non-interactive`,
      { timeout: 120000 }
    );

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

    location / {
        proxy_pass         http://127.0.0.1:4099;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
`);
    execSync(`ln -sf ${nginxConf} /etc/nginx/sites-enabled/${domain} && nginx -t && systemctl reload nginx`);
    req.flash('success', `SSL enabled for ${domain}`);
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).slice(0, 400);
    req.flash('error', `SSL failed: ${msg}`);
  }
  res.redirect('/redirects');
});

// POST /redirects/:domain/delete
router.post('/:domain/delete', (req, res) => {
  const list = load().filter(x => x.domain !== req.params.domain);
  save(list);
  gitLib.autoCommit(req.site, `Delete redirect: ${req.params.domain}`);
  req.flash('success', `Deleted redirect for ${req.params.domain}`);
  res.redirect('/redirects');
});

module.exports = router;
