'use strict';

const express    = require('express');
const { execSync, exec } = require('child_process');
const path       = require('path');
const router     = express.Router();

const APP_DIR = path.join(__dirname, '..', '..');

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, timeout: 8000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString().trim();
  } catch (e) {
    return (e.stdout || e.stderr || '').toString().trim();
  }
}

function getRepoInfo(dir, name) {
  try {
    const branch   = run('git rev-parse --abbrev-ref HEAD', dir);
    const commits  = run('git log --oneline -10 --format="%h|%s|%cr"', dir);
    const status   = run('git status --short', dir);
    const ahead    = run('git rev-list @{u}..HEAD --count 2>/dev/null || echo 0', dir);
    const lastPush = run('git log origin/' + branch + ' -1 --format="%cr" 2>/dev/null || echo "never"', dir);
    const remote   = run('git remote get-url origin 2>/dev/null || echo ""', dir);
    return {
      name,
      dir,
      branch,
      remote,
      dirty:    status.length > 0,
      pending:  status.split('\n').filter(Boolean).length,
      ahead:    parseInt(ahead) || 0,
      lastPush,
      commits:  commits.split('\n').filter(Boolean).map(l => {
        const [hash, msg, time] = l.split('|');
        return { hash, msg, time };
      }),
      error: null,
    };
  } catch (e) {
    return { name, dir, error: e.message, commits: [], remote: '' };
  }
}

// GET /github
router.get('/', (req, res) => {
  const repos = [getRepoInfo(APP_DIR, 'technologyfoc.us')];
  res.render('github', { pageTitle: 'GitHub', repos, flash: req.flash() });
});

// POST /github/push — push repo
router.post('/push', (req, res) => {
  exec(
    `cd ${APP_DIR} && git add -A && (git diff --cached --quiet || git commit -m "manual push: $(date '+%Y-%m-%d %H:%M')") && git push`,
    { timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (err, stdout, stderr) => {
      const output = (stdout + stderr).trim();
      req.flash(err ? 'error' : 'success', err ? output : (output || 'Pushed'));
      res.redirect('/github');
    }
  );
});

module.exports = router;
