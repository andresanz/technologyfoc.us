'use strict';
require('dotenv').config();

const express      = require('express');
const session      = require('express-session');
const flash        = require('connect-flash');
const path         = require('path');

const GIT_HASH = (() => {
  try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); }
  catch { return ''; }
})();

const app = express();

// Trust the nginx reverse proxy so secure cookies work over HTTPS
app.set('trust proxy', 1);

// ── View engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('view cache', false);

// ── Static ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Webhook (raw body required for HMAC — before json parser) ────────────────
app.use('/webhook', require('./routes/webhook'));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session ──────────────────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'changeme',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

app.use(flash());

// ── Auth guard ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.redirect('/login');
}

// Make flash + user available to all views
app.use((req, res, next) => {
  res.locals.flash     = req.flash();
  res.locals.authed    = !!req.session.authenticated;
  res.locals.adminUrl  = process.env.ADMIN_URL || '';
  res.locals.gitHash   = GIT_HASH;
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/',       require('./routes/auth'));
app.use('/sites',  requireAuth, require('./routes/sites'));
app.use('/posts',  requireAuth, require('./routes/posts'));
app.use('/pages',  requireAuth, require('./routes/pages'));
app.use('/media',  requireAuth, require('./routes/media'));
app.use('/write',  requireAuth, require('./routes/write'));
app.use('/server', requireAuth, require('./routes/server'));
app.use('/server/backups', requireAuth, require('./routes/backup'));
app.use('/server/bans',    requireAuth, require('./routes/bans'));
app.use('/analytics',      requireAuth, require('./routes/analytics'));
app.use('/redirects',      requireAuth, require('./routes/redirects'));
app.use('/templates',     requireAuth, require('./routes/templates'));
app.use('/sharp',         requireAuth, require('./routes/sharp'));
app.use('/logs',          requireAuth, require('./routes/logs'));
app.use('/s3',            requireAuth, require('./routes/s3'));
app.use('/domains',       requireAuth, require('./routes/domains'));
app.use('/michele',       requireAuth, require('./routes/michele'));
app.use('/mac',           requireAuth, require('./routes/mac'));
app.use('/gratitude',         require('./routes/gratitude'));
app.use('/gratitude-prompts', requireAuth, require('./routes/gratitude-prompts'));
app.use('/overthinking',      requireAuth, require('./routes/overthinking'));
app.use('/github',         requireAuth, require('./routes/github'));
app.use('/links',         requireAuth, require('./routes/links'));
app.use('/claude',        requireAuth, require('./routes/claude'));
app.use('/volume',        requireAuth, require('./routes/volume'));

// ── Quick reference notes ─────────────────────────────────────────────────────
const QUICKREF_FILE = path.join(__dirname, 'data', 'quickref-notes.txt');
app.get('/quickref', requireAuth, (req, res) => {
  try { res.type('text').send(require('fs').readFileSync(QUICKREF_FILE, 'utf8')); }
  catch { res.type('text').send(''); }
});
app.post('/quickref', requireAuth, express.text(), (req, res) => {
  try {
    require('fs').writeFileSync(QUICKREF_FILE, req.body || '', 'utf8');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Dashboard redirect
app.get('/dashboard', requireAuth, (_req, res) => res.redirect('/sites'));

// ── 404 / error ───────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).render('error', { code: 404, message: 'Not found' }));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', { code: 500, message: err.message || 'Server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Blog admin running on http://127.0.0.1:${PORT}`);
});
