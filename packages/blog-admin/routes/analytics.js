'use strict';

const express  = require('express');
const sitesLib = require('../lib/sites');
const router   = express.Router();

let analyticsLib;
function getAnalytics() {
  if (!analyticsLib) analyticsLib = require('/var/www/blog-core/lib/analytics');
  return analyticsLib;
}

// GET /analytics/:domain
router.get('/:domain', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  const days         = parseInt(req.query.days) || 30;
  const stats        = getAnalytics().getStats(req.params.domain, days);
  const countryStats = getAnalytics().getCountryStats(req.params.domain, days);
  const deviceStats  = getAnalytics().getDeviceStats(req.params.domain, days);
  res.render('analytics', { site, stats, days, countryStats, deviceStats, flash: req.flash() });
});

// GET /analytics/:domain/detail?path=/some/path
router.get('/:domain/detail', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  const pagePath = req.query.path || '/';
  const hits = getAnalytics().getDetail(req.params.domain, pagePath);
  res.render('analytics-detail', { site, pagePath, hits, flash: req.flash() });
});

module.exports = router;
// Not appending — will patch inline
