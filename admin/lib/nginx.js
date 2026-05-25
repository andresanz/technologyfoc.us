'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NGINX_AVAIL   = '/etc/nginx/sites-available';
const NGINX_ENABLED = '/etc/nginx/sites-enabled';

function hasCert(domain) {
  return fs.existsSync(`/etc/letsencrypt/live/${domain}/fullchain.pem`);
}

function sslDirectives(domain) {
  return `    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;`;
}

function http80Block(domain, httpsRedirect = true) {
  const names = `${domain} www.${domain}`;
  if (httpsRedirect) {
    return `server {
    server_name ${names};
    listen 80;
    return 301 https://$host$request_uri;
}`;
  }
  return '';
}

// ── Config generators ─────────────────────────────────────────────────────────

function nginxLive(domain, port) {
  const names = `${domain} www.${domain}`;
  const cert  = hasCert(domain);
  const listen = cert ? sslDirectives(domain) : '    listen 80;';

  const main = `server {
    server_name ${names};
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
${listen}
}`;

  const redirect80 = cert ? `\n${http80Block(domain)}` : '';
  return (main + redirect80).trim();
}

function nginxRedirect(domain, target) {
  const names = `${domain} www.${domain}`;
  const t     = target.replace(/\/$/, '');
  const cert  = hasCert(domain);

  if (cert) {
    return `server {
    server_name ${names};
    return 301 ${t}$request_uri;
${sslDirectives(domain)}
}
${http80Block(domain)}`.trim();
  }

  return `server {
    server_name ${names};
    listen 80;
    return 301 ${t}$request_uri;
}`;
}

function nginxParked(domain) {
  const names = `${domain} www.${domain}`;
  const cert  = hasCert(domain);
  const listen = cert ? sslDirectives(domain) : '    listen 80;';

  const main = `server {
    server_name ${names};
    root /var/www/parked;
    index index.html;
    try_files $uri $uri/ =404;
${listen}
}`;

  const redirect80 = cert ? `\n${http80Block(domain)}` : '';
  return (main + redirect80).trim();
}

// ── Filesystem helpers ────────────────────────────────────────────────────────

function writeConfig(domain, content) {
  const avail   = path.join(NGINX_AVAIL, domain);
  const enabled = path.join(NGINX_ENABLED, domain);
  fs.writeFileSync(avail, content + '\n', 'utf8');
  if (!fs.existsSync(enabled)) {
    fs.symlinkSync(avail, enabled);
  }
}

function reload() {
  execSync('nginx -t && systemctl reload nginx', { timeout: 10000 });
}

function readConfig(domain) {
  try { return fs.readFileSync(path.join(NGINX_AVAIL, domain), 'utf8'); }
  catch { return null; }
}

// Derive state from what's actually in nginx (for display/verification)
function getState(domain) {
  const conf = readConfig(domain);
  if (!conf) return 'unconfigured';
  if (/proxy_pass/.test(conf))                    return 'live';
  if (/root\s+\/var\/www\/parked/.test(conf))     return 'parked';
  // Real redirect = a 301 to a literal URL (excludes the $host HTTPS upgrade block)
  if (/return\s+301\s+https?:\/\/[^$\s]/.test(conf)) return 'redirect';
  return 'unknown';
}

module.exports = { nginxLive, nginxRedirect, nginxParked, writeConfig, reload, readConfig, getState, hasCert };
