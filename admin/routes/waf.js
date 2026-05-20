'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { execSync } = require('child_process');
const router   = express.Router();

const MODSEC_DIR   = '/etc/nginx/modsec';
const MODE_CONF    = path.join(MODSEC_DIR, 'mode.conf');
const CUSTOM_RULES = path.join(MODSEC_DIR, 'custom-rules.conf');
const AUDIT_LOG    = '/var/log/nginx/modsec_audit.log';
const EXCL_FILE    = path.join(__dirname, '..', 'data', 'waf-exclusions.json');

function run(cmd) {
  try { return execSync(cmd, { timeout: 8000 }).toString().trim(); }
  catch (e) { return ''; }
}

function isInstalled() {
  return fs.existsSync(MODE_CONF);
}

function getMode() {
  try {
    const m = fs.readFileSync(MODE_CONF, 'utf8').match(/SecRuleEngine\s+(\S+)/);
    return m ? m[1] : 'Unknown';
  } catch { return 'Unknown'; }
}

function setMode(mode) {
  fs.writeFileSync(MODE_CONF, `SecRuleEngine ${mode}\n`, 'utf8');
  run('sudo systemctl reload nginx');
}

function getExclusions() {
  try { return JSON.parse(fs.readFileSync(EXCL_FILE, 'utf8')); }
  catch { return []; }
}

function saveExclusions(list) {
  fs.mkdirSync(path.dirname(EXCL_FILE), { recursive: true });
  fs.writeFileSync(EXCL_FILE, JSON.stringify(list, null, 2), 'utf8');
  const lines = ['# Custom exclusions managed by admin panel — do not edit manually'];
  let nextId = 9001;
  for (const e of list) {
    const id = e.id || nextId++;
    if (e.type === 'ip')   lines.push(`SecRule REMOTE_ADDR "@ipMatch ${e.value}" "id:${id},phase:1,pass,nolog,ctl:ruleEngine=Off"`);
    if (e.type === 'rule') lines.push(`SecRuleRemoveById ${e.value}`);
    if (e.type === 'path') lines.push(`SecRule REQUEST_URI "@beginsWith ${e.value}" "id:${id},phase:1,pass,nolog,ctl:ruleEngine=Off"`);
    if (e.type === 'uri')  lines.push(`SecRuleRemoveByTag "attack" "chain"\nSecRule REQUEST_URI "@contains ${e.value}" "t:none"`);
  }
  fs.writeFileSync(CUSTOM_RULES, lines.join('\n') + '\n', 'utf8');
  run('sudo systemctl reload nginx');
}

function getEvents(limit = 200) {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  try {
    const raw = execSync(`tail -n 5000 "${AUDIT_LOG}" 2>/dev/null`, { timeout: 5000 }).toString();
    const events = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const tx  = obj.transaction || obj;
        if (!tx) continue;
        const msgs = (tx.messages || []).filter(m => m && m.details && m.details.ruleId);
        if (!msgs.length) continue;
        events.push({
          time:     tx.time || tx.timestamp || '',
          id:       tx.id || '',
          ip:       tx.client_ip || tx.clientIp || '',
          method:   (tx.request || {}).method || '',
          uri:      (tx.request || {}).uri || '',
          status:   (tx.response || {}).http_code || (tx.response || {}).status || '',
          messages: msgs.map(m => ({
            id:       m.details.ruleId || '',
            msg:      m.message || '',
            severity: m.details.severity || '',
            tags:     m.details.tags || [],
          })),
        });
      } catch {}
    }
    return events.reverse().slice(0, limit);
  } catch { return []; }
}

function getStats(events) {
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = events.filter(e => e.time && e.time.startsWith(today)).length;
  const ipMap = {}, ruleMap = {};
  for (const e of events) {
    if (e.ip) ipMap[e.ip] = (ipMap[e.ip] || 0) + 1;
    for (const m of e.messages) {
      if (m.id) ruleMap[m.id] = (ruleMap[m.id] || 0) + 1;
    }
  }
  return {
    today:    todayCount,
    total:    events.length,
    topIps:   Object.entries(ipMap).sort((a,b) => b[1]-a[1]).slice(0,5),
    topRules: Object.entries(ruleMap).sort((a,b) => b[1]-a[1]).slice(0,5),
  };
}

// ── GET /waf ──────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const installed  = isInstalled();
  const mode       = installed ? getMode() : null;
  const events     = installed ? getEvents(200) : [];
  const exclusions = getExclusions();
  const stats      = getStats(events);
  res.render('waf', { site: req.site, installed, mode, events, exclusions, stats, flash: req.flash() });
});

// ── GET /waf/events (JSON poll) ───────────────────────────────────────────────
router.get('/events', (req, res) => {
  res.json(getEvents(50));
});

// ── POST /waf/mode ────────────────────────────────────────────────────────────
router.post('/mode', (req, res) => {
  const { mode } = req.body;
  if (!['On', 'Off', 'DetectionOnly'].includes(mode)) {
    req.flash('error', 'Invalid mode');
    return res.redirect('/waf');
  }
  try {
    setMode(mode);
    req.flash('success', `WAF set to ${mode === 'On' ? 'Blocking' : mode === 'DetectionOnly' ? 'Detection' : 'Off'}`);
  } catch (e) {
    req.flash('error', 'Failed to set mode: ' + e.message);
  }
  res.redirect('/waf');
});

// ── POST /waf/exclusions/add ──────────────────────────────────────────────────
router.post('/exclusions/add', (req, res) => {
  const { type, value, note } = req.body;
  if (!type || !value) { req.flash('error', 'Type and value required'); return res.redirect('/waf'); }
  const list   = getExclusions();
  const nextId = 9000 + list.length + 1;
  list.push({ id: nextId, type, value: value.trim(), note: (note || '').trim(), createdAt: new Date().toISOString() });
  try {
    saveExclusions(list);
    req.flash('success', 'Exclusion added — nginx reloaded');
  } catch (e) {
    req.flash('error', 'Failed: ' + e.message);
  }
  res.redirect('/waf');
});

// ── POST /waf/exclusions/delete ───────────────────────────────────────────────
router.post('/exclusions/delete', (req, res) => {
  const { id } = req.body;
  const list = getExclusions().filter(e => String(e.id) !== String(id));
  try {
    saveExclusions(list);
    req.flash('success', 'Exclusion removed');
  } catch (e) {
    req.flash('error', 'Failed: ' + e.message);
  }
  res.redirect('/waf');
});

module.exports = router;
