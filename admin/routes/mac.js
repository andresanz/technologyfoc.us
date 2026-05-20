'use strict';

const express      = require('express');
const { execSync } = require('child_process');
const router       = express.Router();

const MAC_BUCKET = 'sanz';
const MAC_PREFIX = 'MacbookAir/';

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

function fmtBytes(bytes) {
  bytes = parseInt(bytes) || 0;
  return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1) + ' GB'
       : bytes >= 1048576    ? (bytes / 1048576).toFixed(1) + ' MB'
       :                       (bytes / 1024).toFixed(0) + ' KB';
}

// List top-level date folders (for home backups which contain thousands of files)
function listFolders(prefix) {
  try {
    const out = run(
      `aws s3api list-objects-v2 --bucket ${MAC_BUCKET} --prefix "${prefix}" --delimiter "/" ` +
      `--query 'CommonPrefixes[].Prefix' --output text`
    );
    if (!out || out === 'None') return [];
    return out.split('\t').filter(Boolean).reverse()
      .map(p => {
        const name = p.replace(prefix, '').replace(/\/$/, '');
        // Parse date from folder name e.g. 2026-04-29_02-07-46
        const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})$/);
        if (!dateMatch) return null; // skip non-date folders like Music/
        const modified = dateMatch[1] + 'T' + dateMatch[2].replace(/-/g, ':') + 'Z';
        const date = new Date(modified);
        return { key: p, name, fmt: null, modified: date.toLocaleString(), date, isFolder: true };
      })
      .filter(Boolean);
  } catch { return []; }
}

// List individual files (for movies/music which are flat)
function listPrefix(prefix) {
  try {
    const out = run(
      `aws s3api list-objects-v2 --bucket ${MAC_BUCKET} --prefix "${prefix}" ` +
      `--query 'sort_by(Contents, &LastModified)[].[Key,Size,LastModified]' --output text`
    );
    if (!out || out === 'None') return [];
    return out.split('\n').filter(Boolean).reverse().map(line => {
      const [key, size, modified] = line.split('\t');
      const date = new Date(modified);
      return { key, name: key.replace(prefix, ''), fmt: fmtBytes(size), modified: date.toLocaleString(), date };
    });
  } catch { return []; }
}

function sentinelDate(key) {
  try {
    const out = run(
      `aws s3api head-object --bucket ${MAC_BUCKET} --key "MacbookAir/.last_${key}_sync" --query 'LastModified' --output text 2>/dev/null`
    );
    return out && out !== 'None' ? new Date(out) : null;
  } catch { return null; }
}

// GET /mac
router.get('/', (req, res) => {
  const home   = listFolders(`${MAC_PREFIX}Backups/`);
  const movies = listPrefix(`${MAC_PREFIX}Movies/`);
  const music  = listPrefix(`${MAC_PREFIX}Music/`);

  const sections = [
    { label: 'Home',   key: 'home',   items: home,   prefix: `${MAC_PREFIX}Backups/`, unit: 'snapshots' },
    { label: 'Movies', key: 'movies', items: movies, prefix: `${MAC_PREFIX}Movies/`,  unit: 'files', lastSync: sentinelDate('movies') },
    { label: 'Music',  key: 'music',  items: music,  prefix: `${MAC_PREFIX}Music/`,   unit: 'files',  lastSync: sentinelDate('music')  },
  ];

  res.render('mac', { sections, bucket: MAC_BUCKET, flash: req.flash() });
});

// POST /mac/delete
router.post('/delete', (req, res) => {
  const { key } = req.body;
  if (!key || !/^[\w./-]+$/.test(key) || key.includes('..')) return res.status(400).send('Invalid key');
  try {
    run(`aws s3 rm "s3://${MAC_BUCKET}/${key}"`);
    req.flash('success', `Deleted ${key}`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/mac');
});

// GET /mac/snapshot/:name — list top-level folders inside a snapshot
router.get('/snapshot/:name', (req, res) => {
  const name   = req.params.name;
  const prefix = `${MAC_PREFIX}Backups/${name}/`;
  try {
    // Get top-level subfolders
    const foldersOut = run(
      `aws s3api list-objects-v2 --bucket ${MAC_BUCKET} --prefix "${prefix}" --delimiter "/" ` +
      `--query 'CommonPrefixes[].Prefix' --output text`
    );
    const folders = (foldersOut && foldersOut !== 'None')
      ? foldersOut.split('\t').filter(Boolean).map(p => ({
          key:    p,
          name:   p.replace(prefix, '').replace(/\/$/, ''),
          isDir:  true,
        }))
      : [];

    // Get top-level files (not in subfolders)
    const filesOut = run(
      `aws s3api list-objects-v2 --bucket ${MAC_BUCKET} --prefix "${prefix}" --delimiter "/" ` +
      `--query 'Contents[].[Key,Size,LastModified]' --output text`
    );
    const files = (filesOut && filesOut !== 'None')
      ? filesOut.split('\n').filter(Boolean).map(line => {
          const [key, size, mod] = line.split('\t');
          return { key, name: key.replace(prefix, ''), fmt: fmtBytes(size), rawBytes: parseInt(size) || 0, isDir: false, modified: mod ? new Date(mod).toLocaleDateString() : '' };
        })
      : [];

    const items = [...folders, ...files];
    res.render('mac-snapshot', { snapshot: name, prefix, items, bucket: MAC_BUCKET, browseBase: '/mac', backBase: '/mac' });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// GET /mac/browse?prefix=... — browse arbitrary prefix inside a snapshot
router.get('/browse', (req, res) => {
  const prefix = req.query.prefix || '';
  if (!prefix.startsWith(MAC_PREFIX)) return res.status(400).send('Invalid prefix');

  try {
    const foldersOut = run(
      `aws s3api list-objects-v2 --bucket ${MAC_BUCKET} --prefix "${prefix}" --delimiter "/" ` +
      `--query 'CommonPrefixes[].Prefix' --output text`
    );
    const folders = (foldersOut && foldersOut !== 'None')
      ? foldersOut.split('\t').filter(Boolean).map(p => ({
          key: p, name: p.replace(prefix, '').replace(/\/$/, ''), isDir: true,
        }))
      : [];

    const filesOut = run(
      `aws s3api list-objects-v2 --bucket ${MAC_BUCKET} --prefix "${prefix}" --delimiter "/" ` +
      `--query 'Contents[].[Key,Size,LastModified]' --output text`
    );
    const files = (filesOut && filesOut !== 'None')
      ? filesOut.split('\n').filter(Boolean).map(line => {
          const [key, size, mod] = line.split('\t');
          return { key, name: key.replace(prefix, ''), fmt: fmtBytes(size), rawBytes: parseInt(size) || 0, isDir: false, modified: mod ? new Date(mod).toLocaleDateString() : '' };
        })
      : [];

    // Build breadcrumb from prefix
    const parts  = prefix.replace(MAC_PREFIX, '').split('/').filter(Boolean);
    const crumbs = parts.map((p, i) => ({
      label:  p,
      prefix: MAC_PREFIX + parts.slice(0, i + 1).join('/') + '/',
    }));

    res.render('mac-snapshot', { snapshot: parts[1] || '', prefix, items: [...folders, ...files], crumbs, bucket: MAC_BUCKET, browseBase: '/mac', backBase: '/mac' });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// GET /mac/download?key=...
router.get('/download', (req, res) => {
  const key = req.query.key || '';
  if (!key) return res.status(400).send('No key');
  if (!/^[\w./-]+$/.test(key) || key.includes('..')) return res.status(400).send('Invalid key');
  try {
    const url = run(`aws s3 presign "s3://${MAC_BUCKET}/${key}" --expires-in 300`);
    res.redirect(url);
  } catch (e) { res.status(500).send(e.message); }
});

module.exports = router;
