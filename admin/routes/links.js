'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const gitLib   = require('../lib/git');
const sitesLib = require('../lib/sites');
const router   = express.Router();

const LINKS_FILE = path.join(__dirname, '..', 'data', 'links.md');

router.get('/', (req, res) => {
  const content = fs.existsSync(LINKS_FILE) ? fs.readFileSync(LINKS_FILE, 'utf8') : '';
  res.render('links', { site: req.site, content, flash: req.flash() });
});

router.post('/save', (req, res) => {
  fs.writeFileSync(LINKS_FILE, req.body.content || '', 'utf8');
  req.flash('success', 'Saved');
  res.redirect('/links');
});

// POST /links/sync-bookmarks — receive parsed bookmark sections from browser
router.post('/sync-bookmarks', async (req, res) => {
  const site = req.site;
  const { markdown } = req.body;
  if (!markdown) return res.status(400).json({ error: 'no markdown' });

  const linksFile = path.join(site.pagesDir, 'links.md');
  try {
    fs.mkdirSync(path.dirname(linksFile), { recursive: true });
    fs.writeFileSync(linksFile, markdown, 'utf8');
    await sitesLib.bustCache(site).catch(() => {});
    gitLib.autoCommit(site, 'Sync bookmarks from Chrome');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
