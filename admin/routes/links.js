'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const LINKS_FILE = path.join(__dirname, '..', 'data', 'links.md');

router.get('/', (req, res) => {
  const content = fs.existsSync(LINKS_FILE) ? fs.readFileSync(LINKS_FILE, 'utf8') : '';
  res.render('links', { content, flash: req.flash() });
});

router.post('/save', (req, res) => {
  fs.writeFileSync(LINKS_FILE, req.body.content || '', 'utf8');
  req.flash('success', 'Saved');
  res.redirect('/links');
});

module.exports = router;
