'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const sitesLib = require('../lib/sites');
const router   = express.Router();

const ADMIN_DIR  = path.resolve(__dirname, '..');
const SITES_ROOT = process.env.SITES_ROOT || '/var/www';

function getRepos() {
  const repos = [{ name: 'blog-admin', dir: ADMIN_DIR }];
  try {
    fs.readdirSync(SITES_ROOT).forEach(name => {
      const dir = path.join(SITES_ROOT, name);
      try {
        if (fs.statSync(dir).isDirectory() &&
            fs.existsSync(path.join(dir, 'app.js'))) {
          repos.push({ name, dir });
        }
      } catch {}
    });
  } catch {}
  return repos;
}

function getFiles(dir) {
  const files = [];
  const candidates = ['CLAUDE.md', '.claude/settings.json', '.claude/settings.local.json'];
  candidates.forEach(f => {
    files.push({ path: f, exists: fs.existsSync(path.join(dir, f)) });
  });

  const cmdsDir = path.join(dir, '.claude', 'commands');
  if (fs.existsSync(cmdsDir)) {
    fs.readdirSync(cmdsDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .forEach(f => files.push({ path: `.claude/commands/${f}`, exists: true }));
  }
  files.push({ path: '.claude/commands/new…', exists: false, isNew: true });
  return files;
}

function safeRelPath(rel) {
  const norm = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  return norm;
}

// GET /claude
router.get('/', (req, res) => {
  const repos     = getRepos();
  const repoName  = req.query.repo || 'blog-admin';
  const repo      = repos.find(r => r.name === repoName) || repos[0];
  const files     = getFiles(repo.dir);

  let filePath = req.query.file || 'CLAUDE.md';
  if (filePath === '.claude/commands/new…') filePath = '';

  const isNew       = req.query.new === '1';
  let content       = '';
  let fileExists    = false;

  if (filePath && !isNew) {
    const abs = path.join(repo.dir, safeRelPath(filePath));
    if (fs.existsSync(abs)) {
      content   = fs.readFileSync(abs, 'utf8');
      fileExists = true;
    }
  }

  res.render('claude', {
    repos, repo, files, filePath, content, fileExists, isNew,
    flash: req.flash(),
  });
});

// POST /claude/save
router.post('/save', (req, res) => {
  const repoName = req.body.repo || 'blog-admin';
  const repos    = getRepos();
  const repo     = repos.find(r => r.name === repoName);
  if (!repo) { req.flash('error', 'Repo not found'); return res.redirect('/claude'); }

  let filePath = (req.body.file || '').trim();
  if (!filePath) { req.flash('error', 'No file specified'); return res.redirect('/claude'); }

  filePath = safeRelPath(filePath);
  const abs = path.join(repo.dir, filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, req.body.content || '', 'utf8');
  req.flash('success', `Saved ${filePath}`);
  res.redirect(`/claude?repo=${encodeURIComponent(repoName)}&file=${encodeURIComponent(filePath)}`);
});

// POST /claude/delete
router.post('/delete', (req, res) => {
  const repoName = req.body.repo || 'blog-admin';
  const repos    = getRepos();
  const repo     = repos.find(r => r.name === repoName);
  if (!repo) { req.flash('error', 'Repo not found'); return res.redirect('/claude'); }

  const filePath = safeRelPath((req.body.file || '').trim());
  const abs      = path.join(repo.dir, filePath);
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
    req.flash('success', `Deleted ${filePath}`);
  }
  res.redirect(`/claude?repo=${encodeURIComponent(repoName)}`);
});

module.exports = router;
