'use strict';

const express    = require('express');
const { execSync, exec } = require('child_process');
const router     = express.Router();

const REPOS = [
  { name: 'andresanz-sites (monorepo)', dir: '/var/www/server02' },
];

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, timeout: 8000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString().trim();
  } catch (e) {
    return (e.stdout || e.stderr || '').toString().trim();
  }
}

function getRepoInfo(repo) {
  const { name, dir } = repo;
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
  const repos = REPOS.map(getRepoInfo);
  res.render('github', { pageTitle: 'GitHub', repos, flash: req.flash() });
});

// POST /github/push — trigger push-all
router.post('/push', (req, res) => {
  exec('/usr/local/bin/git-push-all.sh', { timeout: 60000 }, (err, stdout, stderr) => {
    const output = (stdout + stderr).trim();
    req.flash(err ? 'error' : 'success', err ? 'Push failed: ' + output : (output || 'Monorepo pushed'));
    res.redirect('/github');
  });
});

// POST /github/push/:name — push single repo (only monorepo supported now)
router.post('/push/:name', (req, res) => {
  exec('cd /var/www/server02 && git add -A && (git diff --cached --quiet || git commit -m "manual push: $(date \'+%Y-%m-%d %H:%M\')") && git push',
    { timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (err, stdout, stderr) => {
      const output = (stdout + stderr).trim();
      req.flash(err ? 'error' : 'success', err ? output : (output || 'Monorepo pushed'));
      res.redirect('/github');
    }
  );
});

module.exports = router;
