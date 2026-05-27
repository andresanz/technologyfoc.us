'use strict';

// Central pageview store for ALL sites on the platform.
// One DB at <PLATFORM_ROOT>/admin/data/analytics.db, rows tagged by domain.

const Database = require('better-sqlite3');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const geoip    = require('geoip-lite');

const BOT_RE = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|curl|python|wget|httpclient|go-http|java\//i;

const PLATFORM_ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..', '..');
const DB_PATH       = process.env.ANALYTICS_DB || path.join(PLATFORM_ROOT, 'admin', 'data', 'analytics.db');

let db = null;
let insertStmt = null;

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  try {
    db = new Database(DB_PATH);
  } catch (e) {
    console.error('[analytics] cannot open central DB:', e.message);
    return null;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS pageviews (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      ts       INTEGER NOT NULL,
      domain   TEXT,
      path     TEXT    NOT NULL,
      referrer TEXT,
      vh       TEXT,
      ua       TEXT,
      ip       TEXT,
      country  TEXT,
      device   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pv_ts        ON pageviews(ts);
    CREATE INDEX IF NOT EXISTS idx_pv_path      ON pageviews(path);
    CREATE INDEX IF NOT EXISTS idx_pv_domain_ts ON pageviews(domain, ts);
    PRAGMA journal_mode=WAL;
  `);
  // Backfill columns on pre-existing DBs that lack them
  const cols = db.pragma('table_info(pageviews)').map(c => c.name);
  if (!cols.includes('domain'))  db.exec('ALTER TABLE pageviews ADD COLUMN domain TEXT');
  if (!cols.includes('ua'))      db.exec('ALTER TABLE pageviews ADD COLUMN ua TEXT');
  if (!cols.includes('country')) db.exec('ALTER TABLE pageviews ADD COLUMN country TEXT');
  if (!cols.includes('device'))  db.exec('ALTER TABLE pageviews ADD COLUMN device TEXT');
  if (!cols.includes('ip'))      db.exec('ALTER TABLE pageviews ADD COLUMN ip TEXT');
  insertStmt = db.prepare(
    'INSERT INTO pageviews (ts, domain, path, referrer, vh, ua, ip, country, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  return db;
}

function middleware(domain) {
  const _db = getDb();
  if (!_db) return (_req, _res, next) => next();

  return function analyticsMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();
    const ua = req.headers['user-agent'] || '';
    if (BOT_RE.test(ua)) return next();
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map|webp)$/i.test(req.path)) return next();
    if (req.path.startsWith('/_') || req.path === '/favicon.ico') return next();

    const ts  = Math.floor(Date.now() / 1000);
    const ref = (req.headers.referer || req.headers.referrer || '').slice(0, 200);
    const day = Math.floor(ts / 86400);
    const ip  = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || '';
    const vh  = crypto.createHash('sha256').update(ip + ua + day).digest('hex').slice(0, 16);

    const geo     = geoip.lookup(ip);
    const country = geo ? geo.country : null;

    let device = null;
    if (ua) {
      if (/mobile|android|iphone|ipad|ipod|blackberry|windows phone/i.test(ua)) {
        device = /tablet|ipad/i.test(ua) ? 'tablet' : 'mobile';
      } else {
        device = 'desktop';
      }
    }

    try { insertStmt.run(ts, domain || null, req.path, ref || null, vh, ua.slice(0, 200) || null, ip || null, country, device); } catch (_) {}
    next();
  };
}

// All read helpers filter by domain.
function _domainClause(domain) { return domain ? ' AND domain = ?' : ''; }
function _domainArg(domain)    { return domain ? [domain] : []; }

function getStats(domain, days = 30) {
  const _db = getDb();
  if (!_db) return null;

  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const now   = Math.floor(Date.now() / 1000);
  const day   = 86400;
  const dc    = _domainClause(domain);
  const da    = _domainArg(domain);

  const total  = _db.prepare(`SELECT COUNT(*) as n FROM pageviews WHERE ts >= ?${dc}`).get(since, ...da).n;
  const today  = _db.prepare(`SELECT COUNT(*) as n FROM pageviews WHERE ts >= ?${dc}`).get(now - day, ...da).n;
  const unique = _db.prepare(`SELECT COUNT(DISTINCT vh) as n FROM pageviews WHERE ts >= ?${dc}`).get(since, ...da).n;

  const topPages = _db.prepare(`
    SELECT path, COUNT(*) as views FROM pageviews
    WHERE ts >= ?${dc} GROUP BY path ORDER BY views DESC LIMIT 15
  `).all(since, ...da);

  const topRefs = _db.prepare(`
    SELECT referrer, COUNT(*) as views FROM pageviews
    WHERE ts >= ?${dc} AND referrer IS NOT NULL AND referrer != ''
    GROUP BY referrer ORDER BY views DESC LIMIT 10
  `).all(since, ...da);

  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = now - (i + 1) * day;
    const end   = now - i * day;
    const n = _db.prepare(`SELECT COUNT(*) as n FROM pageviews WHERE ts >= ? AND ts < ?${dc}`).get(start, end, ...da).n;
    const date = new Date((now - i * day) * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric' });
    daily.push({ date, n });
  }

  return { total, today, unique, topPages, topRefs, daily, days };
}

function getDetail(domain, pagePath, limit = 100) {
  const _db = getDb();
  if (!_db) return [];
  const dc = _domainClause(domain);
  const da = _domainArg(domain);
  return _db.prepare(`
    SELECT ts, path, referrer, ua, ip, country, device FROM pageviews
    WHERE path = ?${dc} ORDER BY ts DESC LIMIT ?
  `).all(pagePath, ...da, limit);
}

function getCountryStats(domain, days = 30) {
  const _db = getDb();
  if (!_db) return [];
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const dc = _domainClause(domain);
  const da = _domainArg(domain);
  return _db.prepare(`
    SELECT country, COUNT(*) as views FROM pageviews
    WHERE ts >= ?${dc} AND country IS NOT NULL
    GROUP BY country ORDER BY views DESC LIMIT 20
  `).all(since, ...da);
}

function getDeviceStats(domain, days = 30) {
  const _db = getDb();
  if (!_db) return [];
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const dc = _domainClause(domain);
  const da = _domainArg(domain);
  return _db.prepare(`
    SELECT device, COUNT(*) as views FROM pageviews
    WHERE ts >= ?${dc} AND device IS NOT NULL
    GROUP BY device ORDER BY views DESC
  `).all(since, ...da);
}

// Quick pageview count for a single path on a single domain. Used for inline "N views" badges.
function pageViews(domain, pagePath) {
  const _db = getDb();
  if (!_db) return 0;
  try {
    return _db.prepare('SELECT COUNT(*) AS n FROM pageviews WHERE domain = ? AND path = ?').get(domain, pagePath).n;
  } catch { return 0; }
}

module.exports = { middleware, getStats, getDetail, getCountryStats, getDeviceStats, pageViews };
