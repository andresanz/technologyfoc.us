'use strict';

const express = require('express');

const COOKIE  = '_priv';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

module.exports = function createPrivateRouter(postsLib, pagesLib, gratitudeFile) {
  const router = express.Router();

  function authed(req) {
    const pw = process.env.PRIVATE_PASSWORD;
    if (!pw) return false;
    return req.cookies && req.cookies[COOKIE] === pw;
  }

  // GET /private — login form or redirect to list
  router.get('/', (req, res) => {
    if (!authed(req)) return res.render('private-login', { error: null, site: req.app.locals.siteConfig() });
    res.redirect('/private/posts');
  });

  // POST /private — login
  router.post('/', express.urlencoded({ extended: false }), (req, res) => {
    const pw = process.env.PRIVATE_PASSWORD;
    if (!pw || req.body.password !== pw) {
      return res.render('private-login', { error: 'Wrong password', site: req.app.locals.siteConfig() });
    }
    res.cookie(COOKIE, pw, { maxAge: MAX_AGE, httpOnly: true, sameSite: 'lax', path: '/' });
    res.redirect('/private/posts');
  });

  // GET /private/posts — post list
  router.get('/posts', (req, res) => {
    if (!authed(req)) return res.redirect('/private');
    const posts = postsLib.getAll({ includeDrafts: false });
    res.render('private-index', { posts, site: req.app.locals.siteConfig() });
  });

  // GET /private/posts/:slug/edit — redirect to admin editor
  router.get('/posts/:slug/edit', (req, res) => {
    if (!authed(req)) return res.redirect('/private');
    const post = postsLib.getBySlug(req.params.slug);
    if (!post) return res.status(404).render('error', { code: 404, message: 'Post not found', site: req.app.locals.siteConfig() });
    const adminUrl = process.env.ADMIN_URL || 'https://admin.andresanz.com';
    const fname = require('path').basename(post._filepath);
    res.redirect(`${adminUrl}/posts/edit/${encodeURIComponent(fname)}`);
  });

  // GET /private/posts/:slug — individual post
  router.get('/posts/:slug', (req, res) => {
    if (!authed(req)) return res.redirect('/private');
    const post = postsLib.getBySlug(req.params.slug);
    if (!post) return res.status(404).render('error', { code: 404, message: 'Post not found', site: req.app.locals.siteConfig() });
    res.render('private-post', { post, site: req.app.locals.siteConfig() });
  });

  // GET /private/pages — page list
  router.get('/pages', (req, res) => {
    if (!authed(req)) return res.redirect('/private');
    const pages = pagesLib.getNavPages();
    res.render('private-pages', { pages, site: req.app.locals.siteConfig() });
  });

  // GET /private/gratitude — journal entries
  router.get('/gratitude', (req, res) => {
    if (!authed(req)) return res.redirect('/private');
    const fs = require('fs');
    let entries = [];
    try { entries = JSON.parse(fs.readFileSync(gratitudeFile, 'utf8')).reverse(); } catch {}
    res.render('private-gratitude', { entries, site: req.app.locals.siteConfig() });
  });

  // GET /private/logout
  router.get('/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect('/private');
  });

  // GET /private/:slug — post or page (must be last)
  router.get('/:slug', (req, res) => {
    if (!authed(req)) return res.redirect('/private');
    const slug = req.params.slug;
    const post = postsLib.getBySlug(slug);
    if (post) {
      const rendered = postsLib.renderPost ? postsLib.renderPost(post) : post;
      return res.render('private-post', { post: rendered, site: req.app.locals.siteConfig() });
    }
    const page = pagesLib.getBySlug(slug);
    if (page) return res.render('private-page', { page, site: req.app.locals.siteConfig() });
    res.status(404).render('error', { code: 404, message: 'Not found', site: req.app.locals.siteConfig() });
  });

  return router;
};
