'use strict';

const express  = require('/var/www/blog-core/node_modules/express');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const postsLib = require('/var/www/blog-core/lib/posts');
const md       = require('/var/www/blog-core/lib/md');
const matter   = require('/var/www/blog-core/node_modules/gray-matter');

function makeToken(key) {
  return crypto.createHmac('sha256', key).update('private-ok').digest('hex');
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx < 0) return;
      const k = pair.slice(0, idx).trim();
      const v = decodeURIComponent(pair.slice(idx + 1).trim());
      list[k] = v;
    });
  }
  return list;
}

function loadHomeContent(siteDir) {
  const file = path.join(siteDir, 'content', 'pages', 'private-home.md');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const { content } = matter(raw);
    return md.render(content);
  } catch {
    return null;
  }
}

module.exports = function createPrivateRouter(siteDir) {
  const router   = express.Router();
  const postsDir = path.join(siteDir, 'content', 'private-posts');
  const posts    = postsLib(postsDir);
  const navFile  = path.join(siteDir, 'content', 'nav.json');
  const PER_PAGE = parseInt(process.env.PER_PAGE) || 5;

  // Inject nav locals
  router.use((req, res, next) => {
    try {
      const all        = JSON.parse(fs.readFileSync(navFile, 'utf8'));
      res.locals.nav       = all.filter(i => i.enabled !== false);
      res.locals.navLoaded = true;
    } catch {
      res.locals.nav       = null;
      res.locals.navLoaded = false;
    }
    res.locals.pages     = [];
    res.locals.postsPath = '/';
    next();
  });

  // ── Auth helpers ──────────────────────────────────────────────────────────

  const COOKIE_NAME = 'private_auth';
  const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

  function isAuthed(req) {
    const key = process.env.ADMIN_KEY;
    if (!key) return false;
    const cookies = parseCookies(req);
    return cookies[COOKIE_NAME] === makeToken(key);
  }

  function requireAuth(req, res, next) {
    if (isAuthed(req)) return next();
    res.redirect('/private/login');
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  router.get('/login', (req, res) => {
    if (isAuthed(req)) return res.redirect('/private');
    res.render('private-login', {
      site:  res.app.locals.siteConfig(),
      error: false,
    });
  });

  router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
    const key = process.env.ADMIN_KEY;
    if (key && req.body.password === key) {
      const token = makeToken(key);
      res.setHeader('Set-Cookie',
        `${COOKIE_NAME}=${token}; Path=/private; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`
      );
      return res.redirect('/private');
    }
    res.render('private-login', {
      site:  res.app.locals.siteConfig(),
      error: true,
    });
  });

  // ── Logout ────────────────────────────────────────────────────────────────

  router.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie',
      `${COOKIE_NAME}=; Path=/private; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    );
    res.redirect('/private/login');
  });

  // ── Protected routes ──────────────────────────────────────────────────────

  router.get('/', requireAuth, (req, res) => {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const all   = posts.getAll();
    const items = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    res.render('private-index', {
      site:       res.app.locals.siteConfig(),
      homeHtml:   loadHomeContent(siteDir),
      posts:      items,
      page,
      totalPages: Math.ceil(all.length / PER_PAGE),
    });
  });

  router.get('/:slug', requireAuth, (req, res, next) => {
    const post = posts.getBySlug(req.params.slug);
    if (!post) return next();
    res.render('private-post', {
      site: res.app.locals.siteConfig(),
      post,
    });
  });

  return router;
};
