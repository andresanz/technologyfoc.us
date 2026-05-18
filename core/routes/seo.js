'use strict';

const express = require('express');

module.exports = function createSeoRouter(postsLib, pagesLib) {
  const router = express.Router();

  // ── robots.txt ───────────────────────────────────────────────────────────────
  router.get('/robots.txt', (req, res) => {
    const site = req.app.locals.siteConfig();
    res.type('text/plain').send(
      `User-agent: *\n` +
      `Disallow: /private\n` +
      `Disallow: /r/\n` +
      `Disallow: /upload\n` +
      `Disallow: /_bust\n` +
      `Disallow: /search\n` +
      `\n` +
      `Sitemap: ${site.url}/sitemap.xml\n`
    );
  });

  // ── sitemap.xml ──────────────────────────────────────────────────────────────
  router.get('/sitemap.xml', (req, res) => {
    const site  = req.app.locals.siteConfig();
    const posts = postsLib.getAll();
    const pages = pagesLib.getAll();

    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function isoDate(d) {
      try { return new Date(d).toISOString().split('T')[0]; } catch { return ''; }
    }
    function url(loc, lastmod, priority = '0.7') {
      return `  <url>\n    <loc>${esc(loc)}</loc>\n` +
        (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
        `    <priority>${priority}</priority>\n  </url>`;
    }

    const today = new Date().toISOString().split('T')[0];
    const entries = [];

    // Home
    entries.push(url(`${site.url}/`, today, '1.0'));

    // Public pages (skip home slug — already listed as /)
    pages.forEach(p => {
      if (p.slug === 'home') return;
      entries.push(url(`${site.url}/${p.slug}`, today, '0.8'));
    });

    // Posts
    posts.forEach(p => {
      entries.push(url(`${site.url}/post/${p.slug}`, isoDate(p.date)));
    });

    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      entries.join('\n') +
      `\n</urlset>\n`
    );
  });

  return router;
};
