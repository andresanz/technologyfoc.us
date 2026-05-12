'use strict';

const express  = require('express');
const sitesLib = require('../lib/sites');
const router   = express.Router();

let analyticsLib;
function getAnalytics() {
  if (!analyticsLib) analyticsLib = require('/var/www/blog-core/lib/analytics');
  return analyticsLib;
}

let ga4Lib;
function getGA4() {
  if (!ga4Lib) ga4Lib = require('../lib/ga4');
  return ga4Lib;
}

router.get('/:domain', async (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  const days = parseInt(req.query.days) || 30;

  let stats = null, countryStats = null, deviceStats = null;
  try {
    stats        = getAnalytics().getStats(req.params.domain, days);
    countryStats = getAnalytics().getCountryStats(req.params.domain, days);
    deviceStats  = getAnalytics().getDeviceStats(req.params.domain, days);
  } catch (e) {
    console.error('[analytics] SQLite error:', e.message);
  }

  let ga4 = null;
  try {
    ga4 = await getGA4().getStats(req.params.domain, days);
  } catch (e) {
    console.error('[GA4] fetch error:', e.message);
  }

  res.render('analytics', { site, stats, days, countryStats, deviceStats, ga4, flash: req.flash() });
});

router.get('/:domain/ga4-detail', async (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  const pagePath = req.query.path || '/';
  const days     = parseInt(req.query.days) || 30;

  let data = null;
  try {
    data = await getGA4().getPageDetail(req.params.domain, pagePath, days);
  } catch (e) {
    console.error('[GA4] detail error:', e.message);
  }

  res.render('analytics-ga4-detail', { site, pagePath, days, data, flash: req.flash() });
});

router.get('/:domain/detail', (req, res) => {
  const site = sitesLib.getSite(req.params.domain);
  if (!site) return res.status(404).render('error', { code: 404, message: 'Site not found' });

  const pagePath = req.query.path || '/';
  let hits = [];
  try {
    hits = getAnalytics().getDetail(req.params.domain, pagePath);
  } catch (e) {
    console.error('[analytics] SQLite error:', e.message);
  }
  res.render('analytics-detail', { site, pagePath, hits, flash: req.flash() });
});

module.exports = router;
