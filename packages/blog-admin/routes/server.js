'use strict';

const express    = require('express');
const { execSync, exec } = require('child_process');
const fs         = require('fs');
const router     = express.Router();

// Services to manage (in display order)
const MANAGED_SERVICES = [
  { name: 'blog-admin',   label: 'Blog Admin', group: 'web'  },
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
    const names = (jailList.match(/Jail list:s+(.+)/) || ['',''])[1].split(',').map(s=>s.trim()).filter(Boolean);
    for (const jail of names) {
      try {
        const out = run(`fail2ban-client status ${jail} 2>/dev/null`);
        const banned  = parseInt((out.match(/Currently banned:s+(\d+)/) || [0,0])[1]);
        const total   = parseInt((out.match(/Total banned:s+(\d+)/)     || [0,0])[1]);
        const failed  = parseInt((out.match(/Currently failed:s+(\d+)/) || [0,0])[1]);
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
    const lines = run("ps -eo pid,rss,args | grep 'node.*app.js' | grep -v grep").split('\n').filter(Boolean);
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      const pid   = parts[0];
      const rss   = parseInt(parts[1]) || 0;
      const args  = parts.slice(2).join(' ');
      const limitMatch = args.match(/--max-old-space-size=(\d+)/);
      const limit = limitMatch ? limitMatch[1]+'MB' : 'none';
      // derive name from cwd via /proc
      let name = 'node';
      try { name = require('fs').readlinkSync(`/proc/${pid}/cwd`).split('/').pop(); } catch {}
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
  res.render('server', { stats, services, blogServices, nodeMemInfo, flash: req.flash() });
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
    run(`systemctl ${action} ${name}`);
    req.flash('success', `${name} ${action}ed`);
  } catch (e) {
    req.flash('error', `Failed: ${e.message}`);
  }
  res.redirect('/server');
});

// ── GET /server/logs?service=nginx&lines=100 ──────────────────────────────────
router.get('/logs', (req, res) => {
  const service = (req.query.service || 'nginx').replace(/[^a-zA-Z0-9@._-]/g, '');
  const lines   = Math.min(parseInt(req.query.lines) || 100, 500);
  const logs    = run(`journalctl -u ${service} -n ${lines} --no-pager --output=short-iso 2>/dev/null`);

  const allServices = [
    ...MANAGED_SERVICES.map(s => s.name),
    ...run("systemctl list-units 'blog-*' --type=service --no-pager --no-legend")
      .split('\n').filter(Boolean).map(l => l.trim().split(/\s+/)[0].replace('.service',''))
  ];

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ logs });
  }
  res.render('server-logs', { logs, service, lines, allServices, flash: req.flash() });
});

// ── POST /server/nginx/reload ─────────────────────────────────────────────────
router.post('/nginx/reload', (req, res) => {
  const test = run('nginx -t 2>&1');
  if (test.includes('failed')) {
    req.flash('error', `nginx config error: ${test}`);
  } else {
    run('systemctl reload nginx');
    req.flash('success', 'Nginx reloaded');
  }
  res.redirect('/server');
});

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

  const testResult = run('nginx -t 2>&1');
  const testOk = testResult.includes('test is successful');

  res.render('server-nginx', { sites, selected, config, testResult, testOk, flash: req.flash() });
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
  const test = run('nginx -t 2>&1');
  if (test.includes('failed')) {
    req.flash('error', `Saved but nginx test failed: ${test}`);
  } else {
    run('systemctl reload nginx');
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
  const test = run('nginx -t 2>&1');
  if (!test.includes('failed')) run('systemctl reload nginx');
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

// ── POST /server/deploy ───────────────────────────────────────────────────────
router.post('/deploy', (req, res) => {
  const script = require('path').join(__dirname, '../scripts/deploy.sh');
  exec(`bash ${script}`, { timeout: 60000 }, (err, stdout, stderr) => {
    const output = (stdout + stderr).trim();
    req.flash(err ? 'error' : 'success', output || (err ? 'Deploy failed' : 'Already up to date'));
    res.redirect('/server');
  });
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

module.exports = router;
