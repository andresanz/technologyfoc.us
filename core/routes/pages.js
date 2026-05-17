'use strict';

const express               = require('express');
const { processShortcodes } = require('../lib/shortcodes');

module.exports = function createPagesRouter(pagesLib, postsLib) {
  const router = express.Router();

  // GET /:slug/edit — redirect to admin editor
  router.get('/:slug/edit', (req, res, next) => {
    const page = pagesLib.getBySlug(req.params.slug);
    if (!page) return next();
    const adminUrl = process.env.ADMIN_URL || 'https://admin.andresanz.com';
    const fname    = require('path').basename(page._filepath || (page.slug + '.md'));
    res.redirect(`${adminUrl}/pages/edit/${encodeURIComponent(fname)}`);
  });

  // GET /:slug — render a page (skip 'home' — handled at / in app-factory)
  router.get('/:slug', (req, res, next) => {
    const page = pagesLib.getBySlug(req.params.slug);
    if (!page) return next();

    const html = processShortcodes(page.html || '', postsLib, { page: req.query.page });
    res.render('page', {
      site:  res.app.locals.siteConfig(),
      pages: pagesLib.getNavPages(),
      page:  { ...page, html },
    });
  });

  return router;
};
