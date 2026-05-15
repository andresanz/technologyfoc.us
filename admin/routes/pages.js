'use strict';

const express  = require('express');
const fs       = require('fs');
const postsLib = require('../lib/posts'); // pages use same read/write helpers
const gitLib   = require('../lib/git');
const sitesLib = require('../lib/sites');
const router   = express.Router();

// GET /pages — list pages
router.get('/', (req, res) => {
  const site = req.site;

  if (!fs.existsSync(site.pagesDir)) fs.mkdirSync(site.pagesDir, { recursive: true });
  let pages = postsLib.list(site.pagesDir);

  const status = req.query.status || 'published';
  if (status === 'drafts') {
    pages = pages.filter(p => p.draft);
  } else {
    pages = pages.filter(p => !p.draft);
  }

  res.render('pages', { site, pages, status, flash: req.flash() });
});

// GET /pages/new
router.get('/new', (req, res) => {
  const site = req.site;

  res.render('page-edit', {
    site,
    page:  { filename: '', slug: '', title: '', order: '', nav: true, draft: false, body: '' },
    isNew: true,
    flash: req.flash(),
  });
});

// POST /pages/new
router.post('/new', async (req, res) => {
  const site = req.site;

  if (!fs.existsSync(site.pagesDir)) fs.mkdirSync(site.pagesDir, { recursive: true });

  const { title, slug, order, nav, draft, body } = req.body;
  const finalSlug = slug || postsLib.slugify(title);
  const filename  = `${finalSlug}.md`;

  try {
    postsLib.write(site.pagesDir, filename, {
      title, slug: finalSlug,
      order: order ? parseInt(order, 10) : undefined,
      nav:   nav !== '0',
      draft: !!draft,
      body,
    });
    await sitesLib.bustCache(site).catch(() => {});
    gitLib.autoCommit(site, `Create page: ${title}`);
    req.flash('success', `Page "${title}" created`);
    res.redirect('/pages');
  } catch (e) {
    req.flash('error', e.message);
    res.redirect('/pages/new');
  }
});

// GET /pages/edit/:filename
router.get('/edit/:filename', (req, res) => {
  const site = req.site;

  const page = postsLib.read(site.pagesDir, req.params.filename);
  if (!page) return res.status(404).render('error', { code: 404, message: 'Page not found' });

  res.render('page-edit', { site, page, isNew: false, flash: req.flash() });
});

// POST /pages/edit/:filename
router.post('/edit/:filename', async (req, res) => {
  const site = req.site;

  const { title, slug, order, nav, draft, body } = req.body;

  try {
    postsLib.write(site.pagesDir, req.params.filename, {
      title, slug,
      order: order ? parseInt(order, 10) : undefined,
      nav:   nav !== '0',
      draft: !!draft,
      body,
    });
    await sitesLib.bustCache(site).catch(() => {});
    gitLib.autoCommit(site, `Save page: ${title}`);
    req.flash('success', 'Page saved');
    res.redirect(`/pages/edit/${req.params.filename}`);
  } catch (e) {
    req.flash('error', e.message);
    res.redirect(`/pages/edit/${req.params.filename}`);
  }
});

// POST /pages/delete/:filename
router.post('/delete/:filename', async (req, res) => {
  const site = req.site;

  try {
    postsLib.remove(site.pagesDir, req.params.filename);
    await sitesLib.bustCache(site).catch(() => {});
    gitLib.autoCommit(site, `Delete page: ${req.params.filename}`);
    req.flash('success', 'Page deleted');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/pages');
});

module.exports = router;
