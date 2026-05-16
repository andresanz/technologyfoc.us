'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { loadState, loadEntries, deleteEntry, sendPrompt, checkReplies } = require('../services/gratitude');
const router   = express.Router();

const PROMPTS_FILE = path.join(__dirname, '..', 'data', 'gratitude-prompts.json');
const BLOG_URL     = process.env.GRATITUDE_BLOG_URL || ('https://' + (process.env.GRATITUDE_BLOG || 'randomcategory.com'));

function load() {
  try { return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8')); } catch { return []; }
}
function save(prompts) {
  fs.mkdirSync(path.dirname(PROMPTS_FILE), { recursive: true });
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2) + '\n');
}

// GET / — dashboard: state + entries + prompts
router.get('/', (req, res) => {
  const state   = loadState();
  const entries = loadEntries().reverse();
  const prompts = load();
  res.render('gratitude', { state, entries, prompts, blogUrl: BLOG_URL, flash: req.flash() });
});

// POST /send — trigger prompt now
router.post('/send', async (req, res) => {
  try {
    const force  = req.body.force === '1';
    const result = await sendPrompt(force);
    req.flash('success', result.skipped ? result.reason : `Prompt sent: "${result.prompt.slice(0, 80)}"`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/gratitude-prompts');
});

// POST /check — poll Telegram for replies
router.post('/check', async (req, res) => {
  try {
    const result = await checkReplies();
    req.flash('success', `Check complete — ${result.created} new entry(s)`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/gratitude-prompts');
});

// POST /entries/delete/:idx
router.post('/entries/delete/:idx', (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  try { deleteEntry(idx); req.flash('success', 'Entry deleted'); }
  catch (e) { req.flash('error', e.message); }
  res.redirect('/gratitude-prompts#entries');
});

// POST /add
router.post('/add', (req, res) => {
  const text = (req.body.text || '').trim();
  if (text) { const p = load(); p.push(text); save(p); req.flash('success', 'Prompt added'); }
  res.redirect('/gratitude-prompts#prompts');
});

// POST /delete/:idx
router.post('/delete/:idx', (req, res) => {
  const idx     = parseInt(req.params.idx, 10);
  const prompts = load();
  if (idx >= 0 && idx < prompts.length) { prompts.splice(idx, 1); save(prompts); req.flash('success', 'Prompt deleted'); }
  res.redirect('/gratitude-prompts#prompts');
});

// GET /edit/:idx
router.get('/edit/:idx', (req, res) => {
  const idx     = parseInt(req.params.idx, 10);
  const prompts = load();
  if (idx < 0 || idx >= prompts.length) return res.redirect('/gratitude-prompts');
  res.render('gratitude-prompt-edit', { idx, text: prompts[idx], flash: req.flash() });
});

// POST /edit/:idx
router.post('/edit/:idx', (req, res) => {
  const idx     = parseInt(req.params.idx, 10);
  const text    = (req.body.text || '').trim();
  const prompts = load();
  if (idx >= 0 && idx < prompts.length && text) { prompts[idx] = text; save(prompts); req.flash('success', 'Prompt saved'); }
  res.redirect('/gratitude-prompts#prompts');
});

module.exports = router;
