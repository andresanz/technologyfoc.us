'use strict';

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');
const dotenv       = require('dotenv');

const SITES_ROOT   = process.env.SITES_ROOT || '/var/www';
const SKIP_DIRS    = new Set(['blog-core', 'blog-admin', 'html', 'certbot', 'server02']);

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

// ── Discover sub-sites (live under /var/www/<main>/sites/<sub>) ──────────────
// Returns lightweight entries [{domain, parent, dir}] — useful for switcher UI
function getSubSites(parent = 'andresanz.com') {
  const subDir = path.join(SITES_ROOT, parent, 'sites');
  if (!fs.existsSync(subDir)) return [];
  return fs.readdirSync(subDir)
    .filter(name => {
      const dir = path.join(subDir, name);
      return fs.statSync(dir).isDirectory() &&
             fs.existsSync(path.join(dir, 'app.js'));
    })
    .map(name => getSite(name)) // getSite resolves via path detection below
    .filter(Boolean)
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

// ── All editable sites: main + sub-sites ─────────────────────────────────────
function getEditable(main = 'andresanz.com') {
  const result = [];
  const mainSite = getSite(main);
  if (mainSite) result.push(mainSite);
  result.push(...getSubSites(main));
  return result;
}

// ── Resolve a site directory for a given domain ──────────────────────────────
// Checks /var/www/<domain> first, then /var/www/andresanz.com/sites/<domain>
function resolveSiteDir(domain) {
  const direct = path.join(SITES_ROOT, domain);
  if (fs.existsSync(path.join(direct, '.env'))) return direct;
  const sub = path.join(SITES_ROOT, 'andresanz.com', 'sites', domain);
  if (fs.existsSync(path.join(sub, '.env'))) return sub;
  return null;
}

// ── Get a single site by domain ───────────────────────────────────────────────
function getSite(domain) {
  const siteDir = resolveSiteDir(domain);
  if (!siteDir) return null;
  const envFile = path.join(siteDir, '.env');

  if (!fs.existsSync(envFile)) return null;

  const cfg = dotenv.parse(fs.readFileSync(envFile));

  const postsDir         = path.join(siteDir, 'content', 'posts');
  const privatePostsDir  = path.join(siteDir, 'content', 'private-posts');
  const pagesDir         = path.join(siteDir, 'content', 'pages');
  const privatePagesDir  = path.join(siteDir, 'content', 'private-pages');
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
    privatePagesDir,
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
    cdnUrl:      cfg.CDN_URL          || '',
    postCount,
    privatePostCount,
    pageCount,
    status:      serviceStatus(domain),
    serviceName: domain === 'andresanz.com' ? 'andresanz' : `blog-${domain.replace(/\./g, '-')}`,
    bustCache:   () => bustCache({ port: cfg.PORT || '3000', adminKey: cfg.ADMIN_KEY || '' }),
  };
}

// ── systemctl helpers ─────────────────────────────────────────────────────────
function svcName(domain) {
  return domain === 'andresanz.com' ? 'andresanz' : `blog-${domain.replace(/\./g, '-')}`;
}

function serviceStatus(domain) {
  const svc = svcName(domain);
  try {
    const out = execSync(`systemctl is-active ${svc} 2>/dev/null`, { timeout: 3000 }).toString().trim();
    return out; // 'active', 'inactive', 'failed', etc.
  } catch {
    return 'inactive';
  }
}

function restartService(domain) {
  execSync(`sudo systemctl restart ${svcName(domain)}`, { timeout: 10000 });
}

function stopService(domain) {
  const svc = svcName(domain);
  execSync(`sudo systemctl stop ${svc} && sudo systemctl disable ${svc}`, { timeout: 10000 });
}

function startService(domain) {
  const svc = svcName(domain);
  execSync(`sudo systemctl enable ${svc} && sudo systemctl start ${svc}`, { timeout: 10000 });
}

// ── Service logs ──────────────────────────────────────────────────────────────
function serviceLogs(domain, lines = 50) {
  const svc = svcName(domain);
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

// ── Change a site's port (.env + nginx config) ────────────────────────────────
function savePort(domain, newPort) {
  const port = parseInt(newPort, 10);
  if (!port || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535');

  const conflict = getAll().find(s => s.domain !== domain && parseInt(s.port, 10) === port);
  if (conflict) throw new Error(`Port ${port} is already used by ${conflict.domain}`);

  const envFile = path.join(SITES_ROOT, domain, '.env');
  const raw     = fs.readFileSync(envFile, 'utf8');
  const re      = /^(PORT=).*$/m;
  const updated = re.test(raw) ? raw.replace(re, `PORT=${port}`) : `${raw}\nPORT=${port}`;
  fs.writeFileSync(envFile, updated, 'utf8');

  const nginxConf = `/etc/nginx/sites-available/${domain}`;
  if (fs.existsSync(nginxConf)) {
    const nginx        = fs.readFileSync(nginxConf, 'utf8');
    const nginxUpdated = nginx.replace(
      /proxy_pass\s+http:\/\/127\.0\.0\.1:\d+/g,
      `proxy_pass http://127.0.0.1:${port}`
    );
    if (nginxUpdated !== nginx) {
      fs.writeFileSync(nginxConf, nginxUpdated, 'utf8');
      execSync('nginx -t && systemctl reload nginx', { timeout: 10000 });
    }
  }
}

// ── Read the proxy_pass port from the nginx config ────────────────────────────
function nginxPort(domain) {
  try {
    const conf  = fs.readFileSync(`/etc/nginx/sites-available/${domain}`, 'utf8');
    const match = conf.match(/proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

module.exports = { getAll, getSite, getSubSites, getEditable, resolveSiteDir, saveSettings, savePort, nginxPort, restartService, stopService, startService, serviceLogs, bustCache };
