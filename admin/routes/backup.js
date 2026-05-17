'use strict';

const express    = require('express');
const { spawn, execSync } = require('child_process');
const fs         = require('fs');
const router     = express.Router();

// Unified backup bucket — server-config/, server-content/, mac/, michele/
const BACKUP_BUCKET  = process.env.BACKUP_BUCKET || 'sanz-backups';
const BUCKET         = BACKUP_BUCKET;
const CONFIG_PREFIX  = 'server-config';
const CONTENT_BUCKET = BACKUP_BUCKET;
const CONTENT_PREFIX = 'server-content';
const MAC_BUCKET     = BACKUP_BUCKET;
const MAC_PREFIX_NEW = 'mac/';
// Legacy Mac prefix — kept for read during migration grace period
const LEGACY_MAC_BUCKET = 'sanz';
const MAC_PREFIX  = 'MacbookAir/Backups/';
const STATUS_LOG = '/var/log/blog-backup-status.log';
const FLAG_FILE  = '/tmp/blog-backup-running';

function awsEnv() {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID:     process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION:    process.env.AWS_REGION || 'us-east-1',
  };
}

function run(cmd) {
  return execSync(cmd, { timeout: 30000, env: awsEnv() }).toString().trim();
}

const VOL_BACKUP_DIR = '/mnt/volume01/server02.technologyfoc.us/backups';
const VOL_BACKUP_LOG = '/var/log/backup.log';

function listLocalBackups() {
  try {
    const folders = fs.readdirSync(VOL_BACKUP_DIR)
      .filter(f => /^\d{8}$/.test(f)).sort().reverse();
    return folders.map(date => {
      const folderPath = `${VOL_BACKUP_DIR}/${date}`;
      let files = [], kb = 0;
      try {
        files = fs.readdirSync(folderPath);
        kb = parseInt(execSync(`du -sk ${folderPath}`, { timeout: 10000 }).toString().split('\t')[0]) || 0;
      } catch {}
      return { date, files: files.length, mb: (kb / 1024).toFixed(1) };
    });
  } catch { return []; }
}

function listMacFrom(bucket, prefix) {
  try {
    const out = run(
      `aws s3api list-objects-v2 --bucket ${bucket} --prefix "${prefix}" --delimiter "/" ` +
      `--query 'CommonPrefixes[].Prefix' --output text`
    );
    if (!out || out === 'None') return [];
    return out.split('\t').filter(Boolean)
      .map(p => {
        const name = p.replace(prefix, '').replace(/\/$/, '');
        const m = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})$/);
        if (!m) return null;
        return {
          key: p,
          bucket,
          name,
          modified: m[1] + ' ' + m[2].replace(/-/g, ':'),
          source: bucket === MAC_BUCKET ? 'new' : 'legacy',
        };
      })
      .filter(Boolean);
  } catch { return []; }
}

function listMacBackups() {
  const newer = listMacFrom(MAC_BUCKET, MAC_PREFIX_NEW);
  const legacy = listMacFrom(LEGACY_MAC_BUCKET, MAC_PREFIX);
  return [...newer, ...legacy].sort((a, b) => b.modified.localeCompare(a.modified));
}

function listBackups() {
  try {
    const out = run(
      `aws s3api list-objects-v2 --bucket ${BUCKET} --prefix ${CONFIG_PREFIX}/ ` +
      `--query 'sort_by(Contents, &LastModified)[].[Key,Size,LastModified]' --output text`
    );
    if (!out || out === 'None') return [];
    return out.split('\n').filter(Boolean).reverse().map(line => {
      const [key, size, modified] = line.split('\t');
      const name = key.replace(`${CONFIG_PREFIX}/`, '');
      const mb   = (parseInt(size) / 1024 / 1024).toFixed(2);
      return { key, name, mb, modified: new Date(modified).toLocaleString() };
    });
  } catch { return []; }
}

function listContentBackups() {
  try {
    const out = run(
      `aws s3api list-objects-v2 --bucket ${CONTENT_BUCKET} --prefix ${CONTENT_PREFIX}/ ` +
      `--query 'sort_by(Contents, &LastModified)[].[Key,Size,LastModified]' --output text`
    );
    if (!out || out === 'None') return [];
    return out.split('\n').filter(Boolean).reverse().map(line => {
      const [key, size, modified] = line.split('\t');
      const name = key.replace(`${CONTENT_PREFIX}/`, '');
      const kb   = (parseInt(size) / 1024).toFixed(1);
      return { key, name, kb, modified: new Date(modified).toLocaleString() };
    });
  } catch { return []; }
}

function lastStatus() {
  try {
    const lines = fs.readFileSync(STATUS_LOG, 'utf8').trim().split('\n');
    return lines[lines.length - 1] || null;
  } catch { return null; }
}

function isRunning() {
  return fs.existsSync(FLAG_FILE);
}

// GET /server/backups
router.get('/', (req, res) => {
  const backups        = listBackups();
  const contentBackups = listContentBackups();
  const localBackups   = listLocalBackups();
  const macBackups     = listMacBackups();
  const last           = lastStatus();
  const running        = isRunning();
  res.render('server-backups', { backups, contentBackups, localBackups, macBackups, last, bucket: BUCKET, running, flash: req.flash() });
});

// POST /server/backups/content/run — fire content backup now
router.post('/content/run', (req, res) => {
  const env = { ...awsEnv(), PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' };
  const child = spawn('/usr/local/bin/content-backup.sh', [], {
    detached: true, stdio: 'ignore', env,
  });
  child.unref();
  req.flash('success', 'Content backup started');
  res.redirect('/server/backups');
});

// POST /server/backups/run — trigger manual backup (fire and forget)
router.post('/run', (req, res) => {
  if (isRunning()) {
    req.flash('error', 'Backup is already running');
    return res.redirect('/server/backups');
  }

  const env = { ...awsEnv(), PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' };
  const child = spawn('/usr/local/bin/server-config-backup.sh', [], {
    detached: true,
    stdio:    'ignore',
    env,
  });
  child.unref();

  res.redirect('/server/backups');
});

// GET /server/backups/download?key=... — presigned download URL
router.get('/download', (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).send('Invalid key');
  const ok = key.startsWith(`${CONFIG_PREFIX}/`) || key.startsWith(`${CONTENT_PREFIX}/`);
  if (!ok) return res.status(400).send('Invalid key');
  try {
    const url = run(`aws s3 presign "s3://${BACKUP_BUCKET}/${key}" --expires-in 300`);
    res.redirect(url);
  } catch (e) { res.status(500).send(e.message); }
});

// GET /server/backups/local/:date — list files in a volume backup folder
router.get('/local/:date', (req, res) => {
  const date = req.params.date;
  if (!/^\d{8}$/.test(date)) return res.status(400).send('Invalid date');
  const dir = `${VOL_BACKUP_DIR}/${date}`;
  try {
    const files = fs.readdirSync(dir).map(f => {
      const stat = fs.statSync(`${dir}/${f}`);
      return { name: f, mb: (stat.size / 1048576).toFixed(1), mtime: stat.mtime.toLocaleDateString() };
    }).sort((a, b) => a.name.localeCompare(b.name));
    res.render('backup-local', { date, files });
  } catch (e) { res.status(500).send(e.message); }
});

// GET /server/backups/status — poll running state + last status line
router.get('/status', (req, res) => {
  res.json({
    running: isRunning(),
    last:    lastStatus(),
  });
});

// GET /server/backups/log — last 50 lines
router.get('/log', (req, res) => {
  const src = req.query.src === 'local' ? VOL_BACKUP_LOG : '/var/log/blog-backup.log';
  let log = '';
  try { log = execSync(`tail -50 ${src} 2>/dev/null`).toString(); }
  catch { log = '(no log yet)'; }
  res.json({ log });
});

// POST /server/backups/delete — delete a backup
router.post('/delete', (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).send('Invalid key');
  const ok = key.startsWith(`${CONFIG_PREFIX}/`) || key.startsWith(`${CONTENT_PREFIX}/`);
  if (!ok) return res.status(400).send('Invalid key');
  try {
    run(`aws s3 rm s3://${BACKUP_BUCKET}/${key}`);
    req.flash('success', `Deleted ${key}`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/server/backups');
});

// POST /server/backups/mac/delete — delete a Mac backup
router.post('/mac/delete', (req, res) => {
  const { key, bucket } = req.body;
  if (!key) return res.status(400).send('Invalid key');
  const b = (bucket === LEGACY_MAC_BUCKET) ? LEGACY_MAC_BUCKET : MAC_BUCKET;
  try {
    run(`aws s3 rm "s3://${b}/${key}" --recursive`);
    req.flash('success', `Deleted ${key}`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/server/backups');
});

module.exports = router;
