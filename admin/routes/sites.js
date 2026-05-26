'use strict';

// Unified /sites — domains registry backed by SQLite (admin/data/domains.db)
// Replaces the previous sites.json + redirects.json setup.

const express   = require('express');
const fs        = require('fs');
const { execSync } = require('child_process');

const db        = require('../lib/domains-db');
const nginxBld  = require('../lib/nginx-build');
const sitesLib  = require('../lib/sites');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAll(filter = {}) {
  let sql = 'SELECT * FROM domains WHERE 1=1';
  const params = [];
  if (filter.q)     { sql += ' AND domain LIKE ?'; params.push(`%${filter.q}%`); }
  if (filter.state) { sql += ' AND state = ?';     params.push(filter.state); }
  sql += ' ORDER BY domain ASC';
  return db.prepare(sql).all(...params);
}

function getOne(domain) {
  return db.prepare('SELECT * FROM domains WHERE domain = ?').get(domain);
}

function reloadNginx() {
  try { execSync('nginx -t && systemctl reload nginx', { timeout: 10000 }); return { ok: true }; }
  catch (e) { return { ok: false, err: e.stderr?.toString() || e.message }; }
}

function enrich(row) {
  return {
    ...row,
    ssl_active: nginxBld.hasCert(row.domain) ? 1 : 0,
    runtime:    row.state === 'live' ? sitesLib.getSite(row.domain) : null,
  };
}

// ── GET /sites — list + filter ────────────────────────────────────────────────

router.get('/', (req, res) => {
  const sites = getAll({ q: req.query.q, state: req.query.state }).map(enrich);
  const counts = {
    total:    db.prepare('SELECT COUNT(*) AS c FROM domains').get().c,
    live:     db.prepare("SELECT COUNT(*) AS c FROM domains WHERE state='live'").get().c,
    redirect: db.prepare("SELECT COUNT(*) AS c FROM domains WHERE state='redirect'").get().c,
    parked:   db.prepare("SELECT COUNT(*) AS c FROM domains WHERE state='parked'").get().c,
  };
  res.render('sites', { sites, counts, q: req.query.q || '', stateFilter: req.query.state || '', flash: req.flash() });
});

// ── POST /sites/add — create domain ───────────────────────────────────────────

router.post('/add', (req, res) => {
  const { domain, state = 'parked', target = '', port = '', note = '' } = req.body;
  const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;
  if (!DOMAIN_RE.test(domain)) {
    req.flash('error', 'Invalid domain');
    return res.redirect('/sites');
  }
  if (getOne(domain)) {
    req.flash('error', `${domain} already exists`);
    return res.redirect('/sites');
  }
  db.prepare(`
    INSERT INTO domains (domain, state, target, port, note, source)
    VALUES (?, ?, ?, ?, ?, 'admin')
  `).run(domain.trim().toLowerCase(), state, target || null, port ? parseInt(port,10) : null, note || null);
  req.flash('success', `${domain} added`);
  res.redirect('/sites');
});

// ── POST /sites/:domain/save — update fields ─────────────────────────────────

router.post('/:domain/save', (req, res) => {
  const { state, target, port, preserve_path, note } = req.body;
  const row = getOne(req.params.domain);
  if (!row) { req.flash('error', 'Not found'); return res.redirect('/sites'); }

  db.prepare(`
    UPDATE domains SET
      state         = ?,
      target        = ?,
      port          = ?,
      preserve_path = ?,
      note          = ?,
      updated_at    = datetime('now')
    WHERE id = ?
  `).run(
    state || row.state,
    target || null,
    port ? parseInt(port, 10) : null,
    preserve_path === '1' || preserve_path === 'on' || preserve_path === true ? 1 : 0,
    note || null,
    row.id,
  );
  req.flash('success', `${row.domain} saved`);
  res.redirect('/sites');
});

// ── POST /sites/:domain/sync — push registry state to nginx ──────────────────

router.post('/:domain/sync', (req, res) => {
  const row = getOne(req.params.domain);
  if (!row) { req.flash('error', 'Not found'); return res.redirect('/sites'); }
  const src  = nginxBld.confPath(row.domain);
  const snap = fs.existsSync(src) ? fs.readFileSync(src) : null;
  try {
    nginxBld.write(row);
    try { execSync('nginx -t 2>&1', { timeout: 10000 }); }
    catch (e) {
      // Restore
      if (snap) fs.writeFileSync(src, snap);
      else      try { fs.unlinkSync(src); } catch {}
      throw new Error(`nginx -t failed: ${e.stdout?.toString() || e.message}`);
    }
    execSync('systemctl reload nginx', { timeout: 10000 });
    db.prepare("INSERT INTO domain_events (domain_id, type, message) VALUES (?, 'sync', ?)")
      .run(row.id, `synced as ${row.state}`);
    req.flash('success', `${row.domain} → nginx (${row.state})`);
  } catch (e) {
    req.flash('error', `sync failed: ${e.message}`);
  }
  res.redirect('/sites');
});

// ── POST /sites/sync-all — push every registry entry to nginx ────────────────
// Safety net: snapshots sites-available before writing. If nginx -t fails,
// restores the snapshot so production never serves a broken config.

router.post('/sync-all', (req, res) => {
  const path  = require('path');
  const os    = require('os');
  const snap  = fs.mkdtempSync(path.join(os.tmpdir(), 'nginx-snap-'));

  // Skip domains explicitly marked as unmanaged (e.g. andresanz.com with custom config)
  const all = getAll().filter(r => r.nginx_managed !== 0);
  let ok = 0, fail = [];

  try {
    // 1. Snapshot only the files we're about to touch
    for (const row of all) {
      const src = nginxBld.confPath(row.domain);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(snap, row.domain));
    }

    // 2. Write new configs
    for (const row of all) {
      try { nginxBld.write(row); ok++; }
      catch (e) { fail.push(`${row.domain}: ${e.message}`); }
    }

    // 3. Test nginx — if it fails, restore
    try {
      execSync('nginx -t 2>&1', { timeout: 10000 });
    } catch (e) {
      // Restore snapshot
      for (const f of fs.readdirSync(snap)) {
        fs.copyFileSync(path.join(snap, f), nginxBld.confPath(f));
      }
      throw new Error(`nginx -t failed, configs restored: ${e.stdout?.toString() || e.message}`);
    }

    // 4. Reload
    execSync('systemctl reload nginx', { timeout: 10000 });

    if (fail.length) req.flash('error', `Synced ${ok}, ${fail.length} failed: ${fail.slice(0,3).join('; ')}${fail.length>3?'…':''}`);
    else             req.flash('success', `Synced ${ok} domains to nginx`);
  } catch (e) {
    req.flash('error', `sync-all aborted: ${e.message}`);
  } finally {
    // cleanup snapshot
    try { fs.rmSync(snap, { recursive: true, force: true }); } catch {}
  }
  res.redirect('/sites');
});

// ── POST /sites/:domain/ssl — provision SSL cert via certbot ─────────────────

router.post('/:domain/ssl', (req, res) => {
  const row = getOne(req.params.domain);
  if (!row) return res.status(404).json({ error: 'not found' });
  try {
    execSync(
      `certbot certonly --webroot -w /var/www/certbot -d ${row.domain} -d www.${row.domain} ` +
      `--non-interactive --agree-tos -m ${process.env.CERTBOT_EMAIL || 'sanz.andre@gmail.com'}`,
      { timeout: 90_000 }
    );
    nginxBld.write(row);
    reloadNginx();
    db.prepare("UPDATE domains SET ssl_active=1, updated_at=datetime('now') WHERE id=?").run(row.id);
    db.prepare("INSERT INTO domain_events (domain_id, type, message) VALUES (?, 'ssl', 'cert issued')")
      .run(row.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /sites/:domain/remove ────────────────────────────────────────────────

router.post('/:domain/remove', (req, res) => {
  const row = getOne(req.params.domain);
  if (!row) { req.flash('error', 'Not found'); return res.redirect('/sites'); }
  try { nginxBld.remove(row.domain); reloadNginx(); } catch {}
  db.prepare('DELETE FROM domains WHERE id = ?').run(row.id);
  req.flash('success', `${row.domain} removed`);
  res.redirect('/sites');
});

// ── GET /sites/:domain/events — JSON log of changes ──────────────────────────

router.get('/:domain/events', (req, res) => {
  const row = getOne(req.params.domain);
  if (!row) return res.status(404).json({ error: 'not found' });
  const events = db.prepare(
    'SELECT * FROM domain_events WHERE domain_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(row.id);
  res.json(events);
});

module.exports = router;
