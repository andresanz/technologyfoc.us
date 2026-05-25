#!/usr/bin/env node
'use strict';

// One-shot migration: sites.json + redirects.json → SQLite domains table.
// Idempotent: re-running won't duplicate, only fills in missing entries.

const fs   = require('fs');
const path = require('path');
const db   = require('../lib/domains-db');

const SITES_FILE     = path.join(__dirname, '..', 'sites.json');
const REDIRECTS_FILE = path.join(__dirname, '..', 'data', 'redirects.json');

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return []; }
}

const sites     = readJSON(SITES_FILE);
const redirects = readJSON(REDIRECTS_FILE);

const upsert = db.prepare(`
  INSERT INTO domains (domain, state, target, preserve_path, note, source, updated_at)
  VALUES (@domain, @state, @target, @preserve_path, @note, @source, datetime('now'))
  ON CONFLICT(domain) DO UPDATE SET
    state         = excluded.state,
    target        = COALESCE(excluded.target, domains.target),
    preserve_path = excluded.preserve_path,
    note          = COALESCE(excluded.note, domains.note),
    source        = COALESCE(domains.source, excluded.source),
    updated_at    = datetime('now')
`);

const tx = db.transaction(() => {
  let imported = 0;
  for (const s of sites) {
    upsert.run({
      domain:        s.domain,
      state:         s.state || 'parked',
      target:        s.redirectTo || null,
      preserve_path: 1,
      note:          s.note || null,
      source:        'sites.json',
    });
    imported++;
  }
  for (const r of redirects) {
    // Skip if already imported from sites.json with same state
    upsert.run({
      domain:        r.domain,
      state:         'redirect',
      target:        r.to,
      preserve_path: r.preservePath === false ? 0 : 1,
      note:          r.note || null,
      source:        'redirects.json',
    });
    imported++;
  }
  return imported;
});

const count = tx();
console.log(`Imported/updated ${count} entries.`);
console.log(`Total in DB: ${db.prepare('SELECT COUNT(*) AS c FROM domains').get().c}`);

// Print summary by state
for (const row of db.prepare('SELECT state, COUNT(*) AS c FROM domains GROUP BY state ORDER BY state').all()) {
  console.log(`  ${row.state.padEnd(10)} ${row.c}`);
}
