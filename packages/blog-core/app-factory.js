'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');

const analytics  = require('./lib/analytics');
const CORE_DIR  = __dirname;
const CSS_VER   = (() => {
  try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); }
  catch { return Date.now().toString(); }
})();

/**
 * createApp(siteDir)
 *
 * Builds a fully configured Express app for a site.
 *
 * Resolution order for views:   siteDir/views  →  core/views
 * Resolution order for statics: siteDir/public →  core/public
 *
 * All site config is read from environment variables (set via the
 * site's .env file before calling createApp):
 *
 *   SITE_URL, SITE_TITLE, SITE_DESCRIPTION, SITE_AUTHOR
 *   PORT, ADMIN_KEY
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET
 */
function createApp(siteDir) {
  const app = express();

  // ── View engine — site views override core views ──────────────────────────
  app.set('view engine', 'ejs');
  app.set('views', [
    path.join(siteDir, 'views'),
    path.join(CORE_DIR, 'views'),
  ]);

  // ── Static files — site public overrides core public ─────────────────────
  // A site can drop a custom style.css in its own public/css/ to replace or
  // extend the core stylesheet.
  app.use(express.static(path.join(siteDir, 'public')));
  app.use(express.static(path.join(CORE_DIR, 'public')));

  // ── Request parsing ───────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  const _domain = (process.env.SITE_URL || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
  app.use(analytics.middleware(_domain));

  // ── Site config available to all routes and views ────────────────────────
  app.locals.cssVer = CSS_VER;
  app.locals.siteConfig = () => ({
    url:         process.env.SITE_URL         || '',
    title:       process.env.SITE_TITLE       || 'Blog',
    description: process.env.SITE_DESCRIPTION || '',
    author:      process.env.SITE_AUTHOR      || '',
    hideAuthor:  process.env.HIDE_AUTHOR === 'true',
    search:      process.env.ENABLE_SEARCH !== 'false',
    gaId:        process.env.GA_ID            || '',
  });

  // ── Posts + Pages libraries ───────────────────────────────────────────────
  const postsDir = path.join(siteDir, 'content', 'posts');
  const pagesDir = path.join(siteDir, 'content', 'pages');
  const postsLib = require('./lib/posts')(postsDir);
  const pagesLib = require('./lib/pages')(pagesDir);

  const { processShortcodes } = require('./lib/shortcodes');
  const PER_PAGE = parseInt(process.env.PER_PAGE) || 5;

  const navFile = path.join(siteDir, 'content', 'nav.json');

  // Inject nav into every view
  app.use((req, res, next) => {
    const hasHome        = !!pagesLib.getBySlug('home');
    res.locals.pages     = pagesLib.getNavPages().filter(p => p.slug !== 'home');
    res.locals.postsPath = hasHome ? '/posts' : '/';

    // Use nav.json if present, else auto-generate
    if (fs.existsSync(navFile)) {
      try {
        const all = JSON.parse(fs.readFileSync(navFile, 'utf8'));
        res.locals.nav       = all.filter(i => i.enabled !== false);
        res.locals.navLoaded = true;  // file exists — use it even if empty
      } catch {
        res.locals.nav = null; res.locals.navLoaded = false;
      }
    } else {
      res.locals.nav = null; res.locals.navLoaded = false;
    }
    next();
  });

  // ── Routes ────────────────────────────────────────────────────────────────

  // Home page — if a page with slug 'home' exists it takes over /
  app.get('/', (req, res, next) => {
    const home = pagesLib.getBySlug('home');
    if (!home) return next();
    const html = processShortcodes(home.html || '', postsLib, { page: req.query.page });
    res.render('page', {
      site: app.locals.siteConfig(),
      page: { ...home, html },
    });
  });

  // Post list also always reachable at /posts
  app.get('/posts', (req, res) => {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const all   = postsLib.getAll();
    const items = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    res.render('index', {
      site:       app.locals.siteConfig(),
      posts:      items,
      page,
      totalPages: Math.ceil(all.length / PER_PAGE),
      tag:        null,
    });
  });

  app.use('/',       require('./routes/posts')(postsLib, pagesLib));
  app.use('/upload', require('./routes/upload')());
  app.use('/feed',   require('./routes/feed')(postsLib));

  // ── Home page edit shortcut ───────────────────────────────────────────────
  app.get('/home/edit', (req, res) => {
    const home     = pagesLib.getBySlug('home');
    const domain   = (process.env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    const adminUrl = process.env.ADMIN_URL || 'https://admin.server02.andresanz.com';
    if (home) {
      const fname = require('path').basename(home._filepath || 'home.md');
      return res.redirect(`${adminUrl}/pages/${domain}/edit/${encodeURIComponent(fname)}`);
    }
    // No home page — go to posts list
    res.redirect(`${adminUrl}/posts/${domain}`);
  });

  // ── Edit mode toggle (sets cookie, redirects back) ────────────────────────
  app.get('/_admin/edit', (req, res) => {
    const on  = req.query.on !== '0';
    const back = req.query.back || '/';
    res.cookie('_admin_edit', on ? '1' : '', {
      maxAge: on ? 7 * 24 * 60 * 60 * 1000 : 0,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
    res.redirect(back);
  });

  // ── /gratitude — consolidated journal page ────────────────────────────────
  const gratitudeFile = path.join(siteDir, 'content', 'gratitude.json');
  app.get('/gratitude', (req, res) => {
    let entries = [];
    try { entries = JSON.parse(fs.readFileSync(gratitudeFile, 'utf8')); } catch {}
    entries = entries.slice().reverse(); // newest first
    res.render('gratitude', { site: app.locals.siteConfig(), entries, nav: res.locals.nav, navLoaded: res.locals.navLoaded, pages: res.locals.pages });
  });




  // ── Search ────────────────────────────────────────────────────────────────
  if (process.env.ENABLE_SEARCH !== 'false') app.get('/search', (req, res) => {
    const q       = (req.query.q || '').trim();
    const results = q.length >= 2 ? postsLib.search(q) : [];
    res.render('search', {
      site:      app.locals.siteConfig(),
      pageTitle: q ? `Search: ${q}` : 'Search',
      query:     q,
      results,
    });
  });

  app.use('/',       require('./routes/pages')(pagesLib, postsLib));

  // ── Site-specific routes (injected before 404) ────────────────────────────
  const siteRoutesFile = path.join(siteDir, 'routes.js');
  if (fs.existsSync(siteRoutesFile)) app.use('/', require(siteRoutesFile));

  // ── 404 ───────────────────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).render('error', {
      site:    app.locals.siteConfig(),
      code:    404,
      message: 'Page not found',
    });
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).render('error', {
      site:    app.locals.siteConfig(),
      code:    500,
      message: 'Something went wrong',
    });
  });

  return app;
}

module.exports = createApp;
