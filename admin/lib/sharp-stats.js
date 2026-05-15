'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'sharp-stats.db');

let _db;
function db() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            INTEGER NOT NULL,
      domain        TEXT    NOT NULL,
      filename      TEXT    NOT NULL,
      original_size INTEGER NOT NULL,
      processed_size INTEGER NOT NULL,
      original_type TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_uploads_domain ON uploads(domain);
    CREATE INDEX IF NOT EXISTS idx_uploads_ts     ON uploads(ts);
  `);
  return _db;
}

function log({ domain, filename, originalSize, processedSize, originalType }) {
  db().prepare(
    'INSERT INTO uploads (ts, domain, filename, original_size, processed_size, original_type) VALUES (?,?,?,?,?,?)'
  ).run(Math.floor(Date.now() / 1000), domain, filename, originalSize, processedSize, originalType);
}

function getStats() {
  return db().prepare(`
    SELECT
      domain,
      COUNT(*)                          AS count,
      SUM(original_size)                AS total_in,
      SUM(processed_size)               AS total_out,
      AVG(original_size)                AS avg_in,
      AVG(processed_size)               AS avg_out,
      SUM(original_size - processed_size) AS saved
    FROM uploads
    GROUP BY domain
    ORDER BY domain
  `).all();
}

function getRecent(domain, limit = 50) {
  const q = domain
    ? db().prepare('SELECT * FROM uploads WHERE domain = ? ORDER BY ts DESC LIMIT ?').all(domain, limit)
    : db().prepare('SELECT * FROM uploads ORDER BY ts DESC LIMIT ?').all(limit);
  return q;
}

function getTotals() {
  return db().prepare(`
    SELECT
      COUNT(*)                            AS count,
      SUM(original_size)                  AS total_in,
      SUM(processed_size)                 AS total_out,
      SUM(original_size - processed_size) AS saved
    FROM uploads
  `).get();
}

module.exports = { log, getStats, getRecent, getTotals };
