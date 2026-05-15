'use strict';

const express      = require('express');
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');
const sitesLib     = require('../lib/sites');
const gitLib       = require('../lib/git');
const router       = express.Router();

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

// GET /sites — single-site dashboard
router.get('/', (req, res) => {
  const site    = req.site;
  const logs    = sitesLib.serviceLogs(site.domain, 30);
  const sslInfo = getSslInfo(site.domain);
  const commits = gitLib.log(site, 10);
  res.render('site', { site, logs, sslInfo, commits, flash: req.flash() });
});

// POST /sites/restart
router.post('/restart', (req, res) => {
  try {
    sitesLib.restartService(req.site.domain);
    req.flash('success', 'Service restarted');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/sites');
});

// POST /sites/bust-cache
router.post('/bust-cache', async (req, res) => {
  try {
    await sitesLib.bustCache(req.site);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /sites/history — git history
router.get('/history', (req, res) => {
  const site    = req.site;
  const commits = gitLib.log(site, 50);
  res.render('history', { site, commits, flash: req.flash() });
});

// GET /sites/history/:hash — commit detail
router.get('/history/:hash', (req, res) => {
  const site = req.site;
  let detail = '';
  let files  = [];
  try {
    detail = execSync(`git -C ${site.dir} show --stat ${req.params.hash}`, { timeout: 5000 }).toString();
    const nameOnly = execSync(`git -C ${site.dir} show --name-only --format="" ${req.params.hash}`, { timeout: 5000 }).toString();
    files = nameOnly.trim().split('\n').filter(Boolean);
  } catch {}
  res.render('history-commit', { site, hash: req.params.hash, detail, files, flash: req.flash() });
});

// POST /sites/history/:hash/restore — restore a file from a commit
router.post('/history/:hash/restore', (req, res) => {
  const site = req.site;
  const { file } = req.body;
  try {
    execSync(`git -C ${site.dir} checkout ${req.params.hash} -- ${file}`, { timeout: 5000 });
    gitLib.autoCommit(site, `Restore ${file} from ${req.params.hash}`);
    sitesLib.bustCache(site).catch(() => {});
    req.flash('success', `Restored: ${file}`);
  } catch (e) {
    req.flash('error', `Restore failed: ${e.message.split('\n')[0]}`);
  }
  res.redirect(`/sites/history/${req.params.hash}`);
});

// GET /sites/css — CSS editor
router.get('/css', (req, res) => {
  const site    = req.site;
  const cssFile = path.join(site.dir, 'public', 'css', 'custom.css');
  const css     = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8') : '';
  res.render('css-edit', { site, css, flash: req.flash() });
});

// POST /sites/css — save CSS
router.post('/css', (req, res) => {
  const site    = req.site;
  const cssFile = path.join(site.dir, 'public', 'css', 'custom.css');
  fs.mkdirSync(path.dirname(cssFile), { recursive: true });
  const cssTmp = cssFile + '.tmp';
  fs.writeFileSync(cssTmp, req.body.css || '', { mode: 0o640 });
  fs.renameSync(cssTmp, cssFile);
  try { execSync('chown www-data:www-data ' + cssFile); } catch {}
  gitLib.autoCommit(site, 'Update custom CSS');
  sitesLib.restartService(site.domain);
  req.flash('success', 'CSS saved — service restarted');
  res.redirect('/sites/css');
});

module.exports = router;
