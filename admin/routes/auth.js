'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const router   = express.Router();

const AUTH_COOKIE  = '_admin';
const AUTH_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function makeToken() {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'changeme')
               .update('admin_auth').digest('hex');
}

function getAuthCookie(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(s => s.trim()).find(s => s.startsWith(AUTH_COOKIE + '='));
  return match ? match.slice(AUTH_COOKIE.length + 1) : null;
}

function isAuthed(req) { return getAuthCookie(req) === makeToken(); }

// Simple rate limiter — track failed attempts in memory
const attempts = new Map(); // ip → { count, resetAt }

function rateCheck(req, res, next) {
  const ip  = req.ip;
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };

  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 15 * 60 * 1000; }
  if (rec.count >= 10) {
    const wait = Math.ceil((rec.resetAt - now) / 60000);
    return res.status(429).render('login', { error: `Too many attempts. Try again in ${wait} min.` });
  }
  next();
}

function recordFail(ip) {
  const rec = attempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  rec.count++;
  attempts.set(ip, rec);
}

// GET /login
router.get('/login', (req, res) => {
  if (isAuthed(req)) return res.redirect('/write');
  res.render('login', { error: req.flash('error')[0] || null });
});

// POST /login
router.post('/login', rateCheck, (req, res) => {
  const { password } = req.body;
  const stored       = process.env.ADMIN_PASSWORD || '';

  const ok = stored.startsWith('$2')
    ? bcrypt.compareSync(password, stored)
    : password === stored;

  if (!ok) {
    recordFail(req.ip);
    req.flash('error', 'Incorrect password');
    return res.redirect('/login');
  }

  attempts.delete(req.ip);
  res.cookie(AUTH_COOKIE, makeToken(), {
    maxAge:   AUTH_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
  });
  res.redirect('/write');
});

// POST /logout
router.post('/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
  res.redirect('/login');
});

// Root redirect
router.get('/', (req, res) => {
  res.redirect(isAuthed(req) ? '/write' : '/login');
});

module.exports = router;
