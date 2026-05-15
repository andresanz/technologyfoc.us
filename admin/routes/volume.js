'use strict';

const express    = require('express');
const { execSync } = require('child_process');
const fs         = require('fs');
const router     = express.Router();

const LINODE_API   = 'https://api.linode.com/v4';
const VOL_MOUNT    = '/mnt/volume01';
const VOL_BACKUP   = `${VOL_MOUNT}/server02.technologyfoc.us/backups`;

function linodeGet(path) {
  const token = process.env.LINODE_TOKEN;
  return fetch(`${LINODE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
}

function run(cmd) {
  try { return execSync(cmd, { timeout: 10000 }).toString().trim(); }
  catch { return ''; }
}

function diskUsage(path) {
  try {
    const out = run(`df -k ${path} --output=size,used,avail`).split('\n')[1];
    if (!out) return null;
    const [size, used, avail] = out.trim().split(/\s+/).map(Number);
    return { size, used, avail, pct: Math.round(used / size * 100) };
  } catch { return null; }
}

function backupFolders() {
  try {
    return fs.readdirSync(VOL_BACKUP)
      .filter(f => /^\d{8}$/.test(f)).sort().reverse()
      .map(date => {
        let files = 0, kb = 0;
        try {
          files = fs.readdirSync(`${VOL_BACKUP}/${date}`).length;
          kb = parseInt(run(`du -sk ${VOL_BACKUP}/${date}`).split('\t')[0]) || 0;
        } catch {}
        return { date: date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), raw: date, files, mb: (kb / 1024).toFixed(1) };
      });
  } catch { return []; }
}

function kb(v) {
  if (v >= 1048576) return (v / 1048576).toFixed(1) + ' GB';
  if (v >= 1024)    return (v / 1024).toFixed(0) + ' MB';
  return v + ' KB';
}

// GET /volume
router.get('/', async (req, res) => {
  let linodeVolume = null, error = null;
  try {
    const data = await linodeGet('/volumes?page_size=50');
    linodeVolume = (data.data || []).find(v => v.filesystem_path && v.filesystem_path.includes('volume01')) || data.data?.[0] || null;
  } catch (e) { error = e.message; }

  const disk   = diskUsage(VOL_MOUNT);
  const backups = backupFolders();
  res.render('volume', { linodeVolume, disk, backups, kb, error, flash: req.flash() });
});

// GET /volume/backup/:date — browse files in a backup folder
router.get('/backup/:date', (req, res) => {
  const date = req.params.date.replace(/-/g, '');
  if (!/^\d{8}$/.test(date)) return res.status(400).send('Invalid date');
  const dir  = `${VOL_BACKUP}/${date}`;
  try {
    const items = fs.readdirSync(dir).map(name => {
      const full  = `${dir}/${name}`;
      const stat  = fs.statSync(full);
      const bytes = stat.size;
      const fmt   = bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1) + ' GB'
                  : bytes >= 1048576    ? (bytes / 1048576).toFixed(1) + ' MB'
                  :                       (bytes / 1024).toFixed(0) + ' KB';
      return { name, bytes, fmt, isDir: stat.isDirectory(), modified: stat.mtime.toLocaleString() };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const label = date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    res.render('volume-backup', { label, date, items });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// GET /volume/backup/:date/download/:file
router.get('/backup/:date/download/:file', (req, res) => {
  const date = req.params.date.replace(/-/g, '');
  const file = req.params.file;
  if (!/^\d{8}$/.test(date) || file.includes('/') || file.includes('..')) {
    return res.status(400).send('Invalid request');
  }
  const full = `${VOL_BACKUP}/${date}/${file}`;
  if (!fs.existsSync(full)) return res.status(404).send('File not found');
  res.download(full, file);
});

module.exports = router;
