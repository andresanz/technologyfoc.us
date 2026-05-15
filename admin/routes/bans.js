'use strict';

const express    = require('express');
const { execSync } = require('child_process');
const fs         = require('fs');
const router     = express.Router();

const F2B_LOG = '/var/log/fail2ban.log';

function run(cmd) {
  try { return execSync(cmd, { timeout: 8000 }).toString().trim(); }
  catch (e) { return ''; }
}

function getJails() {
  const jails = [];
  const raw = run('sudo sudo fail2ban-client status 2>/dev/null');
  const names = (raw.match(/Jail list:\s+(.+)/) || ['',''])[1]
    .split(',').map(s => s.trim()).filter(Boolean);

  for (const jail of names) {
    const out = run(`sudo fail2ban-client status ${jail} 2>/dev/null`);
    const banned  = parseInt((out.match(/Currently banned:\s+(\d+)/)    || [0,0])[1]) || 0;
    const total   = parseInt((out.match(/Total banned:\s+(\d+)/)         || [0,0])[1]) || 0;
    const failed  = parseInt((out.match(/Currently failed:\s+(\d+)/)    || [0,0])[1]) || 0;
    const ipRaw   = (out.match(/Banned IP list:\s*(.*)/) || ['',''])[1];
    const ips     = ipRaw.trim() ? ipRaw.trim().split(/\s+/) : [];
    jails.push({ jail, banned, total, failed, ips });
  }
  return jails;
}

function getEvents(limit = 200) {
  try {
    const lines = execSync(`tail -n 2000 ${F2B_LOG} 2>/dev/null`).toString().split('\n');
    const events = [];
    // Match: 2026-04-18 21:46:07,236 fail2ban.actions [pid]: NOTICE  [jail] Ban/Unban/Restore Ban IP
    const re = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ fail2ban\.actions\s+\[\d+\]: NOTICE\s+\[([^\]]+)\] (Ban|Unban|Restore Ban|Found) (.+)$/;
    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      const action = m[3];
      if (action === 'Found') continue; // skip noisy found lines
      events.push({
        ts:     m[1],
        jail:   m[2],
        action: action === 'Restore Ban' ? 'restore' : action.toLowerCase(),
        ip:     m[4].trim(),
      });
    }
    return events.reverse().slice(0, limit);
  } catch { return []; }
}

// GET /server/bans
router.get('/', (req, res) => {
  const jails  = getJails();
  const events = getEvents(200);
  res.render('server-bans', { jails, events, flash: req.flash() });
});

// GET /server/bans/events (JSON poll)
router.get('/events', (req, res) => {
  res.json(getEvents(50));
});

// POST /server/bans/unban
router.post('/unban', (req, res) => {
  const { jail, ip } = req.body;
  if (!jail || !ip) return res.status(400).json({ error: 'Missing jail or ip' });
  // Basic IP validation
  if (!/^[\d.:a-fA-F]+$/.test(ip)) return res.status(400).json({ error: 'Invalid IP' });
  const safe_jail = jail.replace(/[^a-z0-9_-]/gi, '');
  run(`sudo fail2ban-client set ${safe_jail} unbanip ${ip}`);
  req.flash('success', `Unbanned ${ip} from ${safe_jail}`);
  res.redirect('/server/bans');
});

// POST /server/bans/ban
router.post('/ban', (req, res) => {
  const { jail, ip } = req.body;
  if (!jail || !ip) return res.status(400).json({ error: 'Missing jail or ip' });
  if (!/^[\d.:a-fA-F]+$/.test(ip)) return res.status(400).json({ error: 'Invalid IP' });
  const safe_jail = jail.replace(/[^a-z0-9_-]/gi, '');
  run(`sudo fail2ban-client set ${safe_jail} banip ${ip}`);
  req.flash('success', `Banned ${ip} in ${safe_jail}`);
  res.redirect('/server/bans');
});

module.exports = router;
