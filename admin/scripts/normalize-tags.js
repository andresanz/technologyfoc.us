'use strict';

// One-time script: lowercase + deduplicate tags in all post files across all sites.
// Run with: node scripts/normalize-tags.js

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const matter = require('gray-matter');

const SITES_ROOT = process.env.SITES_ROOT || '/var/www';
const SKIP_DIRS  = new Set(['blog-core', 'blog-admin', 'html', 'certbot']);

function normalizeTags(raw) {
  if (!raw) return undefined;
  const arr = Array.isArray(raw) ? raw : String(raw).split(',').map(t => t.trim());
  const seen = new Set();
  const out  = arr
    .map(t => t.toLowerCase().trim())
    .filter(t => t && !seen.has(t) && seen.add(t));
  return out.length ? out : undefined;
}

function processDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.'));
  for (const f of files) {
    const filepath = path.join(dir, f);
    const raw = fs.readFileSync(filepath, 'utf8');
    const { data, content } = matter(raw);
    if (!data.tags) continue;

    const before = JSON.stringify(data.tags);
    const normalized = normalizeTags(data.tags);
    if (normalized) data.tags = normalized;
    else delete data.tags;
    const after = JSON.stringify(data.tags);

    if (before === after) continue;

    const out = matter.stringify('\n' + content.trimStart(), data);
    const tmp = filepath + '.tmp';
    fs.writeFileSync(tmp, out, { encoding: 'utf8', mode: 0o640 });
    fs.renameSync(tmp, filepath);
    console.log(`  updated: ${filepath}`);
    console.log(`    ${before} → ${after}`);
  }
}

let siteCount = 0, changed = 0;
const sites = fs.readdirSync(SITES_ROOT).filter(name => {
  if (SKIP_DIRS.has(name)) return false;
  const d = path.join(SITES_ROOT, name);
  return fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, '.env'));
});

for (const name of sites) {
  const siteDir = path.join(SITES_ROOT, name);
  console.log(`\n${name}`);
  processDir(path.join(siteDir, 'content', 'posts'));
  processDir(path.join(siteDir, 'content', 'private-posts'));
  siteCount++;
}

console.log(`\nDone. Processed ${siteCount} sites.`);
