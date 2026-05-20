'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const gitLib  = require('../lib/git');
const sitesLib = require('../lib/sites');
const router  = express.Router();

function linksFile(site) {
  return path.join(site.pagesDir, 'links.md');
}

function readLinks(site) {
  const f = linksFile(site);
  if (!fs.existsSync(f)) return '';
  return fs.readFileSync(f, 'utf8');
}

function writeLinks(site, content) {
  fs.mkdirSync(path.dirname(linksFile(site)), { recursive: true });
  fs.writeFileSync(linksFile(site), content, 'utf8');
}

// Extract section headings (#### Foo) from the markdown body
function extractSections(content) {
  const body = content.replace(/^---[\s\S]*?---\n?/, '');
  const sections = [];
  const re = /^####\s+(.+)$/gm;
  let m;
  while ((m = re.exec(body)) !== null) sections.push(m[1].trim());
  return sections;
}

// GET /links — quick-add form + raw editor
router.get('/', (req, res) => {
  const site = req.site;
  const content = readLinks(site);
  const sections = extractSections(content);
  res.render('links', { site, content, sections, flash: req.flash() });
});

// POST /links/add — append a link under the chosen section (or new section)
router.post('/add', async (req, res) => {
  const site = req.site;
  let   { url, title, section, newSection } = req.body;
  url     = (url || '').trim();
  title   = (title || '').trim() || url;
  section = (section || '').trim();
  newSection = (newSection || '').trim();

  if (!url) { req.flash('error', 'URL required'); return res.redirect('/links'); }

  // If user typed a new section, prefer that
  const targetSection = newSection || section;

  let content = readLinks(site);
  // Ensure frontmatter exists; if not, create a minimal one
  if (!/^---[\s\S]*?---/.test(content)) {
    content = `---\ntitle: Links\nslug: links\nnav: true\n---\n\n` + content;
  }

  const linkLine = `* [${title}](${url})`;

  if (targetSection) {
    // Look for `#### targetSection` and append under its list. If not present, add new section at the end.
    const escSec = targetSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRe = new RegExp(`(^####\\s+${escSec}\\s*$)([\\s\\S]*?)(?=^####\\s+|\\Z)`, 'm');
    if (sectionRe.test(content)) {
      content = content.replace(sectionRe, (_, head, body) => {
        const trimmed = body.replace(/\s+$/, '');
        return `${head}\n${trimmed}\n${linkLine}\n\n`;
      });
    } else {
      // Append new section at the end
      content = content.replace(/\s*$/, '') + `\n\n#### ${targetSection}\n${linkLine}\n`;
    }
  } else {
    // No section — just append at end
    content = content.replace(/\s*$/, '') + `\n${linkLine}\n`;
  }

  try {
    writeLinks(site, content);
    await sitesLib.bustCache(site).catch(() => {});
    gitLib.autoCommit(site, `Add link: ${title}`);
    req.flash('success', `Added: ${title}`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/links');
});

// POST /links/save — save raw markdown (full edit)
router.post('/save', async (req, res) => {
  const site = req.site;
  try {
    writeLinks(site, req.body.content || '');
    await sitesLib.bustCache(site).catch(() => {});
    gitLib.autoCommit(site, 'Edit links page');
    req.flash('success', 'Links saved');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/links');
});

module.exports = router;
