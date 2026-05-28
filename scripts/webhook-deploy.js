'use strict';
const http   = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PORT           = parseInt(process.env.DEPLOY_PORT   || '4101');
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET         || '';
const TELEGRAM_TOKEN = process.env.DEPLOY_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT  = process.env.DEPLOY_TELEGRAM_CHAT_ID   || process.env.TELEGRAM_CHAT_ID   || '';
const APP_DIR        = process.env.APP_DIR                 || '/var/www/technologyfoc.us';
const ALLOWED_BRANCHES = (process.env.DEPLOY_BRANCHES || 'main').split(',').map(s => s.trim()).filter(Boolean);

if (!GITHUB_WEBHOOK_SECRET) {
  console.error('[webhook-deploy] FATAL: GITHUB_WEBHOOK_SECRET not set — refusing to start');
  process.exit(1);
}

// Map filesystem path prefixes → systemd unit names to restart
const RESTART_RULES = [
  { match: /^admin\//,                       svc: 'andresanz-admin' },
  { match: /^core\//,                        svc: '*'                }, // core touches everything
  { match: /^sites\/andresanz\.com\//,       svc: 'andresanz'        },
  { match: /^sites\/914\.io\//,              svc: '914-io'           },
  { match: /^sites\/randomcategory\.com\//,  svc: 'randomcategory-com' },
  { match: /^scripts\/webhook-deploy\.js$/,  svc: 'andresanz-deploy' },
];
const ALL_SITE_SERVICES = ['andresanz', '914-io', 'randomcategory-com', 'andresanz-admin'];

function servicesToRestart(files) {
  const set = new Set();
  for (const f of files) {
    for (const rule of RESTART_RULES) {
      if (rule.match.test(f)) {
        if (rule.svc === '*') ALL_SITE_SERVICES.forEach(s => set.add(s));
        else set.add(rule.svc);
      }
    }
  }
  return [...set];
}

function telegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    const payload = JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: 'HTML' });
    const safePayload = payload.replace(/'/g, "'\\''");
    execSync(
      `curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage"` +
      ` -H "Content-Type: application/json"` +
      ` -d '${safePayload}'`,
      { stdio: 'pipe' }
    );
  } catch (e) { console.error('Telegram error:', e.message); }
}

function deploy(payload) {
  const branch  = (payload.ref || '').replace('refs/heads/', '');
  const pusher  = payload.pusher?.name || 'unknown';
  const commits = payload.commits || [];
  const files   = [...new Set(commits.flatMap(c =>
    [...(c.added||[]), ...(c.modified||[]), ...(c.removed||[])]
  ))];

  if (!ALLOWED_BRANCHES.includes(branch)) {
    console.log(`[deploy] ignoring branch=${branch} (not in ${ALLOWED_BRANCHES.join(',')})`);
    return;
  }

  console.log(`[deploy] branch=${branch} pusher=${pusher} files=${files.length}`);

  // pull
  try {
    execSync(`git -C ${APP_DIR} fetch origin --quiet`, { stdio: 'pipe' });
    execSync(`git -C ${APP_DIR} reset --hard origin/${branch} --quiet`, { stdio: 'pipe' });
  } catch (e) {
    const err = (e.stderr || Buffer.alloc(0)).toString().trim();
    console.error('[deploy] git pull failed:', err);
    telegram(`❌ <b>technologyfoc.us deploy FAILED</b> – git pull\n${err}`);
    return;
  }

  // grab deploy metadata after pull
  let shortHash = '', deployNum = '', commitMsg = '';
  try {
    shortHash  = execSync(`git -C ${APP_DIR} rev-parse --short HEAD`,      { stdio: 'pipe' }).toString().trim();
    deployNum  = execSync(`git -C ${APP_DIR} rev-list --count HEAD`,       { stdio: 'pipe' }).toString().trim();
    commitMsg  = execSync(`git -C ${APP_DIR} log -1 --format=%s`,          { stdio: 'pipe' }).toString().trim();
  } catch {}

  const errors = [];

  // npm install if package.json changed
  const pkgChanged = files.some(f => f === 'package.json' || f === 'package-lock.json');
  if (pkgChanged) {
    try {
      execSync('npm install --omit=dev --silent', { cwd: APP_DIR, timeout: 120000, stdio: 'pipe' });
      console.log('[deploy] npm install done');
    } catch (e) {
      const err = (e.stderr || Buffer.alloc(0)).toString().trim();
      errors.push(`npm install failed: ${err.slice(0, 200)}`);
      console.error('[deploy] npm install failed:', err);
    }
  }

  // restart only services whose files changed
  const services = servicesToRestart(files);
  // Defer self-restart until after telegram fires; otherwise we kill ourselves before notifying
  const selfRestart = services.includes('andresanz-deploy');
  for (const svc of services) {
    if (svc === 'andresanz-deploy') continue;
    try {
      execSync(`systemctl restart ${svc}.service`, { stdio: 'pipe' });
      console.log(`[deploy] restarted ${svc}`);
    } catch (e) {
      const err = (e.stderr || Buffer.alloc(0)).toString().trim();
      errors.push(`${svc} restart failed: ${err}`);
      console.error(`[deploy] restart failed: ${svc}`, err);
    }
  }

  const svcLine = services.length ? `\nrestarted: ${services.join(', ')}` : '';
  telegram(
    `<b>technologyfoc.us</b> · ${branch}\n` +
    `#${deployNum} · <code>${shortHash}</code> · ${files.length} file(s)\n` +
    `<i>${commitMsg}</i>${svcLine}` +
    (errors.length ? `\n\n${errors.join('\n')}` : '')
  );

  if (selfRestart) {
    // Detach a subprocess that outlives this one. systemctl will SIGTERM us
    // mid-flight, so we cannot await the restart — the new process picks up.
    const { spawn } = require('child_process');
    spawn('sh', ['-c', 'sleep 1 && systemctl restart andresanz-deploy.service'], {
      detached: true,
      stdio:    'ignore',
    }).unref();
  }
}

function verify(body, sig) {
  const expected = 'sha256=' + crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET).update(body).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig || '')); }
  catch { return false; }
}

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook/deploy') {
    res.writeHead(404); res.end('not found'); return;
  }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    if (!verify(body, req.headers['x-hub-signature-256'])) {
      res.writeHead(401); res.end('bad signature'); return;
    }
    res.writeHead(200); res.end('accepted');
    let p; try { p = JSON.parse(body); } catch { return; }
    setImmediate(() => { try { deploy(p); } catch(e) { console.error(e); } });
  });
}).listen(PORT, '127.0.0.1', () =>
  console.log(`[webhook-deploy] listening on 127.0.0.1:${PORT}`)
);
