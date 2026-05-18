'use strict';

const express = require('express');
const sl      = require('../lib/shortlinks');
const gitLib  = require('../lib/git');
const router  = express.Router();

// GET /shortlinks
router.get('/', (req, res) => {
  res.render('shortlinks', { links: sl.load(), flash: req.flash() });
});

// POST /shortlinks/new
router.post('/new', (req, res) => {
  const { code, url, label } = req.body;
  if (!code || !url) {
    req.flash('error', 'Code and URL are required');
    return res.redirect('/shortlinks');
  }
  const safe = code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!safe) {
    req.flash('error', 'Invalid code — use letters, numbers, - or _');
    return res.redirect('/shortlinks');
  }
  const links = sl.load();
  if (links.find(l => l.code === safe)) {
    req.flash('error', `Code "${safe}" already exists`);
    return res.redirect('/shortlinks');
  }
  links.unshift({ code: safe, url: url.trim(), label: (label || '').trim(), hits: 0, created: new Date().toISOString().split('T')[0] });
  sl.save(links);
  gitLib.autoCommit(req.site, `Add shortlink: /r/${safe}`);
  req.flash('success', `Created /r/${safe}`);
  res.redirect('/shortlinks');
});

// POST /shortlinks/delete
router.post('/delete', (req, res) => {
  const { code } = req.body;
  const links = sl.load().filter(l => l.code !== code);
  sl.save(links);
  gitLib.autoCommit(req.site, `Delete shortlink: /r/${code}`);
  req.flash('success', `Deleted /r/${code}`);
  res.redirect('/shortlinks');
});

// POST /shortlinks/edit
router.post('/edit', (req, res) => {
  const { code, url, label } = req.body;
  const links = sl.load();
  const l = links.find(l => l.code === code);
  if (l) {
    l.url   = url.trim();
    l.label = (label || '').trim();
    sl.save(links);
    gitLib.autoCommit(req.site, `Update shortlink: /r/${code}`);
    req.flash('success', `Updated /r/${code}`);
  }
  res.redirect('/shortlinks');
});

module.exports = router;
