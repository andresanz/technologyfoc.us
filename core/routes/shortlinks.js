'use strict';

const fs      = require('fs');
const express = require('express');
const router  = express.Router();

const FILE = process.env.SHORTLINKS_FILE;

router.get('/:code', (req, res) => {
  if (!FILE) return res.status(404).render('error', { site: req.app.locals.siteConfig(), code: 404, message: 'Not found' });

  try {
    const links = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const link  = links.find(l => l.code === req.params.code);
    if (!link) return res.status(404).render('error', { site: req.app.locals.siteConfig(), code: 404, message: 'Short link not found' });

    // Increment hit count — best-effort, don't let it block the redirect
    try {
      link.hits = (link.hits || 0) + 1;
      fs.writeFileSync(FILE, JSON.stringify(links, null, 2) + '\n', 'utf8');
    } catch {}

    res.redirect(301, link.url);
  } catch {
    res.status(404).render('error', { site: req.app.locals.siteConfig(), code: 404, message: 'Not found' });
  }
});

module.exports = router;
