'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const router   = express.Router();

router.get('/', (req, res) => {
  const linksFile = path.join(req.site.pagesDir, '..', 'private-pages', 'links.md');
  const content = fs.existsSync(linksFile) ? fs.readFileSync(linksFile, 'utf8') : '';
  res.render('links', { site: req.site, content, flash: req.flash() });
});

router.post('/save', (req, res) => {
  const linksFile = path.join(req.site.pagesDir, '..', 'private-pages', 'links.md');
  fs.mkdirSync(path.dirname(linksFile), { recursive: true });
  fs.writeFileSync(linksFile, req.body.content || '', 'utf8');
  req.flash('success', 'Saved');
  res.redirect('/links');
});

module.exports = router;
