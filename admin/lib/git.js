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

function ensureRepo(dir) {
  const gitDir = path.join(dir, '.git');
  if (!fs.existsSync(gitDir)) {
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
  }
}

function autoCommit(site, message) {
  try {
    const dir = site.dir;
    ensureRepo(dir);
    run('git add -A', dir);
    const dirty = run('git status --porcelain', dir);
    if (dirty) {
      const safe = message.replace(/"/g, "'").replace(/\n/g, ' ');
      run(`git commit -m "${safe}"`, dir);
    }
  } catch (e) {
    console.error('[git] autoCommit failed:', e.message);
  }
}

function log(site, limit = 20) {
  try {
    ensureRepo(site.dir);
    const out = run(
      `git log --pretty=format:"%h|%ad|%s" --date=format:"%b %d %Y %H:%M" -n ${limit}`,
      site.dir
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
    return run(`git show --stat ${hash}`, site.dir);
  } catch {
    return '';
  }
}

module.exports = { autoCommit, ensureRepo, log, diff };
