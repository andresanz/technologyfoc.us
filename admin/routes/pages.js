'use strict';

const express  = require('express');
const fs       = require('fs');
const sitesLib = require('../lib/sites');
const postsLib = require('../lib/posts'); // pages use same read/write helpers
const gitLib   = require('../lib/git');
const router   = express.Router();

// GET /pages/:domain — list pages
router.get('/:domain', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  if (!fs.existsSync(site.pagesDir)) fs.mkdirSync(site.pagesDir, { recursive: true });
  const pages = postsLib.list(site.pagesDir);
  res.render('pages', { site, pages, flash: req.flash() });
});

// GET /pages/:domain/new
router.get('/:domain/new', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  res.render('page-edit', {
    site,
    page:  { filename: '', slug: '', title: '', order: '', nav: true, draft: false, body: '' },
    isNew: true,
    flash: req.flash(),
  });
});

// POST /pages/:domain/new
router.post('/:domain/new', async (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

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
    res.redirect(`/pages/${req.params.domain}`);
  } catch (e) {
    req.flash('error', e.message);
    res.redirect(`/pages/${req.params.domain}/new`);
  }
});

// GET /pages/:domain/edit/:filename
router.get('/:domain/edit/:filename', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  const page = postsLib.read(site.pagesDir, req.params.filename);
  if (!page) return res.status(404).render('error', { code: 404, message: 'Page not found' });

  res.render('page-edit', { site, page, isNew: false, flash: req.flash() });
});

// POST /pages/:domain/edit/:filename
router.post('/:domain/edit/:filename', async (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

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
    res.redirect(`/pages/${req.params.domain}/edit/${req.params.filename}`);
  } catch (e) {
    req.flash('error', e.message);
    res.redirect(`/pages/${req.params.domain}/edit/${req.params.filename}`);
  }
});

// POST /pages/:domain/delete/:filename
router.post('/:domain/delete/:filename', async (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  try {
    postsLib.remove(site.pagesDir, req.params.filename);
    await sitesLib.bustCache(site).catch(() => {});
    gitLib.autoCommit(site, `Delete page: ${req.params.filename}`);
    req.flash('success', 'Page deleted');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect(`/pages/${req.params.domain}`);
});

module.exports = router;
