'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'daily-check-config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { sites: [], diskWarnPct: 85 }; }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

router.get('/', (req, res) => {
  res.render('daily-check', { config: loadConfig(), flash: req.flash() });
});

router.post('/', (req, res) => {
  const sites = (req.body.sites || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
  const diskWarnPct = Math.min(100, Math.max(1, parseInt(req.body.diskWarnPct) || 85));
  saveConfig({ sites, diskWarnPct });
  req.flash('success', 'Saved');
  res.redirect('/daily-check');
});

module.exports = router;
