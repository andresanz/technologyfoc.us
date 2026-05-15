'use strict';

const express = require('express');

const COOKIE  = '_priv';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

module.exports = function createPrivateRouter(postsLib, pagesLib) {
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

  // GET /private/posts/:slug — individual post
  router.get('/posts/:slug', (req, res) => {
    if (!authed(req)) return res.redirect('/private');
    const post = postsLib.getBySlug(req.params.slug);
    if (!post) return res.status(404).render('error', { code: 404, message: 'Post not found', site: req.app.locals.siteConfig() });
    res.render('private-post', { post, site: req.app.locals.siteConfig() });
  });

  // GET /private/pages/:slug
  router.get('/pages/:slug', (req, res) => {
    if (!authed(req)) return res.redirect('/private');
    const page = pagesLib.getBySlug(req.params.slug);
    if (!page) return res.status(404).render('error', { code: 404, message: 'Page not found', site: req.app.locals.siteConfig() });
    res.render('private-page', { page, site: req.app.locals.siteConfig() });
  });

  // GET /private/logout
  router.get('/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect('/private');
  });

  return router;
};
