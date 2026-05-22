'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');

const sitesLib = require('../lib/sites');
const nginx    = require('../lib/nginx');

const REGISTRY     = path.join(__dirname, '../sites.json');
const REDIRECTS_DB = path.join(__dirname, '../data/redirects.json');

// ── Registry helpers ──────────────────────────────────────────────────────────

function readRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); }
  catch { return []; }
}

function writeRegistry(list) {
  fs.writeFileSync(REGISTRY, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

function findSite(list, domain) {
  return list.find(s => s.domain === domain);
}

function readManagedRedirects() {
  try { return JSON.parse(fs.readFileSync(REDIRECTS_DB, 'utf8')); }
  catch { return []; }
}

// ── GET /sites ────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const registry = readRegistry();
  const registryDomains = new Set(registry.map(s => s.domain));

  // Pull in domains managed by /redirects that aren't already in sites.json
  const managedRedirects = readManagedRedirects()
    .filter(r => !registryDomains.has(r.domain))
    .map(r => ({
      domain:     r.domain,
      state:      'redirect',
      redirectTo: r.to,
      note:       r.note || '',
      managed:    'redirects', // flag: managed by /redirects, not sites.json
    }));

  const combined = [...registry, ...managedRedirects];

  // Enrich live sites with runtime data from lib/sites
  const sites = combined.map(entry => {
    const enriched = { ...entry };
    if (entry.state === 'live') {
      const runtime = sitesLib.getSite(entry.domain);
      if (runtime) {
        enriched.title      = runtime.title;
        enriched.port       = runtime.port;
        enriched.postCount  = runtime.postCount;
        enriched.svcStatus  = runtime.status;
        enriched.url        = runtime.url;
      }
    }
    enriched.nginxState = nginx.getState(entry.domain);
    return enriched;
  });

  res.render('sites', { sites, flash: req.flash() });
});

// ── GET /sites/new ────────────────────────────────────────────────────────────

router.get('/new', (req, res) => {
  const taken = readRegistry().map(s => s.domain);
  res.render('site-new', { taken, flash: req.flash() });
});

// ── POST /sites/new/create ────────────────────────────────────────────────────

router.post('/new/create', (req, res) => {
  const { domain, port, email, title, description, author, awsKey, awsSecret, awsRegion, s3Bucket } = req.body;

  const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;
  if (!DOMAIN_RE.test(domain)) {
    req.flash('error', 'Invalid domain name');
    return res.redirect('/sites/new');
  }

  const registry = readRegistry();
  if (findSite(registry, domain)) {
    req.flash('error', `${domain} is already in the registry`);
    return res.redirect('/sites/new');
  }

  try {
    const siteDir = `/var/www/${domain}`;
    const svcName = `blog-${domain.replace(/\./g, '-')}`;
    const adminKey = require('crypto').randomBytes(24).toString('hex');

    // Clone the blog template from the existing andresanz.com repo
    execSync(`git clone /var/www/andresanz.com ${siteDir} --no-hardlinks`, { timeout: 30000 });

    // Write .env
    const env = [
      `SITE_DOMAIN=${domain}`,
      `SITE_URL=https://${domain}`,
      `SITE_TITLE=${title || domain}`,
      `SITE_DESCRIPTION=${description || ''}`,
      `SITE_AUTHOR=${author || ''}`,
      `PORT=${port}`,
      `ADMIN_KEY=${adminKey}`,
      awsKey        ? `AWS_ACCESS_KEY_ID=${awsKey}`         : '',
      awsSecret     ? `AWS_SECRET_ACCESS_KEY=${awsSecret}`  : '',
      `AWS_REGION=${awsRegion || 'us-east-1'}`,
      s3Bucket      ? `S3_BUCKET=${s3Bucket}`               : '',
    ].filter(Boolean).join('\n');
    fs.writeFileSync(path.join(siteDir, '.env'), env + '\n', 'utf8');

    // Write systemd unit
    const unit = `[Unit]
Description=${domain} blog
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=${siteDir}
ExecStart=/usr/bin/node core/server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=${siteDir}/.env

[Install]
WantedBy=multi-user.target
`;
    fs.writeFileSync(`/etc/systemd/system/${svcName}.service`, unit, 'utf8');
    execSync(`systemctl daemon-reload && systemctl enable ${svcName} && systemctl start ${svcName}`, { timeout: 15000 });

    // Nginx config (no cert yet — certbot must be run separately)
    nginx.writeConfig(domain, nginx.nginxLive(domain, port));
    nginx.reload();

    // Issue cert if DNS resolves to this server
    try {
      execSync(`certbot --nginx -d ${domain} -d www.${domain} --non-interactive --agree-tos -m ${email} --redirect`, { timeout: 60000 });
      // Rewrite config now that cert exists
      nginx.writeConfig(domain, nginx.nginxLive(domain, port));
      nginx.reload();
    } catch (certErr) {
      req.flash('error', `Site created but SSL cert failed — run certbot manually. (${certErr.message})`);
    }

    // Add to registry
    registry.push({ domain, state: 'live', note: title || '' });
    writeRegistry(registry);

    req.flash('success', `${domain} is live on port ${port}`);
    res.redirect('/sites');
  } catch (e) {
    req.flash('error', e.message);
    res.redirect('/sites/new');
  }
});

// ── POST /sites/add — add an existing/parked domain to registry ───────────────

router.post('/add', (req, res) => {
  const { domain, state, redirectTo, note } = req.body;
  const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;
  if (!DOMAIN_RE.test(domain)) {
    req.flash('error', 'Invalid domain');
    return res.redirect('/sites');
  }

  const registry = readRegistry();
  if (findSite(registry, domain)) {
    req.flash('error', `${domain} already in registry`);
    return res.redirect('/sites');
  }

  const entry = { domain, state: state || 'parked', note: note || '' };
  if (state === 'redirect' && redirectTo) entry.redirectTo = redirectTo;
  registry.push(entry);
  writeRegistry(registry);

  req.flash('success', `${domain} added`);
  res.redirect('/sites');
});

// ── POST /sites/:domain/remove ────────────────────────────────────────────────

router.post('/:domain/remove', (req, res) => {
  const { domain } = req.params;
  const registry = readRegistry().filter(s => s.domain !== domain);
  writeRegistry(registry);
  req.flash('success', `${domain} removed from registry`);
  res.redirect('/sites');
});

// ── POST /sites/:domain/state — change state ──────────────────────────────────

router.post('/:domain/state', (req, res) => {
  const { domain } = req.params;
  const { state, redirectTo } = req.body;

  const registry = readRegistry();
  const entry    = findSite(registry, domain);
  if (!entry) {
    req.flash('error', 'Domain not found in registry');
    return res.redirect('/sites');
  }

  try {
    if (state === 'live') {
      const runtime = sitesLib.getSite(domain);
      if (!runtime) throw new Error(`No app.js / .env found in /var/www/${domain} — can't go live`);
      nginx.writeConfig(domain, nginx.nginxLive(domain, runtime.port));
      nginx.reload();
      sitesLib.startService(domain);
      entry.state = 'live';
      delete entry.redirectTo;

    } else if (state === 'parked') {
      nginx.writeConfig(domain, nginx.nginxParked(domain));
      nginx.reload();
      try { sitesLib.stopService(domain); } catch { /* no service to stop */ }
      entry.state = 'parked';
      delete entry.redirectTo;

    } else if (state === 'redirect') {
      if (!redirectTo) throw new Error('redirectTo is required');
      nginx.writeConfig(domain, nginx.nginxRedirect(domain, redirectTo));
      nginx.reload();
      try { sitesLib.stopService(domain); } catch { /* no service to stop */ }
      entry.state      = 'redirect';
      entry.redirectTo = redirectTo;

    } else {
      throw new Error('Unknown state: ' + state);
    }

    writeRegistry(registry);
    req.flash('success', `${domain} → ${state}`);
  } catch (e) {
    req.flash('error', e.message);
  }

  res.redirect('/sites');
});

// ── POST /sites/:domain/restart ───────────────────────────────────────────────

router.post('/:domain/restart', (req, res) => {
  const { domain } = req.params;
  try {
    sitesLib.restartService(domain);
    req.flash('success', `${domain} restarted`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/sites');
});

// ── GET /sites/:domain/settings ───────────────────────────────────────────────

router.get('/:domain/settings', (req, res) => {
  const { domain } = req.params;
  const site = sitesLib.getSite(domain);
  if (!site) {
    req.flash('error', `No live site found for ${domain}`);
    return res.redirect('/sites');
  }
  res.render('site-settings', { site, flash: req.flash() });
});

// ── POST /sites/:domain/settings ─────────────────────────────────────────────

router.post('/:domain/settings', (req, res) => {
  const { domain } = req.params;
  const { title, description, author, siteUrl, hideAuthor, gaId, awsKey, awsSecret, awsRegion, s3Bucket } = req.body;
  try {
    const changes = {
      SITE_TITLE:       title,
      SITE_DESCRIPTION: description,
      SITE_AUTHOR:      author,
      SITE_URL:         siteUrl,
      HIDE_AUTHOR:      hideAuthor === 'true' ? 'true' : 'false',
      GA_ID:            gaId || '',
      AWS_REGION:       awsRegion || 'us-east-1',
      S3_BUCKET:        s3Bucket || '',
    };
    if (awsKey)    changes.AWS_ACCESS_KEY_ID     = awsKey;
    if (awsSecret) changes.AWS_SECRET_ACCESS_KEY = awsSecret;

    sitesLib.saveSettings(domain, changes);
    sitesLib.restartService(domain);
    req.flash('success', 'Settings saved and service restarted');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect(`/sites/${domain}/settings`);
});

// ── GET /sites/:domain/logs (JSON) ────────────────────────────────────────────

router.get('/:domain/logs', (req, res) => {
  const { domain } = req.params;
  const lines = parseInt(req.query.lines) || 50;
  res.json({ logs: sitesLib.serviceLogs(domain, lines) });
});

module.exports = router;
