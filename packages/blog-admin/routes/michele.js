'use strict';

const express      = require('express');
const { execSync } = require('child_process');
const router       = express.Router();

const MAC_BUCKET  = 'sanz';
const MAC_PREFIX  = 'MicheleLaptop/';

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
        const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})$/);
        if (!dateMatch) return null;
        const modified = dateMatch[1] + ' ' + dateMatch[2].replace(/-/g, ':');
        return { key: p, name, fmt: null, modified, isFolder: true };
      })
      .filter(Boolean);
  } catch { return []; }
}

// GET /michele
router.get('/', (req, res) => {
  const backups = listFolders(`${MAC_PREFIX}Backups/`);
  res.render('michele', { pageTitle: 'Michele', backups, flash: req.flash() });
});

// GET /michele/snapshot/:name
router.get('/snapshot/:name', (req, res) => {
  const name   = req.params.name;
  const prefix = `${MAC_PREFIX}Backups/${name}/`;
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
          const [key, size] = line.split('\t');
          return { key, name: key.replace(prefix, ''), fmt: fmtBytes(size), rawBytes: parseInt(size)||0, isDir: false };
        })
      : [];

    res.render('mac-snapshot', { snapshot: name, prefix, items: [...folders, ...files], bucket: MAC_BUCKET, browseBase: '/michele', backBase: '/michele' });
  } catch (e) { res.status(500).send(e.message); }
});

// GET /michele/browse?prefix=...
router.get('/browse', (req, res) => {
  const prefix = req.query.prefix || '';
  if (!prefix.startsWith(MAC_PREFIX)) return res.status(400).send('Invalid prefix');
  try {
    const foldersOut = run(
      `aws s3api list-objects-v2 --bucket ${MAC_BUCKET} --prefix "${prefix}" --delimiter "/" ` +
      `--query 'CommonPrefixes[].Prefix' --output text`
    );
    const folders = (foldersOut && foldersOut !== 'None')
      ? foldersOut.split('\t').filter(Boolean).map(p => ({ key: p, name: p.replace(prefix,'').replace(/\/$/,''), isDir: true }))
      : [];

    const filesOut = run(
      `aws s3api list-objects-v2 --bucket ${MAC_BUCKET} --prefix "${prefix}" --delimiter "/" ` +
      `--query 'Contents[].[Key,Size,LastModified]' --output text`
    );
    const files = (filesOut && filesOut !== 'None')
      ? filesOut.split('\n').filter(Boolean).map(line => {
          const [key, size, mod] = line.split('\t');
          return { key, name: key.replace(prefix,''), fmt: fmtBytes(size), rawBytes: parseInt(size)||0, isDir: false, modified: mod ? new Date(mod).toLocaleDateString() : '' };
        })
      : [];

    const parts  = prefix.replace(MAC_PREFIX, '').split('/').filter(Boolean);
    const crumbs = parts.map((p, i) => ({ label: p, prefix: MAC_PREFIX + parts.slice(0,i+1).join('/') + '/' }));
    res.render('mac-snapshot', { snapshot: parts[1]||'', prefix, items: [...folders,...files], crumbs, bucket: MAC_BUCKET, browseBase: '/michele', backBase: '/michele' });
  } catch (e) { res.status(500).send(e.message); }
});

// GET /michele/download?key=...
router.get('/download', (req, res) => {
  const key = req.query.key || '';
  if (!key) return res.status(400).send('No key');
  try {
    const url = run(`aws s3 presign "s3://${MAC_BUCKET}/${key}" --expires-in 300`);
    res.redirect(url);
  } catch (e) { res.status(500).send(e.message); }
});

module.exports = router;
