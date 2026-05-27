'use strict';

// Server security posture checks. Each check returns:
//   { id, label, status: 'ok' | 'warn' | 'crit', detail, fix }
// status semantics:
//   ok   — configured correctly
//   warn — works but recommended hardening missing
//   crit — actively bad

const { execSync } = require('child_process');
const fs = require('fs');

function run(cmd) {
  try { return execSync(cmd, { timeout: 5000, stdio: ['ignore','pipe','ignore'] }).toString().trim(); }
  catch { return ''; }
}

function fileContains(file, re) {
  try { return re.test(fs.readFileSync(file, 'utf8')); } catch { return false; }
}

function readGrep(file, pattern) {
  try {
    const re = new RegExp('^\\s*' + pattern + '\\s+(\\S+)', 'mi');
    const m  = fs.readFileSync(file, 'utf8').match(re);
    return m ? m[1] : null;
  } catch { return null; }
}

const checks = [
  // ── SSH ──
  () => {
    const v = readGrep('/etc/ssh/sshd_config', 'PermitRootLogin') || 'yes';
    const ok = /^(no|prohibit-password)$/i.test(v);
    return {
      id: 'ssh-root', label: 'SSH root login',
      status: ok ? 'ok' : 'crit',
      detail: `PermitRootLogin = ${v}`,
      fix: ok ? null : "Edit /etc/ssh/sshd_config: PermitRootLogin no — then 'systemctl restart ssh'",
    };
  },
  () => {
    const v = readGrep('/etc/ssh/sshd_config', 'PasswordAuthentication') || 'yes';
    const ok = /^no$/i.test(v);
    return {
      id: 'ssh-passwd', label: 'SSH password auth',
      status: ok ? 'ok' : 'warn',
      detail: `PasswordAuthentication = ${v}`,
      fix: ok ? null : 'Disable password auth in sshd_config once your keys are confirmed working.',
    };
  },
  () => {
    const v = readGrep('/etc/ssh/sshd_config', 'Port') || '22';
    return {
      id: 'ssh-port', label: 'SSH port',
      status: v === '22' ? 'warn' : 'ok',
      detail: `Port = ${v}`,
      fix: v === '22' ? 'Optional: move SSH off port 22 to reduce noise (e.g. 2222). Then update fail2ban + your ~/.ssh/config.' : null,
    };
  },

  // ── Firewall ──
  () => {
    const ufw = run('ufw status 2>/dev/null');
    const enabled = /Status:\s*active/i.test(ufw);
    return {
      id: 'firewall', label: 'UFW firewall',
      status: enabled ? 'ok' : 'warn',
      detail: enabled ? ufw.split('\n')[0] : 'UFW inactive or not installed',
      fix: enabled ? null : 'Enable UFW: ufw default deny incoming; ufw allow 22; ufw allow 80; ufw allow 443; ufw enable',
    };
  },

  // ── Unattended-upgrades ──
  () => {
    const conf = '/etc/apt/apt.conf.d/20auto-upgrades';
    const enabled = fileContains(conf, /Unattended-Upgrade.*"1"/);
    return {
      id: 'auto-upgrades', label: 'Automatic security updates',
      status: enabled ? 'ok' : 'warn',
      detail: enabled ? 'Configured (apt unattended-upgrades)' : 'Not enabled',
      fix: enabled ? null : 'apt install unattended-upgrades && dpkg-reconfigure --priority=low unattended-upgrades',
    };
  },

  // ── fail2ban ──
  () => {
    const active = run('systemctl is-active fail2ban') === 'active';
    return {
      id: 'fail2ban', label: 'fail2ban running',
      status: active ? 'ok' : 'crit',
      detail: active ? 'Active' : 'Not active',
      fix: active ? null : 'systemctl enable --now fail2ban',
    };
  },

  // ── ModSecurity ──
  () => {
    const modeFile = '/etc/nginx/modsec/mode.conf';
    let mode = '';
    try { mode = fs.readFileSync(modeFile, 'utf8'); } catch {}
    const blocking = /SecRuleEngine\s+On/i.test(mode);
    return {
      id: 'modsec-mode', label: 'ModSecurity mode',
      status: blocking ? 'ok' : 'warn',
      detail: blocking ? 'Blocking (SecRuleEngine On)' : 'Detection only or off',
      fix: blocking ? null : 'Set SecRuleEngine On in /etc/nginx/modsec/mode.conf, then reload nginx',
    };
  },

  // ── HTTPS-only nginx configs ──
  () => {
    const http80WithBody = run("grep -L 'return 301 https' /etc/nginx/sites-enabled/* 2>/dev/null").split('\n').filter(Boolean);
    // Filter out catch-all and admin reverse-proxy domains where this is expected
    const bad = http80WithBody.filter(f => {
      const name = f.split('/').pop();
      return !['redirect-catch', 'default'].includes(name);
    });
    return {
      id: 'http-redirect', label: 'HTTPS redirect on all sites',
      status: bad.length === 0 ? 'ok' : 'warn',
      detail: bad.length ? `${bad.length} config(s) missing HTTPS redirect: ${bad.slice(0,3).map(f => f.split('/').pop()).join(', ')}` : 'All sites force HTTPS',
      fix: bad.length ? 'Check the listed configs; each port 80 server block should "return 301 https://$host$request_uri"' : null,
    };
  },

  // ── Open ports — non-localhost services ──
  () => {
    const out = run("ss -tlnp 2>/dev/null | awk 'NR>1 && $4 !~ /127\\.0\\.0\\.1/ && $4 !~ /\\[::1\\]/ {print $4}'");
    const exposed = out.split('\n').filter(Boolean);
    // Expected exposed: :22, :25 (postfix mail), :80, :443
    const expected = new Set(['22','25','80','443','465','587']);
    const unexpected = exposed.map(s => s.replace(/.*:/,'')).filter(p => !expected.has(p));
    return {
      id: 'open-ports', label: 'Internet-facing ports',
      status: unexpected.length === 0 ? 'ok' : 'warn',
      detail: exposed.length ? `${exposed.length} listeners: ${[...new Set(exposed.map(s => s.replace(/.*:/,'')))].join(', ')}` : 'None',
      fix: unexpected.length ? `Unexpected port(s) ${unexpected.join(', ')} are listening publicly — confirm or close.` : null,
    };
  },

  // ── Backups recent? ──
  () => {
    const last = run("ls -t /tmp/platform-backup* 2>/dev/null | head -1");
    const lastLog = run("journalctl -u platform-backup --since='2 days ago' --no-pager 2>/dev/null | grep -c '\\[backup\\].*tar.gz'");
    const recent = parseInt(lastLog || '0', 10) > 0;
    return {
      id: 'backups', label: 'Nightly backup ran',
      status: recent ? 'ok' : 'warn',
      detail: recent ? 'Backup ran in last 48h' : 'No backup logged in last 48h',
      fix: recent ? null : 'Check systemctl status platform-backup.timer',
    };
  },

  // ── Public-facing sites have certs? ──
  () => {
    const certs = run('ls /etc/letsencrypt/live/ 2>/dev/null').split('\n').filter(Boolean);
    const enabled = run('ls /etc/nginx/sites-enabled/ 2>/dev/null').split('\n').filter(Boolean).filter(f => !['default','redirect-catch'].includes(f));
    const missing = enabled.filter(e => !certs.includes(e));
    return {
      id: 'ssl-coverage', label: 'SSL cert coverage',
      status: missing.length === 0 ? 'ok' : 'warn',
      detail: missing.length ? `${missing.length} enabled site(s) without cert: ${missing.slice(0,3).join(', ')}` : `${certs.length} certs / ${enabled.length} enabled sites`,
      fix: missing.length ? 'Provision certs via /sites → Get SSL, or certbot --nginx -d <domain>' : null,
    };
  },
];

function runAll() { return checks.map(fn => { try { return fn(); } catch (e) { return { id: 'err', label: 'check error', status: 'warn', detail: e.message }; } }); }

module.exports = { runAll };
