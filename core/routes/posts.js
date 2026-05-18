'use strict';

const express  = require('express');
const PER_PAGE = parseInt(process.env.PER_PAGE) || 5;

module.exports = function createPostsRouter(postsLib, pagesLib, privatePostsLib) {
  const router = express.Router();

  // ── Homepage ──────────────────────────────────────────────────────────────
  router.get('/', (req, res) => {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const all   = postsLib.getAll();
    const items = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    res.render('index', {
      site:       req.app.locals.siteConfig(),
      posts:      items,
      page,
      totalPages: Math.ceil(all.length / PER_PAGE),
      tag:        null,
    });
  });

  // ── Tags index ────────────────────────────────────────────────────────────
  router.get('/tags', (req, res) => {
    res.render('tags', {
      site: req.app.locals.siteConfig(),
      tags: postsLib.getAllTags(),
    });
  });

  // ── Tag filter ────────────────────────────────────────────────────────────
  router.get('/tag/:tag', (req, res) => {
    const tag   = req.params.tag;
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const all   = postsLib.getByTag(tag);
    const items = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    if (all.length === 0) {
      return res.status(404).render('error', {
        site: req.app.locals.siteConfig(),
        code: 404, message: `No posts tagged "${tag}"`,
      });
    }

    res.render('index', {
      site:       req.app.locals.siteConfig(),
      posts:      items,
      page,
      totalPages: Math.ceil(all.length / PER_PAGE),
      tag,
    });
  });

  // ── Single post ───────────────────────────────────────────────────────────
  // /post/:slug/edit  — redirect to admin editor
  router.get('/post/:slug/edit', (req, res) => {
    const post   = postsLib.getBySlug(req.params.slug);
    if (!post) return res.redirect('/');
    const adminUrl = process.env.ADMIN_URL || 'https://admin.andresanz.com';
    const fname = require("path").basename(post._filepath);
    res.redirect(`${adminUrl}/posts/edit/${encodeURIComponent(fname)}`);
  });

  router.get(['/post/:slug', '/posts/:slug'], (req, res) => {
    const post = postsLib.getBySlug(req.params.slug);
    if (!post) {
      return res.status(404).render('error', {
        site: req.app.locals.siteConfig(),
        code: 404, message: 'Post not found',
      });
    }
    res.render('post', { site: req.app.locals.siteConfig(), post });
  });

  // ── Cache bust ────────────────────────────────────────────────────────────
  router.post('/_bust', (req, res) => {
    if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    postsLib.bust();
    if (pagesLib) pagesLib.bust();
    if (privatePostsLib) privatePostsLib.bust();
    res.json({ ok: true, message: 'Cache cleared' });
  });

  return router;
};
