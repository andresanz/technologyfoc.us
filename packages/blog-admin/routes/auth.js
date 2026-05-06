'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();

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
  if (req.session.authenticated) return res.redirect('/sites');
  res.render('login', { error: req.flash('error')[0] || null });
});

// POST /login
router.post('/login', rateCheck, (req, res) => {
  const { password } = req.body;
  const stored       = process.env.ADMIN_PASSWORD || '';

  // Support plain-text password in .env (auto-compare) OR bcrypt hash
  const ok = stored.startsWith('$2')
    ? bcrypt.compareSync(password, stored)
    : password === stored;

  if (!ok) {
    recordFail(req.ip);
    req.flash('error', 'Incorrect password');
    return res.redirect('/login');
  }

  attempts.delete(req.ip);
  req.session.authenticated = true;
  res.redirect('/sites');
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Root redirect
router.get('/', (req, res) => {
  res.redirect(req.session.authenticated ? '/sites' : '/login');
});

module.exports = router;
