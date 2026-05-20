'use strict';

const express      = require('express');
const fs           = require('fs');
const { execSync } = require('child_process');
const router       = express.Router();

function run(cmd) {
  try { return execSync(cmd, { timeout: 10000 }).toString(); }
  catch (e) { return (e.stdout || e.stderr || e.message || '').toString(); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nginxSites() {
  try {
    return fs.readdirSync('/var/log/nginx')
      .filter(f => f.endsWith('.access.log') && !f.startsWith('access'))
      .map(f => f.replace('.access.log', ''))
      .sort();
  } catch { return []; }
}

function journalServices() {
  const base = ['andresanz', 'andresanz-admin', 'andresanz-deploy', 'nginx', 'redis', 'fail2ban', 'postfix', 'ssh', 'cron'];
  return base;
}

function logFileSize(path) {
  try {
    const b = fs.statSync(path).size;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  } catch { return '—'; }
}

function nginxLogFiles() {
  const dir = '/var/log/nginx';
  try {
    return fs.readdirSync(dir).sort().map(f => ({
      name: f,
      size: logFileSize(`${dir}/${f}`),
      compressed: f.endsWith('.gz'),
    }));
  } catch { return []; }
}

function logDiskUsage() {
  return run('du -sh /var/log 2>/dev/null').split('\t')[0] || '?';
}

// ── GET /logs ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('logs', {
    sites:    nginxSites(),
    services: journalServices(),
    flash:    req.flash(),
  });
});

// ── GET /logs/fetch  (JSON — log content) ─────────────────────────────────────
// ?source=nginx&site=914.io&type=access&lines=100
// ?source=journal&service=nginx&lines=100
// ?source=sysfile&file=syslog&lines=100
router.get('/fetch', (req, res) => {
  const source = req.query.source || 'journal';
  const lines  = Math.min(parseInt(req.query.lines) || 100, 1000);
  let content  = '';

  if (source === 'nginx') {
    const site = (req.query.site || '').replace(/[^a-zA-Z0-9._-]/g, '');
    const type = req.query.type === 'error' ? 'error' : 'access';
    const file = `/var/log/nginx/${site}.${type}.log`;
    content = fs.existsSync(file) ? run(`tail -n ${lines} "${file}"`) : `No log at ${file}`;
  } else if (source === 'journal') {
    const svc = (req.query.service || 'nginx').replace(/[^a-zA-Z0-9@._-]/g, '');
    content = run(`journalctl -u ${svc} -n ${lines} --no-pager --output=short-iso 2>/dev/null`);
  } else if (source === 'sysfile') {
    const allowed = ['syslog', 'auth.log', 'ufw.log', 'mail.log', 'kern.log',
                     'fail2ban.log', 'letsencrypt/letsencrypt.log',
                     'unattended-upgrades/unattended-upgrades.log',
                     'nginx/modsec_audit.log'];
    const file = req.query.file || '';
    if (!allowed.includes(file)) return res.json({ content: 'File not allowed' });
    const full = `/var/log/${file}`;
    content = fs.existsSync(full) ? run(`tail -n ${lines} "${full}"`) : `No file at ${full}`;
  }

  res.json({ content });
});

// ── GET /logs/rotation ────────────────────────────────────────────────────────
router.get('/rotation', (req, res) => {
  const nginxConf  = '/etc/logrotate.d/nginx';
  const modsecConf = '/etc/logrotate.d/modsec';
  const files      = nginxLogFiles();
  const diskUsed   = logDiskUsage();
  const journalSize = run('journalctl --disk-usage 2>/dev/null').trim();
  res.json({
    config:       fs.existsSync(nginxConf)  ? fs.readFileSync(nginxConf,  'utf8') : '',
    modsecConfig: fs.existsSync(modsecConf) ? fs.readFileSync(modsecConf, 'utf8') : '',
    files, diskUsed, journalSize,
  });
});

// ── POST /logs/rotation/save ──────────────────────────────────────────────────
router.post('/rotation/save', express.json(), (req, res) => {
  const { config, modsecConfig, target } = req.body;
  const confPath = target === 'modsec' ? '/etc/logrotate.d/modsec' : '/etc/logrotate.d/nginx';
  const content  = target === 'modsec' ? modsecConfig : config;
  if (!content || !content.trim()) return res.json({ ok: false, error: 'Empty config' });
  try {
    fs.writeFileSync(confPath, content, 'utf8');
    const test = run(`logrotate --debug ${confPath} 2>&1`);
    res.json({ ok: true, test: test.slice(0, 500) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── POST /logs/rotate ─────────────────────────────────────────────────────────
router.post('/rotate', (req, res) => {
  const out1 = run('sudo logrotate -f /etc/logrotate.d/nginx 2>&1');
  const out2 = fs.existsSync('/etc/logrotate.d/modsec') ? run('sudo logrotate -f /etc/logrotate.d/modsec 2>&1') : '';
  res.json({ ok: true, output: [out1, out2].filter(Boolean).join('\n') || '(no output — rotation complete)' });
});

// ── POST /logs/journal/vacuum ─────────────────────────────────────────────────
router.post('/journal/vacuum', express.json(), (req, res) => {
  const days = parseInt(req.body.days) || 30;
  const out  = run(`journalctl --vacuum-time=${days}d 2>&1`);
  res.json({ ok: true, output: out.slice(0, 500) });
});

module.exports = router;
