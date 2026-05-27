'use strict';

// Full-text search across all sites' content.
// Backed by `rg` (ripgrep) if available, falls back to `grep`.

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { execSync } = require('child_process');

const sitesLib = require('../lib/sites');

const router = express.Router();

function which(cmd) {
  try { return execSync(`which ${cmd}`, { stdio: ['ignore','pipe','ignore'] }).toString().trim(); }
  catch { return ''; }
}

function searchAll(query, opts = {}) {
  if (!query || query.length < 2) return [];
  const tool = which('rg') || which('grep');
  if (!tool) return [];

  const sites = sitesLib.getEditable();
  const results = [];

  for (const s of sites) {
    const dirs = [s.postsDir, s.pagesDir, s.privatePostsDir, s.privatePagesDir].filter(d => d && fs.existsSync(d));
    for (const dir of dirs) {
      try {
        const out = tool.endsWith('rg')
          ? execSync(`rg --no-heading --line-number --max-count 5 -F -i ${JSON.stringify(query)} ${JSON.stringify(dir)}`, { timeout: 5000, stdio: ['ignore','pipe','ignore'] })
          : execSync(`grep -rniF --max-count=5 -I --include="*.md" ${JSON.stringify(query)} ${JSON.stringify(dir)}`, { timeout: 5000, stdio: ['ignore','pipe','ignore'] });
        out.toString().split('\n').filter(Boolean).forEach(line => {
          const m = line.match(/^(.+?\.md):(\d+):(.*)$/);
          if (!m) return;
          const filepath = m[1];
          const filename = path.basename(filepath);
          const isPage   = filepath.includes('/pages/');
          const isPriv   = filepath.includes('/private');
          const slug     = filename.replace(/\.md$/, '');
          const editPath = isPage
            ? `/pages/edit/${filename}${isPriv ? '?dir=private-pages' : ''}`
            : `/posts/edit/${filename}${isPriv ? '?dir=private-posts' : ''}`;
          results.push({
            site:    s.domain,
            type:    isPage ? 'page' : 'post',
            privacy: isPriv ? 'private' : 'public',
            filename, slug, editPath,
            line:    parseInt(m[2], 10),
            snippet: m[3].trim().slice(0, 200),
          });
        });
      } catch { /* no matches in this dir */ }
    }
  }
  return results;
}

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const results = q ? searchAll(q) : [];
  res.render('search', { site: req.site, q, results, flash: req.flash() });
});

module.exports = router;
