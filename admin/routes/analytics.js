'use strict';

const express = require('express');
const router  = express.Router();

let analyticsLib;
function getAnalytics() {
  if (!analyticsLib) analyticsLib = require('../../core/lib/analytics');
  return analyticsLib;
}

let ga4Lib;
function getGA4() {
  if (!ga4Lib) ga4Lib = require('../lib/ga4');
  return ga4Lib;
}

router.get('/', async (req, res) => {
  const site   = req.site;
  const days   = parseInt(req.query.days) || 30;
  const domain = site.domain;

  let stats = null, countryStats = null, deviceStats = null;
  try {
    stats        = getAnalytics().getStats(domain, days);
    countryStats = getAnalytics().getCountryStats(domain, days);
    deviceStats  = getAnalytics().getDeviceStats(domain, days);
  } catch (e) {
    console.error('[analytics] SQLite error:', e.message);
  }

  let ga4 = null;
  try {
    ga4 = await getGA4().getStats(domain, days);
  } catch (e) {
    console.error('[GA4] fetch error:', e.message);
  }

  res.render('analytics', { site, stats, days, countryStats, deviceStats, ga4, flash: req.flash() });
});

router.get('/ga4-detail', async (req, res) => {
  const site     = req.site;
  const pagePath = req.query.path || '/';
  const days     = parseInt(req.query.days) || 30;

  let data = null;
  try {
    data = await getGA4().getPageDetail(site.domain, pagePath, days);
  } catch (e) {
    console.error('[GA4] detail error:', e.message);
  }

  res.render('analytics-ga4-detail', { site, pagePath, days, data, flash: req.flash() });
});

router.get('/detail', (req, res) => {
  const site     = req.site;
  const pagePath = req.query.path || '/';
  let hits = [];
  try {
    hits = getAnalytics().getDetail(site.domain, pagePath);
  } catch (e) {
    console.error('[analytics] SQLite error:', e.message);
  }
  res.render('analytics-detail', { site, pagePath, hits, flash: req.flash() });
});

module.exports = router;
