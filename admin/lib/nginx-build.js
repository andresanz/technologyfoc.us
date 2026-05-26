'use strict';

// Generates nginx server-block content for a domain based on its state.
// All blocks are HTTPS-by-default; if no cert exists yet, an HTTP-only fallback
// is emitted so the domain can serve content immediately and certbot can run.

const fs   = require('fs');
const path = require('path');

const SITES_AVAILABLE = process.env.NGINX_SITES_AVAILABLE || '/etc/nginx/sites-available';
const SITES_ENABLED   = process.env.NGINX_SITES_ENABLED   || '/etc/nginx/sites-enabled';
const PARKED_ROOT     = process.env.PARKED_ROOT           || '/var/www/parked';
const MODSEC_RULES    = process.env.MODSEC_RULES          || '/etc/nginx/modsec/main.conf';

function modsecBlock() {
  // ModSecurity is configured on the box; include if the rules file exists.
  if (fs.existsSync(MODSEC_RULES)) {
    return `    modsecurity on;\n    modsecurity_rules_file ${MODSEC_RULES};\n`;
  }
  return '';
}

function hasCert(domain) {
  return fs.existsSync(`/etc/letsencrypt/live/${domain}/fullchain.pem`);
}

function buildBody(row) {
  if (row.state === 'live') {
    if (!row.port) throw new Error(`live domain ${row.domain} has no port`);
    return `    location / {
        proxy_pass         http://127.0.0.1:${row.port};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        'upgrade';
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }`;
  }
  if (row.state === 'redirect') {
    if (!row.target) throw new Error(`redirect domain ${row.domain} has no target`);
    const tgt = String(row.target).replace(/\/$/, '');
    const suffix = row.preserve_path ? '$request_uri' : '';
    return `    location / { return 301 ${tgt}${suffix}; }`;
  }
  // parked
  return `    root  ${PARKED_ROOT};
    index index.html;
    location / { try_files $uri $uri/ /index.html; }`;
}

function buildConfig(row) {
  const names = `${row.domain} www.${row.domain}`;
  const body  = buildBody(row);
  const cert  = hasCert(row.domain);

  const ms = modsecBlock(); // only goes in the active-traffic block to avoid rule-ID dup

  const http80 = `server {
    listen 80; listen [::]:80;
    server_name ${names};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}`;

  if (!cert) {
    return `server {
${ms}    listen 80; listen [::]:80;
    server_name ${names};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
${body}
}`;
  }

  const https443 = `server {
${ms}    listen 443 ssl http2; listen [::]:443 ssl http2;
    server_name ${names};

    ssl_certificate     /etc/letsencrypt/live/${row.domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${row.domain}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

${body}
}`;

  return `${http80}\n\n${https443}`;
}

function confPath(domain)    { return path.join(SITES_AVAILABLE, domain); }
function enabledPath(domain) { return path.join(SITES_ENABLED,   domain); }

function write(row) {
  fs.writeFileSync(confPath(row.domain), buildConfig(row) + '\n', 'utf8');
  const enabled = enabledPath(row.domain);
  if (!fs.existsSync(enabled)) {
    try { fs.symlinkSync(confPath(row.domain), enabled); } catch {}
  }
}

function remove(domain) {
  const e = enabledPath(domain);
  const a = confPath(domain);
  if (fs.existsSync(e)) fs.unlinkSync(e);
  if (fs.existsSync(a)) fs.unlinkSync(a);
}

module.exports = { hasCert, buildConfig, write, remove, confPath, enabledPath };
