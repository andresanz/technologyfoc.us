'use strict';

const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');
const Database  = require('better-sqlite3');
const geoip     = require('geoip-lite');

const app       = express();
const REDIRECTS = path.join(__dirname, '..', 'blog-admin', 'data', 'redirects.json');
const DB_PATH   = path.join(__dirname, '..', 'blog-admin', 'data', 'redirects.db');
const PORT      = process.env.PORT || 4099;

const BOT_RE = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|curl|python|wget|httpclient|go-http|java\//i;

// ── Analytics DB ─────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS hits (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       INTEGER NOT NULL,
    domain   TEXT    NOT NULL,
    referrer TEXT,
    vh       TEXT,
    country  TEXT,
    device   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_hits_ts     ON hits(ts);
  CREATE INDEX IF NOT EXISTS idx_hits_domain ON hits(domain);
`);

// Migrate existing DBs
const cols = db.pragma('table_info(hits)').map(c => c.name);
if (!cols.includes('country')) db.exec('ALTER TABLE hits ADD COLUMN country TEXT');
if (!cols.includes('device'))  db.exec('ALTER TABLE hits ADD COLUMN device TEXT');

const insertHit = db.prepare('INSERT INTO hits (ts, domain, referrer, vh, country, device) VALUES (?, ?, ?, ?, ?, ?)');

function recordHit(domain, req) {
  const ua = req.headers['user-agent'] || '';
  if (BOT_RE.test(ua)) return;
  const ts  = Math.floor(Date.now() / 1000);
  const ref = (req.headers.referer || req.headers.referrer || '').slice(0, 200);
  const day = Math.floor(ts / 86400);
  const ip  = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || '';
  const vh  = crypto.createHash('sha256')
    .update(ip + ua + day).digest('hex').slice(0, 16);

  const geo     = geoip.lookup(ip);
  const country = geo ? geo.country : null;

  let device = null;
  if (ua) {
    device = /mobile|android|iphone|ipad|ipod|blackberry|windows phone/i.test(ua)
      ? (/tablet|ipad/i.test(ua) ? 'tablet' : 'mobile')
      : 'desktop';
  }

  try { insertHit.run(ts, domain, ref || null, vh, country, device); } catch (_) {}
}

// ── Redirects ─────────────────────────────────────────────────────────────────
function loadRedirects() {
  try { return JSON.parse(fs.readFileSync(REDIRECTS, 'utf8')); }
  catch { return []; }
}

app.set('trust proxy', 1);

app.use((req, res) => {
  const host      = (req.hostname || '').replace(/^www\./, '');
  const redirects = loadRedirects();
  const match     = redirects.find(r => r.domain === host || r.domain === req.hostname);

  if (!match || !match.to) {
    return res.status(404).send('No redirect configured for this domain.');
  }

  recordHit(match.domain, req);

  let dest = match.to.replace(/\/$/, '');
  if (match.preservePath) dest += req.originalUrl;

  res.redirect(match.code || 301, dest);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Redirect service on http://127.0.0.1:${PORT}`);
});
