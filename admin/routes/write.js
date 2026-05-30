'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const postsLib = require('../lib/posts');
const router   = express.Router();

const TEMPLATES_FILE = path.join(__dirname, '..', 'data', 'post-templates.json');
function loadTemplates() {
  try { return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')); }
  catch { return []; }
}

// GET /write — new post form
router.get('/', (req, res) => {
  const site = req.site;
  const today = new Date().toISOString().split('T')[0];
  res.render('post-edit', {
    site,
    post:      { filename: '', slug: '', title: '', date: today, tags: '', excerpt: '', image: '', draft: false, body: '' },
    isNew:     true,
    isPrivate: false,
    templates: loadTemplates(),
    allTags:   postsLib.getAllTags(site),
  });
});

module.exports = router;
