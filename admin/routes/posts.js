'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const TEMPLATES_FILE = path.join(__dirname, '..', 'data', 'post-templates.json');
function loadTemplates() {
  try { return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')); }
  catch { return []; }
}
const postsLib = require('../lib/posts');
const gitLib   = require('../lib/git');
const router   = express.Router();

// Resolve which posts directory to use based on ?dir= query param
function resolveDir(site, req) {
  return req.query.dir === 'private-posts' ? site.privatePostsDir : site.postsDir;
}

// GET /posts — list all posts (public + private)
router.get('/', (req, res) => {
  const site = req.site;

  const publicPosts  = postsLib.list(site.postsDir).map(p => ({ ...p, isPrivate: false }));
  const privatePosts = postsLib.list(site.privatePostsDir).map(p => ({ ...p, isPrivate: true }));

  // Merge and sort by date descending
  const posts = [...publicPosts, ...privatePosts]
    .sort((a, b) => (new Date(b.date) - new Date(a.date)) || (b.mtime - a.mtime));

  res.render('posts', { site, posts, flash: req.flash() });
});

// GET /posts/new — new post form
router.get('/new', (req, res) => {
  const site = req.site;

  const today = new Date().toISOString().split('T')[0];
  res.render('post-edit', {
    site,
    post:      { filename: '', slug: '', title: '', date: today, tags: '', excerpt: '', image: '', draft: false, body: '' },
    isNew:     true,
    isPrivate: req.query.dir === 'private-posts',
    templates: loadTemplates(),
    allTags:   postsLib.getAllTags(site),
    flash:     req.flash(),
  });
});

// POST /posts/new — create post
router.post('/new', async (req, res) => {
  const site = req.site;

  const { title, slug, date, tags, excerpt, image, draft, body, visibility } = req.body;
  const finalSlug = slug || postsLib.slugify(title);
  const filename  = `${finalSlug}.md`;
  const dir       = visibility === 'private' ? site.privatePostsDir : site.postsDir;

  try {
    postsLib.write(dir, filename, { title, slug: finalSlug, date, tags, excerpt, image, draft: !!draft, body });
    await site.bustCache().catch(() => {});
    gitLib.autoCommit(site, `Create ${visibility === 'private' ? 'private ' : ''}post: ${title}`);
    req.flash('success', `Post "${title}" created`);
    res.redirect('/posts');
  } catch (e) {
    req.flash('error', e.message);
    res.redirect('/posts/new');
  }
});

// GET /posts/edit/:filename — edit post (?dir=private-posts for private)
router.get('/edit/:filename', (req, res) => {
  const site = req.site;

  const dir  = resolveDir(site, req);
  const post = postsLib.read(dir, req.params.filename);
  if (!post) return res.status(404).render('error', { code: 404, message: 'Post not found' });

  res.render('post-edit', {
    site,
    post,
    isNew:     false,
    isPrivate: req.query.dir === 'private-posts',
    templates: [],
    allTags:   postsLib.getAllTags(site),
    flash:     req.flash(),
  });
});

// POST /posts/edit/:filename — save post
router.post('/edit/:filename', async (req, res) => {
  const site = req.site;

  const { title, slug, date, tags, excerpt, image, draft, body, visibility, originalVisibility } = req.body;
  const currentDir  = originalVisibility === 'private' ? site.privatePostsDir : site.postsDir;
  const targetDir   = visibility === 'private'         ? site.privatePostsDir : site.postsDir;
  const dirParam    = visibility === 'private' ? '?dir=private-posts' : '';

  try {
    // If visibility changed, delete from old dir then write to new dir
    if (visibility !== originalVisibility) {
      postsLib.remove(currentDir, req.params.filename);
    }
    postsLib.write(targetDir, req.params.filename, { title, slug, date, tags, excerpt, image, draft: !!draft, body });
    await site.bustCache().catch(() => {});
    gitLib.autoCommit(site, `Save post: ${title}`);
    req.flash('success', 'Post saved');
    res.redirect(`/posts/edit/${req.params.filename}${dirParam}`);
  } catch (e) {
    req.flash('error', e.message);
    res.redirect(`/posts/edit/${req.params.filename}${dirParam}`);
  }
});

// POST /posts/delete/:filename — delete post
router.post('/delete/:filename', async (req, res) => {
  const site = req.site;

  const dir = req.body.dir === 'private-posts' ? site.privatePostsDir : site.postsDir;

  try {
    postsLib.remove(dir, req.params.filename);
    await site.bustCache().catch(() => {});
    gitLib.autoCommit(site, `Delete post: ${req.params.filename}`);
    req.flash('success', 'Post deleted');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/posts');
});

module.exports = router;
