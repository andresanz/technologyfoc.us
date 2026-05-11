'use strict';

const express  = require('express');
const sitesLib = require('../lib/sites');
const router   = express.Router();

// GET /ports
router.get('/', (req, res) => {
  const sites = sitesLib.getAll();

  const portCounts = {};
  sites.forEach(s => { portCounts[s.port] = (portCounts[s.port] || 0) + 1; });

  const rows = sites.map(s => {
    const ngPort = sitesLib.nginxPort(s.domain);
    return {
      ...s,
      nginxPort: ngPort,
      conflict:  portCounts[s.port] > 1,
      mismatch:  ngPort && ngPort !== String(s.port),
    };
  });

  res.render('ports', { rows, flash: req.flash() });
});

// POST /ports/:domain — change port
router.post('/:domain', (req, res) => {
  const { domain } = req.params;
  const { port }   = req.body;
  try {
    sitesLib.savePort(domain, port);
    sitesLib.restartService(domain);
    req.flash('success', `${domain} moved to port ${port} — service restarted`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/ports');
});

module.exports = router;
