'use strict';

// Unified security dashboard. Pulls together:
//   • ModSecurity (WAF) snapshot from /var/log/modsec_audit.log
//   • fail2ban jails + recent bans
//   • Host audit (sshd config, ufw, unattended-upgrades, etc.)

const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');

const audit = require('../lib/security-audit');

const router = express.Router();

function run(cmd) {
  try { return execSync(cmd, { timeout: 5000, stdio: ['ignore','pipe','ignore'] }).toString().trim(); }
  catch { return ''; }
}

// ── fail2ban snapshot ────────────────────────────────────────────────────────
function fail2banSummary() {
  const status = run('sudo fail2ban-client status 2>/dev/null');
  const jailNames = (status.match(/Jail list:\s+(.+)/) || [])[1] || '';
  const jails = jailNames.split(/[,\s]+/).filter(Boolean).map(j => {
    const out = run(`sudo fail2ban-client status ${j} 2>/dev/null`);
    return {
      name:   j,
      failed: parseInt((out.match(/Currently failed:\s+(\d+)/)   || [])[1] || 0, 10),
      banned: parseInt((out.match(/Currently banned:\s+(\d+)/)   || [])[1] || 0, 10),
      total:  parseInt((out.match(/Total banned:\s+(\d+)/)       || [])[1] || 0, 10),
      ips:    ((out.match(/Banned IP list:\s+(.*)/) || [])[1] || '').split(/\s+/).filter(Boolean),
    };
  });
  return {
    running: !!status,
    jails,
    totalBanned: jails.reduce((a, j) => a + j.banned, 0),
  };
}

// ── ModSecurity quick stats ─────────────────────────────────────────────────
function wafSummary() {
  const log = '/var/log/modsec_audit.log';
  if (!fs.existsSync(log)) return { installed: false };

  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const today = new Date();
  const tag = `${MO[today.getMonth()]} ${today.getDate()}`;

  // Total today (via timestamp scan, no full json parse)
  const todayCnt = parseInt(run(`sudo /usr/bin/grep -c '"time_stamp":"[^"]*${tag} ' "${log}" 2>/dev/null`) || '0', 10);
  const totalCnt = parseInt(run(`sudo /usr/bin/wc -l "${log}" 2>/dev/null`).split(/\s+/)[0] || '0', 10);

  // Recent attacker IPs (last 500 lines)
  const tail = run(`sudo /usr/bin/tail -n 500 "${log}" 2>/dev/null | grep -oE '"client_ip":"[^"]+"'`);
  const ipCounts = {};
  tail.split('\n').forEach(l => {
    const m = l.match(/"client_ip":"([^"]+)"/);
    if (m) ipCounts[m[1]] = (ipCounts[m[1]] || 0) + 1;
  });
  const topIps = Object.entries(ipCounts).sort(([,a],[,b]) => b - a).slice(0, 5);

  // Mode
  let mode = 'unknown';
  try {
    const m = fs.readFileSync('/etc/nginx/modsec/mode.conf', 'utf8');
    mode = /SecRuleEngine\s+On/i.test(m) ? 'blocking'
         : /SecRuleEngine\s+DetectionOnly/i.test(m) ? 'detection'
         : /SecRuleEngine\s+Off/i.test(m) ? 'off'
         : 'unknown';
  } catch {}

  return { installed: true, mode, today: todayCnt, total: totalCnt, topIps };
}

// ── SSH recent activity ─────────────────────────────────────────────────────
function sshSummary() {
  // failed root or invalid user attempts in last 24h
  const failed = run("journalctl -u ssh --since='24 hours ago' 2>/dev/null | grep -cE 'Failed|Invalid user' || echo 0");
  const accepted = run("journalctl -u ssh --since='24 hours ago' 2>/dev/null | grep -c 'Accepted' || echo 0");
  return {
    failedLast24: parseInt(failed, 10) || 0,
    acceptedLast24: parseInt(accepted, 10) || 0,
  };
}

// ── GET /security ──────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('security', {
    site:     req.site,
    audit:    audit.runAll(),
    fail2ban: fail2banSummary(),
    waf:      wafSummary(),
    ssh:      sshSummary(),
    flash:    req.flash(),
  });
});

// Unban an IP
router.post('/unban', (req, res) => {
  const { jail, ip } = req.body;
  if (!jail || !ip || !/^[0-9a-f.:]+$/i.test(ip) || !/^[a-z0-9-]+$/i.test(jail)) {
    req.flash('error', 'bad input');
    return res.redirect('/security');
  }
  const out = run(`sudo fail2ban-client set ${jail} unbanip ${ip} 2>&1`);
  req.flash('success', `unbanned ${ip} from ${jail}: ${out}`);
  res.redirect('/security');
});

module.exports = router;
