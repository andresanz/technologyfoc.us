'use strict';

const express     = require('express');
const sharpConfig = require('../lib/sharp-config');
const sharpStats  = require('../lib/sharp-stats');
const router      = express.Router();

// GET /sharp
router.get('/', (req, res) => {
  const site   = req.site;
  const config = sharpConfig.load();
  const stats  = sharpStats.getStats();
  const totals = sharpStats.getTotals();
  const recent = sharpStats.getRecent(null, 50);
  res.render('sharp', { sites: [site], config, stats, totals, recent, flash: req.flash() });
});

// POST /sharp/settings/global
router.post('/settings/global', (req, res) => {
  sharpConfig.saveGlobal({
    maxWidth:  parseInt(req.body.maxWidth)  || 2400,
    jpegQ:     parseInt(req.body.jpegQ)     || 85,
    webpQ:     parseInt(req.body.webpQ)     || 85,
    pngEffort: parseInt(req.body.pngEffort) || 7,
  });
  req.flash('success', 'Global settings saved.');
  res.redirect('/sharp');
});

// POST /sharp/settings/:domain
router.post('/settings/:domain', (req, res) => {
  const domain = req.params.domain;
  if (req.body.useGlobal === 'on') {
    sharpConfig.saveSite(domain, {});
  } else {
    sharpConfig.saveSite(domain, {
      maxWidth:  parseInt(req.body.maxWidth)  || 2400,
      jpegQ:     parseInt(req.body.jpegQ)     || 85,
      webpQ:     parseInt(req.body.webpQ)     || 85,
      pngEffort: parseInt(req.body.pngEffort) || 7,
    });
  }
  req.flash('success', `Settings saved for ${domain}.`);
  res.redirect('/sharp');
});

module.exports = router;
