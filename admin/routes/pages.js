'use strict';

const express  = require('express');
const fs       = require('fs');
const postsLib = require('../lib/posts'); // pages use same read/write helpers
const gitLib   = require('../lib/git');
const sitesLib = require('../lib/sites');
const router   = express.Router();

// GET /pages — list pages (public + private)
router.get('/', (req, res) => {
  const site = req.site;

  if (!fs.existsSync(site.pagesDir)) fs.mkdirSync(site.pagesDir, { recursive: true });
  const publicPages  = postsLib.list(site.pagesDir).map(p => ({ ...p, isPrivate: false }));
  const privatePages = site.privatePagesDir ? postsLib.list(site.privatePagesDir).map(p => ({ ...p, isPrivate: true })) : [];

  const status     = req.query.status     || 'published';
  const visibility = req.query.visibility || 'all';
  let pages = [...publicPages, ...privatePages];
  if (status === 'drafts') pages = pages.filter(p => p.draft);
  else                     pages = pages.filter(p => !p.draft);
  if (visibility === 'public')  pages = pages.filter(p => !p.isPrivate);
  if (visibility === 'private') pages = pages.filter(p =>  p.isPrivate);

  res.render('pages', { site, pages, status, visibility, flash: req.flash() });
});

// GET /pages/new
router.get('/new', (req, res) => {
  const site = req.site;
  const isPrivate = req.query.dir === 'private-pages';
  res.render('page-edit', {
    site,
    page:  { filename: '', slug: '', title: '', order: '', nav: true, draft: false, body: '' },
    isNew: true,
    isPrivate,
    flash: req.flash(),
  });
});

// POST /pages/new
router.post('/new', async (req, res) => {
  const site = req.site;
  const isPrivate = req.query.dir === 'private-pages';
  const dir = isPrivate ? site.privatePagesDir : site.pagesDir;
  const dirParam = isPrivate ? '?dir=private-pages' : '';

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const { title, slug, order, nav, draft, body } = req.body;
  const finalSlug = slug || postsLib.slugify(title);
  const filename  = `${finalSlug}.md`;

  try {
    postsLib.write(dir, filename, {
      title, slug: finalSlug,
      order: order ? parseInt(order, 10) : undefined,
      nav:   nav !== '0',
      draft: !!draft,
      body,
    });
    await sitesLib.bustCache(site).catch(() => {});
    gitLib.autoCommit(site, `Create ${isPrivate ? 'private ' : ''}page: ${title}`);
    req.flash('success', `Page "${title}" created`);
    res.redirect('/pages');
  } catch (e) {
    req.flash('error', e.message);
    res.redirect('/pages/new' + dirParam);
  }
});

// GET /pages/edit/:filename
router.get('/edit/:filename', (req, res) => {
  const site = req.site;
  let isPrivate = req.query.dir === 'private-pages';
  let dir = isPrivate ? site.privatePagesDir : site.pagesDir;

  let page = postsLib.read(dir, req.params.filename);
  if (!page && !isPrivate && site.privatePagesDir) {
    // auto-detect: try private-pages dir
    page = postsLib.read(site.privatePagesDir, req.params.filename);
    if (page) { isPrivate = true; dir = site.privatePagesDir; }
  }
  if (!page) return res.status(404).render('error', { code: 404, message: 'Page not found' });

  res.render('page-edit', { site, page, isNew: false, isPrivate, flash: req.flash() });
});

// POST /pages/edit/:filename
router.post('/edit/:filename', async (req, res) => {
  const site = req.site;
  const isPrivate = req.query.dir === 'private-pages';
  const dir = isPrivate ? site.privatePagesDir : site.pagesDir;
  const dirParam = isPrivate ? '?dir=private-pages' : '';

  const { title, slug, order, nav, draft, body } = req.body;

  // Preserve the existing date — pages have no date input
  const existing = postsLib.read(dir, req.params.filename);
  const existingDate = existing?.date || undefined;

  try {
    postsLib.write(dir, req.params.filename, {
      title, slug,
      date:  existingDate,
      order: order ? parseInt(order, 10) : undefined,
      nav:   nav === '1',
      draft: !!draft,
      body,
    });
    await sitesLib.bustCache(site).catch(() => {});
    gitLib.autoCommit(site, `Save page: ${title}`);
    req.flash('success', 'Page saved');
    res.redirect(`/pages/edit/${req.params.filename}${dirParam}`);
  } catch (e) {
    req.flash('error', e.message);
    res.redirect(`/pages/edit/${req.params.filename}${dirParam}`);
  }
});

// POST /pages/delete/:filename
router.post('/delete/:filename', async (req, res) => {
  const site = req.site;
  const dir = req.query.dir === 'private-pages' ? site.privatePagesDir : site.pagesDir;

  try {
    postsLib.remove(dir, req.params.filename);
    await sitesLib.bustCache(site).catch(() => {});
    gitLib.autoCommit(site, `Delete page: ${req.params.filename}`);
    req.flash('success', 'Page deleted');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/pages');
});

// GET /pages/footer — edit footer.md
router.get('/footer', (req, res) => {
  const site = req.site;
  const footerFile = require('path').join(site.dir, 'content', 'footer.md');
  let body = '';
  try { body = fs.readFileSync(footerFile, 'utf8'); } catch {}
  res.render('footer-edit', { site, body, flash: req.flash() });
});

// POST /pages/footer — save footer.md
router.post('/footer', async (req, res) => {
  const site = req.site;
  const footerFile = require('path').join(site.dir, 'content', 'footer.md');
  try {
    fs.mkdirSync(require('path').dirname(footerFile), { recursive: true });
    fs.writeFileSync(footerFile, req.body.body || '', 'utf8');
    await require('../lib/sites').bustCache(site).catch(() => {});
    gitLib.autoCommit(site, 'Update footer.md');
    req.flash('success', 'Footer saved');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/pages/footer');
});

module.exports = router;
