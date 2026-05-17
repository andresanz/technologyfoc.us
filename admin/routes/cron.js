'use strict';

const express     = require('express');
const { execSync, spawnSync } = require('child_process');
const fs          = require('fs');
const path        = require('path');
const router      = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────

function readUserCrontab() {
  try {
    const out = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
    return out.split('\n').map(l => l.trimEnd()).filter(l => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

function writeUserCrontab(lines) {
  const result = spawnSync('crontab', ['-'], {
    input: lines.join('\n') + '\n',
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || 'crontab write failed');
}

function parseCronLine(raw) {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 6) return { schedule: raw, command: '', raw };
  return {
    schedule: parts.slice(0, 5).join(' '),
    command:  parts.slice(5).join(' '),
    raw,
  };
}

function readCronD() {
  const cronDir = '/etc/cron.d';
  const entries = [];
  try {
    const files = fs.readdirSync(cronDir)
      .filter(f => !f.startsWith('.') && !f.endsWith('.dpkg-new'))
      .sort();
    for (const file of files) {
      try {
        const lines = fs.readFileSync(path.join(cronDir, file), 'utf8')
          .split('\n')
          .map(l => l.trimEnd())
          .filter(l => l && !l.startsWith('#') && !l.startsWith('SHELL=') && !l.startsWith('PATH=') && !l.startsWith('MAILTO='));
        for (const raw of lines) {
          const parts = raw.trim().split(/\s+/);
          if (parts.length >= 7) {
            entries.push({ file, schedule: parts.slice(0, 5).join(' '), user: parts[5], command: parts.slice(6).join(' '), raw });
          }
        }
      } catch {}
    }
  } catch {}
  return entries;
}

// ── Routes ─────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const userLines   = readUserCrontab();
  const userEntries = userLines.map((raw, index) => ({ ...parseCronLine(raw), index }));
  const sysCronD    = readCronD();
  res.render('cron', { userEntries, sysCronD, flash: req.flash() });
});

router.post('/add', (req, res) => {
  const line = (req.body.line || '').trim();
  if (!line || line.startsWith('#')) {
    req.flash('error', 'Empty or invalid cron line');
    return res.redirect('/cron');
  }
  const lines = readUserCrontab();
  lines.push(line);
  try {
    writeUserCrontab(lines);
    req.flash('success', 'Entry added');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/cron');
});

router.post('/update/:index', (req, res) => {
  const idx  = parseInt(req.params.index, 10);
  const line = (req.body.line || '').trim();
  const lines = readUserCrontab();
  if (isNaN(idx) || idx < 0 || idx >= lines.length) {
    req.flash('error', 'Invalid entry');
    return res.redirect('/cron');
  }
  if (!line || line.startsWith('#')) {
    req.flash('error', 'Empty or invalid cron line');
    return res.redirect('/cron');
  }
  lines[idx] = line;
  try {
    writeUserCrontab(lines);
    req.flash('success', 'Entry updated');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/cron');
});

router.post('/delete/:index', (req, res) => {
  const idx   = parseInt(req.params.index, 10);
  const lines = readUserCrontab();
  if (isNaN(idx) || idx < 0 || idx >= lines.length) {
    req.flash('error', 'Invalid entry');
    return res.redirect('/cron');
  }
  lines.splice(idx, 1);
  try {
    writeUserCrontab(lines);
    req.flash('success', 'Entry deleted');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/cron');
});

module.exports = router;
