'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const GIT_USER  = 'Blog Admin';
const GIT_EMAIL = 'admin@localhost';

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, timeout: 15000, stdio: 'pipe' }).toString().trim();
  } catch (e) {
    // Never let git errors break a save
    console.error('[git]', e.message.split('\n')[0]);
    return '';
  }
}

// Walk up from `dir` to find the real .git root. Returns the directory
// containing .git, or null if none exists above /var/www.
function findRepoRoot(dir) {
  let cur = path.resolve(dir);
  const stop = path.parse(cur).root;
  while (cur && cur !== stop) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function ensureRepo(dir) {
  // If we're inside an existing repo (e.g. a sub-site under andresanz.com),
  // use that repo — do NOT git init a nested one.
  const existing = findRepoRoot(dir);
  if (existing) return existing;

  // Otherwise initialise a fresh repo at this directory.
  run('git init', dir);
  run(`git config user.name "${GIT_USER}"`, dir);
  run(`git config user.email "${GIT_EMAIL}"`, dir);

  const gitignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, 'node_modules/\n.env\n*.log\n');
  }

  run('git add -A', dir);
  const hasFiles = run('git status --porcelain', dir);
  if (hasFiles) run('git commit -m "Initial snapshot"', dir);
  return dir;
}

function autoCommit(site, message) {
  try {
    const repoRoot = ensureRepo(site.dir);
    run('git add -A', repoRoot);
    const dirty = run('git status --porcelain', repoRoot);
    if (dirty) {
      const safe = message.replace(/"/g, "'").replace(/\n/g, ' ');
      run(`git commit -m "${safe}"`, repoRoot);
      run('git push origin HEAD --quiet', repoRoot);
    }
  } catch (e) {
    console.error('[git] autoCommit failed:', e.message);
  }
}

function log(site, limit = 20) {
  try {
    const repoRoot = ensureRepo(site.dir);
    const out = run(
      `git log --pretty=format:"%h|%ad|%s" --date=format:"%b %d %Y %H:%M" -n ${limit}`,
      repoRoot
    );
    if (!out) return [];
    return out.split('\n').map(line => {
      const [hash, date, ...msgParts] = line.split('|');
      return { hash, date, message: msgParts.join('|') };
    });
  } catch {
    return [];
  }
}

function diff(site, hash) {
  try {
    const repoRoot = findRepoRoot(site.dir) || site.dir;
    return run(`git show --stat ${hash}`, repoRoot);
  } catch {
    return '';
  }
}

module.exports = { autoCommit, ensureRepo, log, diff };
