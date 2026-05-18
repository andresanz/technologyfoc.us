'use strict';

const express      = require('express');
const cookieParser = require('cookie-parser');
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
  app.use(cookieParser());
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
  const postsDir         = path.join(siteDir, 'content', 'posts');
  const privatePostsDir  = path.join(siteDir, 'content', 'private-posts');
  const pagesDir         = path.join(siteDir, 'content', 'pages');
  const privatePagesDir  = path.join(siteDir, 'content', 'private-pages');
  const postsLib         = require('./lib/posts')(postsDir);
  const privatePostsLib  = require('./lib/posts')(privatePostsDir);
  const pagesLib         = require('./lib/pages')(pagesDir);
  const privatePagesLib  = require('./lib/pages')(privatePagesDir);
  const gratitudeFile    = path.join(siteDir, 'content', 'gratitude.json');

  const { processShortcodes } = require('./lib/shortcodes');
  const PER_PAGE = parseInt(process.env.PER_PAGE) || 5;

  const navFile = path.join(siteDir, 'content', 'nav.json');

  // Cache parsed nav.json — re-read only when the file's mtime changes.
  let navCache = { mtime: 0, parsed: null };
  function loadNav() {
    let stat;
    try { stat = fs.statSync(navFile); } catch { navCache = { mtime: 0, parsed: null }; return null; }
    const mtime = stat.mtimeMs;
    if (navCache.mtime === mtime && navCache.parsed) return navCache.parsed;
    try {
      const raw   = JSON.parse(fs.readFileSync(navFile, 'utf8'));
      const isObj = raw && !Array.isArray(raw);
      const parsed = {
        allNav:     isObj ? (raw.nav        || []) : raw,
        homeNav:    isObj ? (raw.homeNav    || null) : null,
        privateNav: isObj ? (raw.privateNav || null) : null,
      };
      navCache = { mtime, parsed };
      return parsed;
    } catch {
      navCache = { mtime, parsed: null };
      return null;
    }
  }

  // Inject nav into every view
  app.use((req, res, next) => {
    res.locals.adminUrl  = process.env.ADMIN_URL || 'https://admin.andresanz.com';
    const hasHome        = !!pagesLib.getBySlug('home');
    res.locals.pages     = pagesLib.getNavPages().filter(p => p.slug !== 'home');
    res.locals.postsPath = hasHome ? '/posts' : '/';

    const parsed = loadNav();
    if (parsed) {
      const isHome    = req.path === '/';
      const isPrivate = req.path.startsWith('/private');
      let items = parsed.allNav;
      if (isHome    && parsed.homeNav)    items = parsed.homeNav;
      if (isPrivate && parsed.privateNav) items = parsed.privateNav;
      res.locals.nav       = items.filter(i => i.enabled !== false);
      res.locals.navLoaded = true;
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

  // ── Site-specific routes (before core post/page routes so / can be overridden) ──
  const siteRoutesFile = path.join(siteDir, 'routes.js');
  if (fs.existsSync(siteRoutesFile)) app.use('/', require(siteRoutesFile));

  app.use('/',        require('./routes/posts')(postsLib, pagesLib, privatePostsLib));
  app.use('/private', require('./routes/private')(privatePostsLib, privatePagesLib, gratitudeFile));
  app.use('/upload',  require('./routes/upload')());
  app.use('/feed',    require('./routes/feed')(postsLib));

  // ── Home page edit shortcut ───────────────────────────────────────────────
  app.get('/home/edit', (req, res) => {
    const home     = pagesLib.getBySlug('home');
    const adminUrl = process.env.ADMIN_URL || 'https://admin.andresanz.com';
    if (home) {
      const fname = require('path').basename(home._filepath || 'home.md');
      return res.redirect(`${adminUrl}/pages/edit/${encodeURIComponent(fname)}`);
    }
    res.redirect(`${adminUrl}/posts`);
  });

// ── Pages index ──────────────────────────────────────────────────────────
  app.get('/pages', (req, res) => {
    const pages = pagesLib.getNavPages().filter(p => p.slug !== 'home');
    res.render('pages-index', { site: app.locals.siteConfig(), pages });
  });

  // ── Search ────────────────────────────────────────────────────────────────
  if (process.env.ENABLE_SEARCH !== 'false') app.get('/search', (req, res) => {
    const q       = (Array.isArray(req.query.q) ? req.query.q[0] : req.query.q || '').trim();
    const results = q.length >= 2 ? postsLib.search(q) : [];
    res.render('search', {
      site:      app.locals.siteConfig(),
      pageTitle: q ? `Search: ${q}` : 'Search',
      query:     q,
      results,
    });
  });

  app.use('/',       require('./routes/pages')(pagesLib, postsLib));

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
