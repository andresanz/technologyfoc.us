'use strict';

// Canonical port registry — single source of truth for local dev reference.
// The live server reads from each site's .env; use the /ports admin console
// to change ports there and keep this file in sync.
module.exports = {
  'andresanz.com':           3001,
  'randomcategory.com':      3002,
  'andresanz.me':            3003,
  '914.io':                  3004,
  'multisite':               4000,
};
