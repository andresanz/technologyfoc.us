'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const http     = require('http');
const { execSync } = require('child_process');
const router   = express.Router();

// ── Geo / flag lookup ─────────────────────────────────────────────────────────
const geoCache = new Map(); // ip → { cc, country, ts }
const GEO_TTL  = 7 * 24 * 60 * 60 * 1000;
const PRIVATE  = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/;

function lookupGeo(ip) {
  return new Promise(resolve => {
    if (!ip || PRIVATE.test(ip)) return resolve({ cc: '', country: '' });
    const cached = geoCache.get(ip);
    if (cached && Date.now() - cached.ts < GEO_TTL) return resolve(cached);
    const req = http.get(`http://ip-api.com/json/${ip}?fields=countryCode,country`, { timeout: 3000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j  = JSON.parse(d);
          const cc = (j.countryCode || '').slice(0, 2).toUpperCase();
          const country = j.country || '';
          const geo = /^[A-Z]{2}$/.test(cc) ? { cc, country, ts: Date.now() } : { cc: '', country: '', ts: Date.now() };
          geoCache.set(ip, geo);
          resolve(geo);
        } catch { resolve({ cc: '', country: '' }); }
      });
    });
    req.on('error', () => resolve({ cc: '', country: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ cc: '', country: '' }); });
  });
}

function ccToFlag(cc) {
  if (!cc || cc.length !== 2) return '';
  return [...cc].map(c => String.fromCodePoint(c.charCodeAt(0) + 127397)).join('');
}

async function addGeo(events) {
  const ips  = [...new Set(events.map(e => e.ip).filter(Boolean))];
  const geos = await Promise.all(ips.map(lookupGeo));
  const map  = Object.fromEntries(ips.map((ip, i) => [ip, geos[i]]));
  return events.map(e => {
    const g = map[e.ip] || { cc: '', country: '' };
    return { ...e, cc: g.cc, country: g.country, flag: ccToFlag(g.cc) };
  });
}

const MODSEC_DIR   = '/etc/nginx/modsec';
const MODE_CONF    = path.join(MODSEC_DIR, 'mode.conf');
const CUSTOM_RULES = path.join(MODSEC_DIR, 'custom-rules.conf');
const BLOCK_RULES  = path.join(MODSEC_DIR, 'block-rules.conf');
const AUDIT_LOG    = '/var/log/nginx/modsec_audit.log';
const EXCL_FILE    = path.join(__dirname, '..', 'data', 'waf-exclusions.json');
const BLOCK_FILE   = path.join(__dirname, '..', 'data', 'waf-blocks.json');

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

function getBlocks() {
  try { return JSON.parse(fs.readFileSync(BLOCK_FILE, 'utf8')); }
  catch { return []; }
}

function saveBlocks(list) {
  fs.mkdirSync(path.dirname(BLOCK_FILE), { recursive: true });
  fs.writeFileSync(BLOCK_FILE, JSON.stringify(list, null, 2), 'utf8');
  const lines = ['# Block rules managed by admin panel — do not edit manually'];
  let id = 9500;
  for (const b of list) {
    const bid = b.id || id++;
    if (b.type === 'uri')  lines.push(`SecRule REQUEST_URI "@contains ${b.value}" "id:${bid},phase:1,deny,status:403,log,msg:'Blocked URI: ${b.note || b.value}'"`);
    if (b.type === 'ip')   lines.push(`SecRule REMOTE_ADDR "@ipMatch ${b.value}" "id:${bid},phase:1,deny,status:403,log,msg:'Blocked IP: ${b.note || b.value}'"`);
    if (b.type === 'ua')   lines.push(`SecRule REQUEST_HEADERS:User-Agent "@contains ${b.value}" "id:${bid},phase:1,deny,status:403,log,msg:'Blocked UA: ${b.note || b.value}'"`);
  }
  fs.writeFileSync(BLOCK_RULES, lines.join('\n') + '\n', 'utf8');
  run('sudo systemctl reload nginx');
}

const MONTHS = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
function parseModSecTime(raw) {
  if (!raw) return '';
  // ModSec3 format: "Wed May 20 14:53:10 2026"
  const m = raw.match(/\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})/);
  if (m) return `${m[4]}-${String(MONTHS[m[1]]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')} ${m[3]}`;
  // Apache format: 20/May/2026:14:47:45.123 -0400
  const m2 = raw.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2})/);
  if (m2) return `${m2[3]}-${String(MONTHS[m2[2]]).padStart(2,'0')}-${m2[1]} ${m2[4]}`;
  // ISO format fallback
  return raw.slice(0,19).replace('T',' ');
}

function getTimeline() {
  try {
    // Pull only the time_stamp field — fast, no full JSON parse
    const raw = execSync(
      `sudo /usr/bin/tail -n +1 "${AUDIT_LOG}" 2>/dev/null | grep -o '"time_stamp":"[^"]*"'`,
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 }
    ).toString();
    const MO = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    const counts = {};
    for (const line of raw.split('\n')) {
      // "Wed May 21 10:05:47 2026"
      const m = line.match(/(\w{3})\s+(\d{1,2})\s+\d{2}:\d{2}:\d{2}\s+(\d{4})/);
      if (m) {
        const date = `${m[3]}-${MO[m[1]] || '00'}-${String(m[2]).padStart(2,'0')}`;
        counts[date] = (counts[date] || 0) + 1;
      }
    }
    const sorted = Object.entries(counts).sort(([a],[b]) => a.localeCompare(b)).slice(-30);
    return { labels: sorted.map(([d]) => d), counts: sorted.map(([,c]) => c) };
  } catch { return { labels: [], counts: [] }; }
}

function getTotalEventCount() {
  try {
    const out = execSync(`sudo /usr/bin/tail -n +1 "${AUDIT_LOG}" 2>/dev/null | wc -l`, { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }).toString().trim();
    return parseInt(out) || 0;
  } catch { return 0; }
}

function getEvents(limit = 200) {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  try {
    const raw = execSync(`tail -n 2000 "${AUDIT_LOG}" 2>/dev/null`, { timeout: 5000, maxBuffer: 20 * 1024 * 1024 }).toString();
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
          time:     parseModSecTime(tx.time_stamp || tx.time || tx.timestamp || ''),
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

function getStats(events, totalInLog = 0) {
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = events.filter(e => e.time && e.time.startsWith(today)).length;
  const ipMap = {}, ipMeta = {}, ruleMap = {};
  for (const e of events) {
    if (e.ip) {
      ipMap[e.ip] = (ipMap[e.ip] || 0) + 1;
      if (!ipMeta[e.ip]) ipMeta[e.ip] = { flag: e.flag || '', country: e.country || '' };
    }
    for (const m of e.messages) {
      if (m.id) ruleMap[m.id] = (ruleMap[m.id] || 0) + 1;
    }
  }
  return {
    today:    todayCount,
    loaded:   events.length,
    total:    totalInLog,
    topIps:   Object.entries(ipMap).sort((a,b) => b[1]-a[1]).slice(0,5)
                .map(([ip, cnt]) => ({ ip, cnt, ...ipMeta[ip] })),
    topRules: Object.entries(ruleMap).sort((a,b) => b[1]-a[1]).slice(0,5),
  };
}

// ── GET /waf/timeline ─────────────────────────────────────────────────────────
router.get('/timeline', (req, res) => {
  res.json(isInstalled() ? getTimeline() : { labels: [], counts: [] });
});

// ── GET /waf ──────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const installed  = isInstalled();
  const mode       = installed ? getMode() : null;
  const raw        = installed ? getEvents(200) : [];
  const events     = await addGeo(raw);
  const exclusions = getExclusions();
  const blocks     = getBlocks();
  const totalInLog = installed ? getTotalEventCount() : 0;
  const stats      = getStats(events, totalInLog);
  res.render('waf', { site: req.site, installed, mode, events, exclusions, blocks, stats, flash: req.flash() });
});

// ── GET /waf/events (JSON poll) ───────────────────────────────────────────────
router.get('/events', async (req, res) => {
  res.json(await addGeo(getEvents(50)));
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
  const maxId  = list.reduce((m, e) => Math.max(m, e.id || 0), 9000);
  const nextId = maxId + 1;
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

// ── POST /waf/blocks/add ──────────────────────────────────────────────────────
router.post('/blocks/add', (req, res) => {
  const { type, value, note } = req.body;
  if (!type || !value) { req.flash('error', 'Type and value required'); return res.redirect('/waf'); }
  const list   = getBlocks();
  const maxId  = list.reduce((m, b) => Math.max(m, b.id || 0), 9500);
  const nextId = maxId + 1;
  list.push({ id: nextId, type, value: value.trim(), note: (note || '').trim(), createdAt: new Date().toISOString() });
  try {
    saveBlocks(list);
    req.flash('success', 'Block rule added — nginx reloaded');
  } catch (e) {
    req.flash('error', 'Failed: ' + e.message);
  }
  res.redirect('/waf');
});

// ── POST /waf/blocks/delete ───────────────────────────────────────────────────
router.post('/blocks/delete', (req, res) => {
  const { id } = req.body;
  const list = getBlocks().filter(b => String(b.id) !== String(id));
  try {
    saveBlocks(list);
    req.flash('success', 'Block rule removed');
  } catch (e) {
    req.flash('error', 'Failed: ' + e.message);
  }
  res.redirect('/waf');
});

module.exports = router;
