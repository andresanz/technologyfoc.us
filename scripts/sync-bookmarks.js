#!/usr/bin/env node
'use strict';

/**
 * sync-bookmarks.js
 * Reads Chrome bookmarks JSON → writes content/pages/links.md → commits + pushes.
 * Run daily via launchd. Skips push if nothing changed.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BOOKMARKS_FILE = path.join(
  process.env.HOME,
  'Library/Application Support/Google/Chrome/Default/Bookmarks'
);

const REPO_DIR   = path.join(__dirname, '..');
const LINKS_FILE = path.join(REPO_DIR, 'content/pages/links.md');

// Folders to skip entirely
const SKIP_FOLDERS = new Set([
  'Bookmarks Bar', 'Other Bookmarks', 'Mobile Bookmarks',
]);

// URLs to skip (substrings)
const SKIP_URL_PATTERNS = [
  'andresanz.com',
  'javascript:',
  'chrome://',
  'chrome-extension://',
];

function shouldSkipUrl(url) {
  return SKIP_URL_PATTERNS.some(p => url.includes(p));
}

function walkFolder(node, depth = 0) {
  const result = { name: node.name, links: [], children: [] };
  for (const child of node.children || []) {
    if (child.type === 'url') {
      if (!shouldSkipUrl(child.url || '')) {
        result.links.push({ title: child.name, url: child.url });
      }
    } else if (child.type === 'folder') {
      const sub = walkFolder(child, depth + 1);
      if (sub.links.length || sub.children.length) result.children.push(sub);
    }
  }
  return result;
}

function renderSection(folder, level = 0) {
  const hashes = '####';
  let md = '';
  if (!SKIP_FOLDERS.has(folder.name)) {
    if (folder.links.length) {
      md += `${hashes} ${folder.name}\n`;
      for (const { title, url } of folder.links) {
        const label = title.trim() || url;
        md += `* [${label}](${url})\n`;
      }
      md += '\n';
    }
  }
  for (const child of folder.children) {
    md += renderSection(child, level + 1);
  }
  return md;
}

function run() {
  if (!fs.existsSync(BOOKMARKS_FILE)) {
    console.error('Chrome bookmarks not found:', BOOKMARKS_FILE);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(BOOKMARKS_FILE, 'utf8'));

  let body = '';
  for (const root of ['bookmark_bar', 'other', 'synced']) {
    const node = raw.roots[root];
    if (!node) continue;
    for (const child of node.children || []) {
      if (child.type === 'folder') {
        body += renderSection(walkFolder(child));
      }
    }
  }

  const frontmatter =
    `---\ntitle: Links\ndate: '2026-05-02T08:00'\nslug: links\nnav: true\n---\n\n`;
  const newContent = frontmatter + body.trimEnd() + '\n';

  const existing = fs.existsSync(LINKS_FILE)
    ? fs.readFileSync(LINKS_FILE, 'utf8') : '';

  if (newContent === existing) {
    console.log('No changes — skipping commit.');
    return;
  }

  fs.writeFileSync(LINKS_FILE, newContent, 'utf8');
  console.log('Updated links.md');

  try {
    execSync(`git -C "${REPO_DIR}" add content/pages/links.md`, { stdio: 'pipe' });
    const dirty = execSync(`git -C "${REPO_DIR}" status --porcelain`, { stdio: 'pipe' }).toString().trim();
    if (!dirty) { console.log('Nothing staged.'); return; }
    execSync(`git -C "${REPO_DIR}" commit -m "Sync bookmarks from Chrome"`, { stdio: 'pipe' });
    execSync(`git -C "${REPO_DIR}" pull origin main --rebase --quiet`, { stdio: 'pipe' });
    execSync(`git -C "${REPO_DIR}" push origin main --quiet`, { stdio: 'pipe' });
    console.log('Pushed.');
  } catch (e) {
    console.error('Git error:', e.message);
  }
}

run();
