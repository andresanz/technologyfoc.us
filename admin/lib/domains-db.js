'use strict';

const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DOMAINS_DB ||
                path.join(__dirname, '..', 'data', 'domains.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS domains (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    domain         TEXT    NOT NULL UNIQUE,
    state          TEXT    NOT NULL DEFAULT 'parked'
                           CHECK (state IN ('live', 'redirect', 'parked')),
    target         TEXT,
    port           INTEGER,
    preserve_path  INTEGER NOT NULL DEFAULT 1,
    ssl_active     INTEGER NOT NULL DEFAULT 0,
    note           TEXT,
    source         TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS domain_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id   INTEGER REFERENCES domains(id) ON DELETE CASCADE,
    type        TEXT,
    message     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_domains_state ON domains(state);
`);

module.exports = db;
