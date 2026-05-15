'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'sharp-settings.json');

const DEFAULTS = {
  maxWidth: 2400,
  jpegQ:    85,
  webpQ:    85,
  pngEffort: 7,
};

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}

function loadForSite(domain) {
  const all = load();
  return { ...DEFAULTS, ...all.global, ...(all[domain] || {}) };
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function saveGlobal(settings) {
  const all = load();
  all.global = { ...DEFAULTS, ...settings };
  save(all);
}

function saveSite(domain, settings) {
  const all = load();
  if (Object.keys(settings).length === 0) {
    delete all[domain];
  } else {
    all[domain] = settings;
  }
  save(all);
}

module.exports = { load, loadForSite, saveGlobal, saveSite, DEFAULTS };
