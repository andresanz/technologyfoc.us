'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const router = express.Router();
const FILE   = path.join(__dirname, '..', 'data', 'post-templates.json');

function load()         { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function save(list)     { fs.writeFileSync(FILE, JSON.stringify(list, null, 2)); }
function slug(s)        { return s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || Date.now().toString(); }

// GET /templates
router.get('/', (req, res) => {
  res.render('templates', { templates: load(), flash: req.flash() });
});

// GET /templates/new
router.get('/new', (req, res) => {
  res.render('template-edit', { tmpl: { id: '', name: '', title: '', image: '', body: '' }, isNew: true, flash: req.flash() });
});

// POST /templates/new
router.post('/new', (req, res) => {
  const list = load();
  const { name, body, title, image } = req.body;
  const id = slug(name);
  if (list.find(t => t.id === id)) {
    req.flash('error', 'A template with that name already exists.');
    return res.redirect('/templates/new');
  }
  list.push({ id, name: name.trim(), title: title || '', image: image || '', body });
  save(list);
  req.flash('success', `Template "${name}" created.`);
  res.redirect('/templates');
});

// GET /templates/edit/:id
router.get('/edit/:id', (req, res) => {
  const tmpl = load().find(t => t.id === req.params.id);
  if (!tmpl) return res.status(404).render('error', { code: 404, message: 'Template not found' });
  res.render('template-edit', { tmpl, isNew: false, flash: req.flash() });
});

// POST /templates/edit/:id
router.post('/edit/:id', (req, res) => {
  const list = load();
  const idx  = list.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).render('error', { code: 404, message: 'Template not found' });
  list[idx] = { id: req.params.id, name: req.body.name.trim(), title: req.body.title || '', image: req.body.image || '', body: req.body.body };
  save(list);
  req.flash('success', 'Template saved.');
  res.redirect('/templates');
});

// POST /templates/reorder
router.post('/reorder', (req, res) => {
  const ids  = req.body.ids; // array of ids in new order
  const list = load();
  const reordered = ids.map(id => list.find(t => t.id === id)).filter(Boolean);
  // append any that weren't in the payload
  list.forEach(t => { if (!ids.includes(t.id)) reordered.push(t); });
  save(reordered);
  res.json({ ok: true });
});

// POST /templates/delete/:id
router.post('/delete/:id', (req, res) => {
  const list = load().filter(t => t.id !== req.params.id);
  save(list);
  req.flash('success', 'Template deleted.');
  res.redirect('/templates');
});

module.exports = router;
