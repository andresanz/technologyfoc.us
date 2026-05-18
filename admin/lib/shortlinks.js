'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = process.env.SHORTLINKS_FILE
  || path.join(__dirname, '..', 'data', 'shortlinks.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}

function save(links) {
  fs.writeFileSync(FILE, JSON.stringify(links, null, 2) + '\n', 'utf8');
}

function get(code) {
  return load().find(l => l.code === code) || null;
}

function hit(code) {
  try {
    const links = load();
    const l = links.find(l => l.code === code);
    if (l) { l.hits = (l.hits || 0) + 1; save(links); }
  } catch {}
}

module.exports = { load, save, get, hit, FILE };
