'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'overthinking-config.json');

function load() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { message: "Don't think too much.", imageUrl: '' }; }
}

function save(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

router.get('/', (req, res) => {
  res.render('overthinking', { config: load(), flash: req.flash() });
});

router.post('/', (req, res) => {
  const message  = (req.body.message  || '').trim();
  const imageUrl = (req.body.imageUrl || '').trim();
  if (message) {
    save({ message, imageUrl });
    req.flash('success', 'Settings saved');
  }
  res.redirect('/overthinking');
});

module.exports = router;
