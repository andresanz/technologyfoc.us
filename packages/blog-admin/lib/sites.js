'use strict';

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');
const dotenv       = require('dotenv');

const SITES_ROOT   = process.env.SITES_ROOT || '/var/www';
const SKIP_DIRS    = new Set(['blog-core', 'blog-admin', 'html', 'certbot']);

// ── Discover all sites ────────────────────────────────────────────────────────
function getAll() {
  return fs.readdirSync(SITES_ROOT)
    .filter(name => {
      if (SKIP_DIRS.has(name)) return false;
      const siteDir = path.join(SITES_ROOT, name);
      return fs.statSync(siteDir).isDirectory() &&
             fs.existsSync(path.join(siteDir, 'app.js')) &&
             fs.existsSync(path.join(siteDir, '.env'));
    })
    .map(name => getSite(name))
    .filter(Boolean)
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

// ── Get a single site by domain ───────────────────────────────────────────────
function getSite(domain) {
  const siteDir = path.join(SITES_ROOT, domain);
  const envFile = path.join(siteDir, '.env');

  if (!fs.existsSync(envFile)) return null;

  const cfg = dotenv.parse(fs.readFileSync(envFile));

  const postsDir        = path.join(siteDir, 'content', 'posts');
  const privatePostsDir = path.join(siteDir, 'content', 'private-posts');
  const pagesDir        = path.join(siteDir, 'content', 'pages');
  let postCount  = 0;
  if (fs.existsSync(postsDir)) {
    postCount = fs.readdirSync(postsDir).filter(f => f.endsWith('.md') && !f.startsWith('.')).length;
  }
  let privatePostCount = 0;
  if (fs.existsSync(privatePostsDir)) {
    privatePostCount = fs.readdirSync(privatePostsDir).filter(f => f.endsWith('.md') && !f.startsWith('.')).length;
  }
  let pageCount = 0;
  if (fs.existsSync(pagesDir)) {
    pageCount = fs.readdirSync(pagesDir).filter(f => f.endsWith('.md') && !f.startsWith('.')).length;
  }

  return {
    domain,
    dir:             siteDir,
    postsDir,
    privatePostsDir,
    pagesDir,
    url:         cfg.SITE_URL         || `https://${domain}`,
    title:       cfg.SITE_TITLE       || domain,
    description: cfg.SITE_DESCRIPTION || '',
    author:      cfg.SITE_AUTHOR      || '',
    hideAuthor:  cfg.HIDE_AUTHOR === 'true',
    gaId:        cfg.GA_ID || '',
    port:        cfg.PORT             || '?',
    adminKey:    cfg.ADMIN_KEY        || '',
    s3Bucket:    cfg.S3_BUCKET        || '',
    awsRegion:   cfg.AWS_REGION       || 'us-east-1',
    awsKey:      cfg.AWS_ACCESS_KEY_ID     || '',
    awsSecret:   cfg.AWS_SECRET_ACCESS_KEY || '',
    postCount,
    privatePostCount,
    pageCount,
    status:      serviceStatus(domain),
    serviceName: `blog-${domain.replace(/\./g, '-')}`,
  };
}

// ── systemctl helpers ─────────────────────────────────────────────────────────
function serviceStatus(domain) {
  const svc = `blog-${domain.replace(/\./g, '-')}`;
  try {
    const out = execSync(`systemctl is-active ${svc} 2>/dev/null`, { timeout: 3000 }).toString().trim();
    return out; // 'active', 'inactive', 'failed', etc.
  } catch {
    return 'inactive';
  }
}

function restartService(domain) {
  const svc = `blog-${domain.replace(/\./g, '-')}`;
  execSync(`systemctl restart ${svc}`, { timeout: 10000 });
}

function stopService(domain) {
  const svc = `blog-${domain.replace(/\./g, '-')}`;
  execSync(`systemctl stop ${svc} && systemctl disable ${svc}`, { timeout: 10000 });
}

function startService(domain) {
  const svc = `blog-${domain.replace(/\./g, '-')}`;
  execSync(`systemctl enable ${svc} && systemctl start ${svc}`, { timeout: 10000 });
}

// ── Service logs ──────────────────────────────────────────────────────────────
function serviceLogs(domain, lines = 50) {
  const svc = `blog-${domain.replace(/\./g, '-')}`;
  try {
    return execSync(`journalctl -u ${svc} -n ${lines} --no-pager --output=short-iso 2>/dev/null`, {
      timeout: 5000,
    }).toString();
  } catch {
    return '(no logs available)';
  }
}

// ── Post cache bust ───────────────────────────────────────────────────────────
async function bustCache(site) {
  const url = `http://127.0.0.1:${site.port}/_bust`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'X-Admin-Key': site.adminKey },
  });
  return res.ok;
}

// ── Save site settings (.env) ─────────────────────────────────────────────────
function saveSettings(domain, changes) {
  const siteDir = path.join(SITES_ROOT, domain);
  const envFile = path.join(siteDir, '.env');

  const raw     = fs.readFileSync(envFile, 'utf8');
  const allowed = [
    'SITE_TITLE', 'SITE_DESCRIPTION', 'SITE_AUTHOR', 'SITE_URL', 'HIDE_AUTHOR',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET',
    'GA_ID',
  ];

  let updated = raw;
  for (const key of allowed) {
    if (!(key in changes)) continue;
    const val = changes[key];
    const re  = new RegExp(`^(${key}=).*$`, 'm');
    if (re.test(updated)) {
      updated = updated.replace(re, `$1${val}`);
    } else {
      updated += `\n${key}=${val}`;
    }
  }

  fs.writeFileSync(envFile, updated, 'utf8');
}

module.exports = { getAll, getSite, saveSettings, restartService, stopService, startService, serviceLogs, bustCache };
