'use strict';

const express = require('express');

const COOKIE  = '_priv';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

module.exports = function createPrivateRouter(postsLib) {
  const router = express.Router();

  function authed(req) {
    const pw = process.env.PRIVATE_PASSWORD;
    if (!pw) return false;
    return req.cookies && req.cookies[COOKIE] === pw;
  }

  // GET /private
  router.get('/', (req, res) => {
    if (!authed(req)) return res.render('private-login', { error: null, site: res.locals.siteConfig() });
    const posts = postsLib.getAll({ includeDrafts: false });
    res.render('private-index', { posts, site: res.locals.siteConfig() });
  });

  // POST /private — login
  router.post('/', express.urlencoded({ extended: false }), (req, res) => {
    const pw = process.env.PRIVATE_PASSWORD;
    if (!pw || req.body.password !== pw) {
      return res.render('private-login', { error: 'Wrong password', site: res.locals.siteConfig() });
    }
    res.cookie(COOKIE, pw, { maxAge: MAX_AGE, httpOnly: true, sameSite: 'lax', path: '/' });
    res.redirect('/private');
  });

  // GET /private/post/:slug
  router.get('/post/:slug', (req, res) => {
    if (!authed(req)) return res.redirect('/private');
    const post = postsLib.getBySlug(req.params.slug);
    if (!post) return res.status(404).render('error', { code: 404, message: 'Post not found', site: res.locals.siteConfig() });
    res.render('private-post', { post, site: res.locals.siteConfig() });
  });

  // GET /private/logout
  router.get('/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect('/private');
  });

  return router;
};
