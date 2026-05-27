'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');

const sitesLib   = require('../lib/sites');
const postsLib   = require('../lib/posts');
const domainsDb  = require('../lib/domains-db');
const analytics  = require('../../core/lib/analytics');
const gitLib     = require('../lib/git');

const router = express.Router();

router.get('/', (req, res) => {
  const site = req.site;

  // Pageviews for the active site
  let pv = { today: 0, total: 0, unique: 0 };
  try {
    const stats = analytics.getStats(site.domain, 30);
    if (stats) pv = { today: stats.today, total: stats.total, unique: stats.unique };
  } catch {}

  // Posts + drafts for the active site
  let posts = [], drafts = [];
  try {
    const all = postsLib.list(site.postsDir) || [];
    drafts = all.filter(p => p.draft);
    posts  = all.filter(p => !p.draft).slice(0, 5);
  } catch {}

  // Domain registry summary
  let domains = { total: 0, live: 0, redirect: 0, parked: 0 };
  try {
    const counts = domainsDb.prepare('SELECT state, COUNT(*) AS n FROM domains GROUP BY state').all();
    counts.forEach(r => { domains[r.state] = r.n; });
    domains.total = counts.reduce((a, r) => a + r.n, 0);
  } catch {}

  // Latest deploy
  let deploy = null;
  try {
    const log = gitLib.log(site, 1);
    if (log && log.length) deploy = log[0];
  } catch {}

  // Health snapshot
  let health = null;
  try {
    health = JSON.parse(fs.readFileSync('/var/log/blog-health.json', 'utf8'));
  } catch {}

  res.render('dashboard', {
    site, pv, posts, drafts, domains, deploy, health,
    flash: req.flash(),
  });
});

module.exports = router;
