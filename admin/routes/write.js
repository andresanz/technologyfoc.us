'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const sitesLib = require('../lib/sites');
const postsLib = require('../lib/posts');
const router   = express.Router();

const TEMPLATES_FILE = path.join(__dirname, '..', 'data', 'post-templates.json');
function loadTemplates() {
  try { return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')); }
  catch { return []; }
}

// GET /write — new post form (same UI as /posts/:domain/new, site from ?site= query)
router.get('/', (req, res) => {
  const sites  = sitesLib.getAll();
  const domain = req.query.site || (sites[0] && sites[0].domain) || '';
  const site   = sitesLib.getSite(domain);

  if (!site) {
    req.flash('error', 'No active site selected');
    return res.redirect('/sites');
  }

  const today = new Date().toISOString().split('T')[0];
  res.render('post-edit', {
    site,
    sites,
    post:      { filename: '', slug: '', title: '', date: today, tags: '', excerpt: '', image: '', draft: false, body: '' },
    isNew:     true,
    isPrivate: false,
    templates: loadTemplates(),
    allTags:   postsLib.getAllTags(site),
  });
});

module.exports = router;
