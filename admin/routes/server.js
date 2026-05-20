'use strict';

const express    = require('express');
const { execSync, exec } = require('child_process');
const fs         = require('fs');
const path       = require('path');
const sitesLib   = require('../lib/sites');
const gitLib     = require('../lib/git');
const router     = express.Router();

function getSslInfo(domain) {
  try {
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
      expires:  expDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      issued:   startDate ? startDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null,
      daysLeft,
      status:   daysLeft <= 7 ? 'critical' : daysLeft <= 21 ? 'warning' : 'ok',
    };
  } catch { return null; }
}

// Services to manage (in display order)
const MANAGED_SERVICES = [
  { name: 'andresanz-admin', label: 'Admin',  group: 'web'  },
  { name: 'andresanz',       label: 'Site',   group: 'web'  },
  { name: 'nginx',        label: 'Nginx',      group: 'web'  },
  { name: 'redis-server', label: 'Redis',      group: 'data' },
  { name: 'fail2ban',     label: 'Fail2ban',   group: 'sec'  },
  { name: 'postfix',      label: 'Postfix',    group: 'mail' },
  { name: 'ssh',          label: 'SSH',        group: 'sys'  },
  { name: 'cron',         label: 'Cron',       group: 'sys'  },
];

function run(cmd, opts = {}) {
  try { return execSync(cmd, { timeout: 8000, ...opts }).toString().trim(); }
  catch (e) { return (e.stdout || e.stderr || '').toString().trim(); }
}

function svcStatus(name) {
  try {
    execSync(`systemctl is-active ${name}`, { timeout: 3000 });
    return 'active';
  } catch (e) {
    const out = (e.stdout || '').toString().trim();
    return out || 'inactive';
  }
}

function getStats() {
  // Memory
  const memRaw = fs.readFileSync('/proc/meminfo', 'utf8');
  const mem = {};
  for (const line of memRaw.split('\n')) {
    const [k, v] = line.split(':');
    if (k && v) mem[k.trim()] = parseInt(v.trim());
  }
  const memTotal = mem.MemTotal || 0;
  const memAvail = mem.MemAvailable || 0;
  const memUsed  = memTotal - memAvail;

  // Load + uptime
  const loadRaw = fs.readFileSync('/proc/loadavg', 'utf8').split(' ');
  const load1   = parseFloat(loadRaw[0]);
  const load5   = parseFloat(loadRaw[1]);
  const load15  = parseFloat(loadRaw[2]);
  const uptimeSec = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);

  // Disk
  const dfOut = run('df -k / --output=size,used,avail').split('\n')[1].trim().split(/\s+/);
  const diskTotal = parseInt(dfOut[0]);
  const diskUsed  = parseInt(dfOut[1]);

  // CPU count for load normalisation
  const cpus = parseInt(run('nproc')) || 1;

  // Swap
  const swapTotal = mem.SwapTotal || 0;
  const swapFree  = mem.SwapFree  || 0;
  const swapUsed  = swapTotal - swapFree;

  // Volume disk
  let volDiskTotal = 0, volDiskUsed = 0;
  try {
    const volDf = run('df -k /mnt/volume01 --output=size,used,avail 2>/dev/null').split('\n')[1];
    if (volDf) {
      const p = volDf.trim().split(/\s+/);
      volDiskTotal = parseInt(p[0]);
      volDiskUsed  = parseInt(p[1]);
    }
  } catch {}

  // Fail2ban — all jails
  const f2bJails = [];
  try {
    const jailList = run('fail2ban-client status 2>/dev/null');
    const names = (jailList.match(/Jail list:\s+(.+)/) || ['',''])[1].split(',').map(s=>s.trim()).filter(Boolean);
    for (const jail of names) {
      try {
        const out = run(`fail2ban-client status ${jail} 2>/dev/null`);
        const banned  = parseInt((out.match(/Currently banned:\s+(\d+)/) || [0,0])[1]);
        const total   = parseInt((out.match(/Total banned:\s+(\d+)/)     || [0,0])[1]);
        const failed  = parseInt((out.match(/Currently failed:\s+(\d+)/) || [0,0])[1]);
        f2bJails.push({ jail, banned, total, failed });
      } catch {}
    }
  } catch {}
  const f2bBanned = f2bJails.reduce((s,j) => s + j.banned, 0);

  return { memTotal, memUsed, memAvail, load1, load5, load15, uptimeSec, cpus,
           diskTotal, diskUsed, volDiskTotal, volDiskUsed, swapTotal, swapUsed, f2bBanned, f2bJails };
}

// ── Node.js process memory snapshot ─────────────────────────────────────────
function getNodeMem() {
  try {
    const lines = run("ps -eo pid,rss,args | grep -E 'node.*(app|webhook)' | grep -v grep").split('\n').filter(Boolean);
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      const pid   = parts[0];
      const rss   = parseInt(parts[1]) || 0;
      const args  = parts.slice(2).join(' ');
      const limitMatch = args.match(/--max-old-space-size=(\d+)/);
      const limit = limitMatch ? limitMatch[1]+'MB' : 'none';
      // identify by script path
      let name = 'node';
      if (args.includes('admin/app.js'))           name = 'andresanz-admin';
      else if (args.includes('webhook-deploy'))    name = 'andresanz-deploy';
      else if (args.includes('redirect-service'))  name = 'redirect-service';
      else if (args.includes('andresanz.com/app')) name = 'andresanz';
      return { name, limit, rss: Math.round(rss/1024)+'MB' };
    }).sort((a,b)=>a.name.localeCompare(b.name));
  } catch { return []; }
}

// ── GET /server ───────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const stats    = getStats();
  const services = MANAGED_SERVICES.map(s => ({ ...s, status: svcStatus(s.name) }));

  // Blog services
  const blogServices = run("systemctl list-units 'blog-*' --type=service --no-pager --no-legend")
    .split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      return { name: parts[0].replace('.service',''), status: parts[2] };
    });

  const nodeMemInfo = getNodeMem();

  // Site info
  const site     = req.site;
  const sslInfo  = getSslInfo(site.domain);
  const commits  = gitLib.log(site, 10);
  const siteLogs = sitesLib.serviceLogs(site.domain, 30);

  res.render('server', { stats, services, blogServices, nodeMemInfo, site, sslInfo, commits, siteLogs, flash: req.flash() });
});

// ── GET /server/stats (JSON poll) ─────────────────────────────────────────────
router.get('/stats', (req, res) => {
  res.json(getStats());
});

// ── POST /server/service/:name/:action ────────────────────────────────────────
router.post('/service/:name/:action', (req, res) => {
  const { name, action } = req.params;
  if (!['start','stop','restart','reload'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  // Allow blog services too
  const allowed = [...MANAGED_SERVICES.map(s => s.name), 'nginx'];
  const isBlog  = name.startsWith('blog-');
  if (!isBlog && !allowed.includes(name)) {
    return res.status(403).json({ error: 'Service not managed' });
  }
  try {
    run(`sudo systemctl ${action} ${name}`);
    req.flash('success', `${name} ${action}ed`);
  } catch (e) {
    req.flash('error', `Failed: ${e.message}`);
  }
  res.redirect('/server');
});

// ── GET /server/logs — redirect to unified logs page ──────────────────────────
router.get('/logs', (req, res) => {
  const svc = req.query.service;
  if (svc) return res.redirect(`/logs?source=journal&service=${encodeURIComponent(svc)}`);
  res.redirect('/logs');
});

// ── POST /server/nginx/reload ─────────────────────────────────────────────────
router.post('/nginx/reload', (req, res) => {
  const test = run('sudo nginx -t 2>&1');
  if (test.includes('failed')) {
    req.flash('error', `nginx config error: ${test}`);
  } else {
    run('sudo systemctl reload nginx');
    req.flash('success', 'Nginx reloaded');
  }
  res.redirect('/server');
});

const NGINX_CONF = '/etc/nginx/nginx.conf';

function getServerTokens() {
  try {
    const raw = fs.readFileSync(NGINX_CONF, 'utf8');
    const m = raw.match(/^\s*server_tokens\s+(on|off)\s*;/m);
    return m ? m[1] : 'on'; // nginx default is on
  } catch { return 'unknown'; }
}

// ── GET /server/nginx ─────────────────────────────────────────────────────────
router.get('/nginx', (req, res) => {
  const availDir = '/etc/nginx/sites-available';
  const sites = fs.readdirSync(availDir)
    .filter(f => !f.startsWith('.'))
    .sort()
    .map(name => {
      const enabledPath = `/etc/nginx/sites-enabled/${name}`;
      const enabled = fs.existsSync(enabledPath);
      const isSymlink = enabled && fs.lstatSync(enabledPath).isSymbolicLink();
      return { name, enabled, isSymlink };
    });

  const selected = (req.query.site || sites[0]?.name || '').replace(/[^a-zA-Z0-9._-]/g,'');
  let config = '';
  if (selected) {
    try { config = fs.readFileSync(`${availDir}/${selected}`, 'utf8'); } catch {}
  }

  const testResult    = run('sudo nginx -t 2>&1');
  const testOk        = testResult.includes('test is successful');
  const serverTokens  = getServerTokens();

  res.render('server-nginx', { sites, selected, config, testResult, testOk, serverTokens, flash: req.flash() });
});

// ── POST /server/nginx/server-tokens ──────────────────────────────────────────
router.post('/nginx/server-tokens', (req, res) => {
  try {
    let raw = fs.readFileSync(NGINX_CONF, 'utf8');
    const current = getServerTokens();
    const next    = current === 'off' ? 'on' : 'off';

    if (/^\s*server_tokens\s+(on|off)\s*;/m.test(raw)) {
      raw = raw.replace(/^(\s*server_tokens\s+)(on|off)(\s*;)/m, `$1${next}$3`);
    } else {
      // inject after the opening `http {` line
      raw = raw.replace(/(http\s*\{)/, `$1\n    server_tokens ${next};`);
    }

    fs.writeFileSync(NGINX_CONF, raw, 'utf8');
    const test = run('sudo nginx -t 2>&1');
    if (test.includes('failed')) {
      req.flash('error', `nginx test failed — reverted: ${test}`);
      // revert
      raw = raw.replace(/^(\s*server_tokens\s+)(on|off)(\s*;)/m, `$1${current}$3`);
      fs.writeFileSync(NGINX_CONF, raw, 'utf8');
    } else {
      run('sudo systemctl reload nginx');
      req.flash('success', `server_tokens set to ${next}`);
    }
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/server/nginx');
});

// ── POST /server/nginx/save ───────────────────────────────────────────────────
router.post('/nginx/save', (req, res) => {
  const site   = (req.body.site || '').replace(/[^a-zA-Z0-9._-]/g,'');
  const config = req.body.config || '';
  if (!site) { req.flash('error', 'No site specified'); return res.redirect('/server/nginx'); }

  const availPath   = `/etc/nginx/sites-available/${site}`;
  const enabledPath = `/etc/nginx/sites-enabled/${site}`;

  // Write to available
  fs.writeFileSync(availPath, config, 'utf8');

  // If enabled as a flat file (not symlink), update it too
  if (fs.existsSync(enabledPath) && !fs.lstatSync(enabledPath).isSymbolicLink()) {
    fs.writeFileSync(enabledPath, config, 'utf8');
  } else if (!fs.existsSync(enabledPath)) {
    // not enabled — just save available
  }

  // Test config
  const test = run('sudo nginx -t 2>&1');
  if (test.includes('failed')) {
    req.flash('error', `Saved but nginx test failed: ${test}`);
  } else {
    run('sudo systemctl reload nginx');
    req.flash('success', `Saved and reloaded nginx for ${site}`);
  }
  res.redirect(`/server/nginx?site=${site}`);
});

// ── POST /server/nginx/toggle ─────────────────────────────────────────────────
router.post('/nginx/toggle', (req, res) => {
  const site        = (req.body.site || '').replace(/[^a-zA-Z0-9._-]/g,'');
  const availPath   = `/etc/nginx/sites-available/${site}`;
  const enabledPath = `/etc/nginx/sites-enabled/${site}`;
  if (!fs.existsSync(availPath)) { req.flash('error', 'Site not found'); return res.redirect('/server/nginx'); }

  if (fs.existsSync(enabledPath)) {
    fs.unlinkSync(enabledPath);
    req.flash('success', `Disabled ${site}`);
  } else {
    fs.symlinkSync(availPath, enabledPath);
    req.flash('success', `Enabled ${site}`);
  }
  const test = run('sudo nginx -t 2>&1');
  if (!test.includes('failed')) run('sudo systemctl reload nginx');
  res.redirect(`/server/nginx?site=${site}`);
});

// ── POST /server/nginx/test ───────────────────────────────────────────────────
router.post('/nginx/test', (req, res) => {
  const site   = (req.body.site || '').replace(/[^a-zA-Z0-9._-]/g,'');
  const config = req.body.config || '';
  const tmp    = `/tmp/nginx-test-${site}.conf`;
  try {
    fs.writeFileSync(tmp, config);
    const result = run(`nginx -t -c ${tmp} 2>&1`);
    const ok = result.includes('test is successful');
    res.json({ ok, result });
  } catch(e) {
    res.json({ ok: false, result: e.message });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

// ── GET /server/nginx/logs ────────────────────────────────────────────────────
router.get('/nginx/logs', (req, res) => {
  const site = (req.query.site || '').replace(/[^a-zA-Z0-9._-]/g,'');
  const type = req.query.type === 'error' ? 'error' : 'access';
  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  const logFile = `/var/log/nginx/${site}.${type}.log`;
  let logs = '';
  if (fs.existsSync(logFile)) {
    logs = run(`tail -n ${lines} ${logFile}`);
  } else {
    logs = `No ${type} log found at ${logFile}`;
  }
  res.json({ logs });
});

// ── POST /server/updates/check ────────────────────────────────────────────────
router.post('/updates/check', (req, res) => {
  exec('apt-get update -qq && apt list --upgradable 2>/dev/null', { timeout: 60000 }, (err, stdout) => {
    const lines = stdout.split('\n').filter(l => l.includes('[upgradable'));
    if (lines.length === 0) {
      req.flash('success', 'System is up to date');
    } else {
      req.flash('success', `${lines.length} update(s) available: ${lines.slice(0,3).map(l=>l.split('/')[0]).join(', ')}${lines.length > 3 ? '…' : ''}`);
    }
    res.redirect('/server');
  });
});


// ── GET /server/shell ─────────────────────────────────────────────────────────
router.get('/shell', (req, res) => {
  res.render('server-shell-cmd', { flash: req.flash() });
});

// ── POST /server/shell/run ────────────────────────────────────────────────────
router.post('/shell/run', (req, res) => {
  const cmd = (req.body.cmd || '').trim();
  if (!cmd) return res.json({ output: '', code: 0 });
  const appDir = require('path').resolve(__dirname, '..');
  exec(cmd, { timeout: 30000, cwd: appDir }, (err, stdout, stderr) => {
    res.json({
      output: (stdout + stderr).trim(),
      code: err ? (err.code || 1) : 0,
    });
  });
});

// ── POST /server/site/restart ────────────────────────────────────────────────
router.post('/site/restart', (req, res) => {
  try {
    sitesLib.restartService(req.site.domain);
    req.flash('success', 'Service restarted');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/server');
});

// ── POST /server/site/bust-cache ─────────────────────────────────────────────
router.post('/site/bust-cache', async (req, res) => {
  try {
    await sitesLib.bustCache(req.site);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /server/css ───────────────────────────────────────────────────────────
router.get('/css', (req, res) => {
  const site    = req.site;
  const cssFile = path.join(site.dir, 'public', 'css', 'custom.css');
  const css     = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8') : '';
  res.render('css-edit', { site, css, flash: req.flash() });
});

// ── POST /server/css ──────────────────────────────────────────────────────────
router.post('/css', (req, res) => {
  const site    = req.site;
  const cssFile = path.join(site.dir, 'public', 'css', 'custom.css');
  fs.mkdirSync(path.dirname(cssFile), { recursive: true });
  const cssTmp = cssFile + '.tmp';
  fs.writeFileSync(cssTmp, req.body.css || '', { mode: 0o640 });
  fs.renameSync(cssTmp, cssFile);
  try { execSync('chown www-data:www-data ' + cssFile); } catch {}
  gitLib.autoCommit(site, 'Update custom CSS');
  sitesLib.bustCache(site).catch(() => {});
  req.flash('success', 'CSS saved');
  res.redirect('/server/css');
});

// ── GET /server/history ───────────────────────────────────────────────────────
router.get('/history', (req, res) => {
  const site    = req.site;
  const commits = gitLib.log(site, 50);
  res.render('history', { site, commits, flash: req.flash() });
});

// ── GET /server/history/:hash ─────────────────────────────────────────────────
const HASH_RE = /^[a-f0-9]{4,40}$/;
router.get('/history/:hash', (req, res) => {
  const site = req.site;
  if (!HASH_RE.test(req.params.hash)) return res.status(400).render('error', { code: 400, message: 'Invalid hash', site });
  let detail = '';
  let files  = [];
  try {
    detail = execSync(`git -C ${site.dir} show --stat ${req.params.hash}`, { timeout: 5000 }).toString();
    const nameOnly = execSync(`git -C ${site.dir} show --name-only --format="" ${req.params.hash}`, { timeout: 5000 }).toString();
    files = nameOnly.trim().split('\n').filter(Boolean);
  } catch {}
  res.render('history-commit', { site, hash: req.params.hash, detail, files, flash: req.flash() });
});

// ── POST /server/history/:hash/restore ───────────────────────────────────────
router.post('/history/:hash/restore', (req, res) => {
  const site = req.site;
  if (!HASH_RE.test(req.params.hash)) return res.status(400).render('error', { code: 400, message: 'Invalid hash', site });
  const { file } = req.body;
  // Validate file is a safe relative path within the site
  const safeFile = require('path').normalize(file || '').replace(/^(\.\.[/\\])+/, '');
  if (!safeFile || safeFile.includes('\0')) {
    req.flash('error', 'Invalid file path');
    return res.redirect(`/server/history/${req.params.hash}`);
  }
  try {
    execSync(`git -C ${site.dir} checkout ${req.params.hash} -- ${safeFile}`, { timeout: 5000 });
    gitLib.autoCommit(site, `Restore ${safeFile} from ${req.params.hash}`);
    sitesLib.bustCache(site).catch(() => {});
    req.flash('success', `Restored: ${safeFile}`);
  } catch (e) {
    req.flash('error', `Restore failed: ${e.message.split('\n')[0]}`);
  }
  res.redirect(`/server/history/${req.params.hash}`);
});

// ── GET /server/health ────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  let health = null;
  try {
    const raw = fs.readFileSync('/var/log/blog-health.json', 'utf8');
    health = JSON.parse(raw);
  } catch (e) {
    health = null;
  }
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json(health || { error: 'No health data yet' });
  }
  res.render('server-health', { health, flash: req.flash() });
});

// ── GET /server/nav ───────────────────────────────────────────────────────────
router.get('/nav', (req, res) => {
  const site    = req.site;
  const navFile = path.join(site.dir, 'content', 'nav.json');
  let navItems = [], pageNavItems = [];
  try {
    const raw = JSON.parse(fs.readFileSync(navFile, 'utf8'));
    if (Array.isArray(raw)) {
      navItems = raw;
    } else {
      navItems     = raw.nav     || [];
      pageNavItems = raw.pageNav || [];
    }
  } catch {}
  res.render('nav', { site, navItems, pageNavItems, flash: req.flash() });
});

// ── POST /server/nav ──────────────────────────────────────────────────────────
router.post('/nav', async (req, res) => {
  const site    = req.site;
  const navFile = path.join(site.dir, 'content', 'nav.json');
  try {
    const body    = req.body;
    const nav     = Array.isArray(body.nav)     ? body.nav     : JSON.parse(body.nav     || '[]');
    const pageNav = Array.isArray(body.pageNav) ? body.pageNav : JSON.parse(body.pageNav || '[]');
    const out = pageNav.length ? { nav, pageNav } : nav;
    fs.mkdirSync(path.dirname(navFile), { recursive: true });
    fs.writeFileSync(navFile, JSON.stringify(out, null, 2), 'utf8');
    await site.bustCache().catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
