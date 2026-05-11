'use strict';
const http   = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PORT             = parseInt(process.env.DEPLOY_PORT      || '4101');
const WEBHOOK_SECRET   = process.env.WEBHOOK_SECRET            || '';
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN        || '';
const TELEGRAM_CHAT    = process.env.TELEGRAM_CHAT_ID          || '';
const REPO_DIR         = process.env.REPO_DIR                  || '/var/www/server02';

// prefix -> services that must restart when any file under that prefix changes
const MAP = {
  'packages/blog-core':              ['blog-914-io','blog-andresanz-com','blog-randomcategory-com','blog-samsanz-info','blog-sanz-me','blog-therandomactofwriting-com'],
  'packages/blog-admin':             ['blog-admin'],
  'packages/redirect-service':       ['redirect-service'],
  'sites/914.io':                    ['blog-914-io'],
  'sites/andresanz.com':             ['blog-andresanz-com'],
  'sites/randomcategory.com':        ['blog-randomcategory-com'],
  'sites/samsanz.info':              ['blog-samsanz-info'],
  'sites/sanz.me':                   ['blog-sanz-me'],
  'sites/therandomactofwriting.com': ['blog-therandomactofwriting-com'],
};

// prefix -> directory to run npm install in (only when package.json changes)
const NPM_DIRS = {
  'packages/blog-core':        `${REPO_DIR}/packages/blog-core`,
  'packages/blog-admin':       `${REPO_DIR}/packages/blog-admin`,
  'packages/redirect-service': `${REPO_DIR}/packages/redirect-service`,
};

function affectedServices(files) {
  const set = new Set();
  for (const f of files)
    for (const [prefix, svcs] of Object.entries(MAP))
      if (f === prefix || f.startsWith(prefix + '/'))
        svcs.forEach(s => set.add(s));
  return [...set];
}

function telegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    const safeText = text.replace(/'/g, "'\\''");
    execSync(
      `curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage"` +
      ` -H "Content-Type: application/json"` +
      ` -d '{"chat_id":"${TELEGRAM_CHAT}","text":"${safeText}","parse_mode":"HTML"}'`,
      { stdio: 'pipe' }
    );
  } catch (e) { console.error('Telegram error:', e.message); }
}

function deploy(payload) {
  const branch   = (payload.ref || '').replace('refs/heads/', '');
  const pusher   = payload.pusher?.name || 'unknown';
  const commits  = payload.commits || [];
  const files    = [...new Set(commits.flatMap(c =>
    [...(c.added||[]), ...(c.modified||[]), ...(c.removed||[])]
  ))];

  const services = affectedServices(files);
  console.log(`[deploy] branch=${branch} pusher=${pusher} files=${files.length} svcs=${services.join(',') || 'none'}`);

  if (!services.length) {
    telegram(`ℹ️ <b>monorepo push</b> by ${pusher} (${branch})\nNo services affected.`);
    return;
  }

  // pull
  try {
    execSync(`git -C ${REPO_DIR} pull --rebase origin ${branch} --quiet`, { stdio: 'pipe' });
  } catch (e) {
    const err = (e.stderr||Buffer.alloc(0)).toString().trim();
    console.error('[deploy] git pull failed:', err);
    telegram(`❌ <b>deploy FAILED</b> – git pull error\n${err}`);
    return;
  }

  // npm install for any package whose package.json changed
  const lines = [];
  for (const [prefix, dir] of Object.entries(NPM_DIRS)) {
    const pkgChanged = files.some(f =>
      f.startsWith(prefix + '/') && (f.endsWith('package.json') || f.endsWith('package-lock.json'))
    );
    if (!pkgChanged) continue;
    try {
      execSync('npm install --omit=dev --silent', { cwd: dir, timeout: 120000, stdio: 'pipe' });
      lines.push(`📦 npm install: ${prefix}`);
      console.log(`[deploy] npm install: ${prefix}`);
    } catch (e) {
      const err = (e.stderr || Buffer.alloc(0)).toString().trim();
      lines.push(`❌ npm install failed (${prefix}): ${err.slice(0, 200)}`);
      console.error(`[deploy] npm install failed: ${prefix}`, err);
    }
  }

  // restart
  for (const svc of services) {
    try {
      execSync(`systemctl restart ${svc}.service`, { stdio: 'pipe' });
      lines.push(`✅ ${svc}`);
      console.log(`[deploy] restarted ${svc}`);
    } catch (e) {
      const err = (e.stderr||Buffer.alloc(0)).toString().trim();
      lines.push(`❌ ${svc}: ${err}`);
      console.error(`[deploy] restart failed: ${svc}`, err);
    }
  }

  telegram(
    `🚀 <b>deploy</b> by ${pusher} (${branch})\n` +
    `${files.length} file(s) changed\n\n` +
    lines.join('\n')
  );
}

function verify(body, sig) {
  if (!WEBHOOK_SECRET) return true;
  const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
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
    // run async, don't block the response
    setImmediate(() => { try { deploy(p); } catch(e) { console.error(e); } });
  });
}).listen(PORT, '127.0.0.1', () =>
  console.log(`[webhook-deploy] listening on 127.0.0.1:${PORT}`)
);
