'use strict';

const express      = require('express');
const nodemailer   = require('nodemailer');
const router       = express.Router();

// ── In-memory rate limiter: max 3 submissions per IP per hour ─────────────────
const ratemap = new Map(); // ip → [timestamps]
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_MAX    = 3;

function rateCheck(ip) {
  const now = Date.now();
  const hits = (ratemap.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (hits.length >= RATE_MAX) return false;
  hits.push(now);
  ratemap.set(ip, hits);
  return true;
}

// Clean up old entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of ratemap) {
    if (hits.every(t => now - t >= RATE_WINDOW)) ratemap.delete(ip);
  }
}, RATE_WINDOW);

function getTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// GET /contact
router.get('/contact', (req, res) => {
  res.render('contact', {
    site:    res.app.locals.siteConfig(),
    success: false,
    error:   null,
    values:  {},
  });
});

// POST /contact
router.post('/contact', async (req, res) => {
  const site   = res.app.locals.siteConfig();
  const render = (error, success = false) =>
    res.render('contact', { site, success, error, values: req.body });

  // Honeypot — bots fill this, humans don't see it
  if (req.body._hp && req.body._hp.trim()) {
    return render(null, true); // silently succeed for bots
  }

  const name    = (req.body.name    || '').trim().slice(0, 200);
  const email   = (req.body.email   || '').trim().slice(0, 200);
  const message = (req.body.message || '').trim().slice(0, 5000);

  if (!name || !email || !message) {
    return render('All fields are required.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return render('Please enter a valid email address.');
  }

  const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || '';
  if (!rateCheck(ip)) {
    return render('Too many messages sent. Please try again later.');
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.error('[contact] SMTP not configured');
    return render('Mail is not configured on this server. Please email directly.');
  }

  try {
    const to   = process.env.CONTACT_TO   || process.env.SMTP_USER;
    const from = process.env.CONTACT_FROM || `"${site.title}" <${process.env.SMTP_USER}>`;

    await getTransporter().sendMail({
      from,
      to,
      replyTo: `"${name}" <${email}>`,
      subject: `Contact form — ${site.title}`,
      text: `Name:    ${name}\nEmail:   ${email}\n\n${message}`,
      html: `<p><strong>Name:</strong> ${name}<br><strong>Email:</strong> ${email}</p><p>${message.replace(/\n/g, '<br>')}</p>`,
    });

    return render(null, true);
  } catch (e) {
    console.error('[contact] send error:', e.message);
    return render('Could not send message. Please try again or email directly.');
  }
});

module.exports = router;
