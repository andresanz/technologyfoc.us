'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const PROMPTS_FILE = path.join(__dirname, '..', 'data', 'gratitude-prompts.json');

function load() {
  try { return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8')); } catch { return []; }
}
function save(prompts) {
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2) + '\n');
}

// List
router.get('/', (req, res) => {
  res.render('gratitude-prompts', { prompts: load(), flash: req.flash() });
});

// Add
router.post('/add', (req, res) => {
  const text = (req.body.text || '').trim();
  if (text) {
    const prompts = load();
    prompts.push(text);
    save(prompts);
    req.flash('success', 'Prompt added');
  }
  res.redirect('/gratitude-prompts');
});

// Delete
router.post('/delete/:idx', (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  const prompts = load();
  if (idx >= 0 && idx < prompts.length) {
    prompts.splice(idx, 1);
    save(prompts);
    req.flash('success', 'Prompt deleted');
  }
  res.redirect('/gratitude-prompts');
});

// Edit (GET)
router.get('/edit/:idx', (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  const prompts = load();
  if (idx < 0 || idx >= prompts.length) return res.redirect('/gratitude-prompts');
  res.render('gratitude-prompt-edit', { idx, text: prompts[idx], flash: req.flash() });
});

// Edit (POST)
router.post('/edit/:idx', (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  const text = (req.body.text || '').trim();
  const prompts = load();
  if (idx >= 0 && idx < prompts.length && text) {
    prompts[idx] = text;
    save(prompts);
    req.flash('success', 'Prompt saved');
  }
  res.redirect('/gratitude-prompts');
});

module.exports = router;
