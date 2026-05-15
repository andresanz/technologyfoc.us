'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const geoip    = require('geoip-lite');

const BOT_RE = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|curl|python|wget|httpclient|go-http|java\//i;

const dbs = {};

function getDb(domain) {
  if (dbs[domain]) return dbs[domain];
  const dir = `/var/www/${domain}`;
  if (!fs.existsSync(dir)) return null;
  let db;
  try {
    db = new Database(path.join(dir, 'analytics.db'));
  } catch (e) {
    console.error(`[analytics] cannot open DB for ${domain}:`, e.message);
    return null;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS pageviews (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      ts       INTEGER NOT NULL,
      path     TEXT    NOT NULL,
      referrer TEXT,
      vh       TEXT,
      ua       TEXT,
      country  TEXT,
      device   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ts   ON pageviews(ts);
    CREATE INDEX IF NOT EXISTS idx_path ON pageviews(path);
    PRAGMA journal_mode=WAL;
  `);
  // migrate: add columns to existing DBs if missing
  const cols = db.pragma('table_info(pageviews)').map(c => c.name);
  if (!cols.includes('ua'))      db.exec('ALTER TABLE pageviews ADD COLUMN ua TEXT');
  if (!cols.includes('country')) db.exec('ALTER TABLE pageviews ADD COLUMN country TEXT');
  if (!cols.includes('device'))  db.exec('ALTER TABLE pageviews ADD COLUMN device TEXT');
  dbs[domain] = db;
  return db;
}

function middleware(domain) {
  const db = getDb(domain);
  if (!db) return (_req, _res, next) => next();

  const insert = db.prepare(
    'INSERT INTO pageviews (ts, path, referrer, vh, ua, country, device) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  return function analyticsMiddleware(req, res, next) {
    // Only GET requests for HTML pages
    if (req.method !== 'GET') return next();
    const ua = req.headers['user-agent'] || '';
    if (BOT_RE.test(ua)) return next();
    // Skip static assets
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map|webp)$/i.test(req.path)) return next();
    // Skip internal routes
    if (req.path.startsWith('/_') || req.path === '/favicon.ico') return next();

    const ts  = Math.floor(Date.now() / 1000);
    const ref = (req.headers.referer || req.headers.referrer || '').slice(0, 200);
    const day = Math.floor(ts / 86400);
    const ip  = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || '';
    const vh  = crypto.createHash('sha256')
      .update(ip + ua + day)
      .digest('hex').slice(0, 16);

    // Country from IP
    const geo     = geoip.lookup(ip);
    const country = geo ? geo.country : null;

    // Device type from UA
    let device = null;
    if (ua) {
      if (/mobile|android|iphone|ipad|ipod|blackberry|windows phone/i.test(ua)) {
        device = /tablet|ipad/i.test(ua) ? 'tablet' : 'mobile';
      } else {
        device = 'desktop';
      }
    }

    const uaShort = ua.slice(0, 200);
    try { insert.run(ts, req.path, ref || null, vh, uaShort || null, country, device); } catch (_) {}
    next();
  };
}

function getStats(domain, days = 30) {
  const db = getDb(domain);
  if (!db) return null;

  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const now   = Math.floor(Date.now() / 1000);
  const day   = 86400;

  const total   = db.prepare('SELECT COUNT(*) as n FROM pageviews WHERE ts >= ?').get(since).n;
  const today   = db.prepare('SELECT COUNT(*) as n FROM pageviews WHERE ts >= ?').get(now - day).n;
  const unique  = db.prepare('SELECT COUNT(DISTINCT vh) as n FROM pageviews WHERE ts >= ?').get(since).n;

  const topPages = db.prepare(`
    SELECT path, COUNT(*) as views
    FROM pageviews WHERE ts >= ?
    GROUP BY path ORDER BY views DESC LIMIT 15
  `).all(since);

  const topRefs = db.prepare(`
    SELECT referrer, COUNT(*) as views
    FROM pageviews WHERE ts >= ? AND referrer IS NOT NULL AND referrer != ''
    GROUP BY referrer ORDER BY views DESC LIMIT 10
  `).all(since);

  // Daily counts for chart (last N days)
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = now - (i + 1) * day;
    const end   = now - i * day;
    const n = db.prepare('SELECT COUNT(*) as n FROM pageviews WHERE ts >= ? AND ts < ?').get(start, end).n;
    const date = new Date((now - i * day) * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric' });
    daily.push({ date, n });
  }

  return { total, today, unique, topPages, topRefs, daily, days };
}

function getDetail(domain, pagePath, limit = 100) {
  const db = getDb(domain);
  if (!db) return [];
  return db.prepare(`
    SELECT ts, path, referrer, ua, country, device
    FROM pageviews
    WHERE path = ?
    ORDER BY ts DESC LIMIT ?
  `).all(pagePath, limit);
}

function getCountryStats(domain, days = 30) {
  const db = getDb(domain);
  if (!db) return [];
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  return db.prepare(`
    SELECT country, COUNT(*) as views
    FROM pageviews
    WHERE ts >= ? AND country IS NOT NULL
    GROUP BY country ORDER BY views DESC LIMIT 20
  `).all(since);
}

function getDeviceStats(domain, days = 30) {
  const db = getDb(domain);
  if (!db) return [];
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  return db.prepare(`
    SELECT device, COUNT(*) as views
    FROM pageviews
    WHERE ts >= ? AND device IS NOT NULL
    GROUP BY device ORDER BY views DESC
  `).all(since);
}

module.exports = { middleware, getStats, getDetail, getCountryStats, getDeviceStats };
