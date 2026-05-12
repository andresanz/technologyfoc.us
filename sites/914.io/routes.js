'use strict';

const express    = require('express');
const https      = require('https');
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');
const router     = express.Router();

const SUBMISSIONS_FILE = path.join(__dirname, 'data', 'submissions.json');
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || '';
const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';
const CONTACT_TO   = process.env.CONTACT_EMAIL  || 'sanz.andre@gmail.com';
const GMAIL_USER   = process.env.GMAIL_USER     || '';
const GMAIL_PASS   = process.env.GMAIL_APP_PASSWORD || '';

function verifyRecaptcha(token) {
  return new Promise((resolve) => {
    const body = `secret=${RECAPTCHA_SECRET}&response=${token}`;
    const req = https.request({
      hostname: 'www.google.com',
      path: '/recaptcha/api/siteverify',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ success: false }); }
      });
    });
    req.on('error', () => resolve({ success: false }));
    req.write(body);
    req.end();
  });
}

function saveSubmission(entry) {
  fs.mkdirSync(path.dirname(SUBMISSIONS_FILE), { recursive: true });
  let list = [];
  try { list = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8')); } catch {}
  list.push(entry);
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(list, null, 2));
}

async function sendEmail(entry) {
  if (!GMAIL_USER || !GMAIL_PASS) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
  await transporter.sendMail({
    from: `"914.io Contact" <${GMAIL_USER}>`,
    to: CONTACT_TO,
    replyTo: entry.email,
    subject: `Contact from ${entry.name} via 914.io`,
    text: `Name: ${entry.name}\nEmail: ${entry.email}\n\n${entry.message}`,
  });
}

router.get('/contact', (req, res) => {
  const site = res.app.locals.siteConfig();
  res.render('contact', {
    site,
    pageTitle: 'Contact',
    recaptchaSiteKey: RECAPTCHA_SITE_KEY,
    success: req.query.success === '1',
    error: req.query.error || null,
  });
});

router.post('/contact', async (req, res) => {
  const { name, email, message, 'g-recaptcha-response': token } = req.body;
  const site = res.app.locals.siteConfig();

  if (!name || !email || !message) {
    return res.render('contact', { site, pageTitle: 'Contact', recaptchaSiteKey: RECAPTCHA_SITE_KEY, success: false, error: 'All fields are required.' });
  }

  if (RECAPTCHA_SECRET) {
    const result = await verifyRecaptcha(token || '');
    if (!result.success || result.score < 0.5) {
      return res.render('contact', { site, pageTitle: 'Contact', recaptchaSiteKey: RECAPTCHA_SITE_KEY, success: false, error: 'reCAPTCHA verification failed. Please try again.' });
    }
  }

  const entry = { name, email, message, date: new Date().toISOString(), ip: req.ip };

  try { saveSubmission(entry); } catch (e) { console.error('contact save error:', e.message); }
  try { await sendEmail(entry); } catch (e) { console.error('contact email error:', e.message); }

  res.redirect('/contact?success=1');
});

module.exports = router;
