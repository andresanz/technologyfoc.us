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
  let posts = [...publicPosts, ...privatePosts]
    .sort((a, b) => (new Date(b.date) - new Date(a.date)) || (b.mtime - a.mtime));

  const status     = req.query.status     || 'published';
  const visibility = req.query.visibility || 'all';
  if (status === 'drafts') posts = posts.filter(p =>  p.draft);
  else                     posts = posts.filter(p => !p.draft);
  if (visibility === 'public')  posts = posts.filter(p => !p.isPrivate);
  if (visibility === 'private') posts = posts.filter(p =>  p.isPrivate);

  res.render('posts', { site, posts, status, visibility, flash: req.flash() });
});

// GET /posts/tags — list all tags with counts
router.get('/tags', (req, res) => {
  const site = req.site;

  const dirs = [
    { dir: site.postsDir, isPrivate: false },
    { dir: site.privatePostsDir, isPrivate: true },
  ];

  const tagCounts = {};
  dirs.forEach(({ dir }) => {
    postsLib.list(dir).forEach(post => {
      post.tags.forEach(tag => {
        if (!tag) return;
        const t = tag.toLowerCase();
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });
  });

  const tags = Object.entries(tagCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.render('tags-editor', { site, tags, flash: req.flash() });
});

// POST /posts/tags/rename — rename a tag across all post files
router.post('/tags/rename', async (req, res) => {
  const site = req.site;
  const { from, to } = req.body;

  if (!from || !to || from === to) {
    req.flash('error', 'Invalid rename: from and to must differ and be non-empty');
    return res.redirect('/posts/tags');
  }

  const fromTag = from.trim().toLowerCase();
  const toTag   = to.trim().toLowerCase();

  const dirs = [site.postsDir, site.privatePostsDir].filter(Boolean);
  let renamed = 0;

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).filter(f => f.endsWith('.md')).forEach(filename => {
      const filepath = path.join(dir, filename);
      try {
        let raw = fs.readFileSync(filepath, 'utf8');
        // Only process files that contain the tag in frontmatter
        const matter = require('gray-matter');
        const parsed = matter(raw);
        const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags : [];
        if (!tags.map(t => t.toLowerCase()).includes(fromTag)) return;

        // Replace the tag value in the YAML tags array — match lines like `  - oldtag` or `- oldtag`
        const replaced = raw.replace(
          new RegExp(`^(\\s*-\\s*)${fromTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*)$`, 'gim'),
          `$1${toTag}$2`
        );
        if (replaced !== raw) {
          fs.writeFileSync(filepath, replaced, 'utf8');
          renamed++;
        }
      } catch {}
    });
  });

  try { await site.bustCache().catch(() => {}); } catch {}

  req.flash('success', `Renamed "${fromTag}" → "${toTag}" in ${renamed} file(s)`);
  res.redirect('/posts/tags');
});

// GET /posts/new — new post form
router.get('/new', (req, res) => {
  const site = req.site;

  const _d = new Date(); const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}T${String(_d.getHours()).padStart(2,'0')}:${String(_d.getMinutes()).padStart(2,'0')}`;
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

  const { title, slug, date, tags, excerpt, image, draft, body, visibility, redirect } = req.body;
  const finalSlug = slug || postsLib.slugify(title);
  const filename  = `${finalSlug}.md`;
  const dir       = visibility === 'private' ? site.privatePostsDir : site.postsDir;

  try {
    postsLib.write(dir, filename, { title, slug: finalSlug, date, tags, excerpt, image, draft: !!draft, redirect: redirect || undefined, body });
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

  let dir  = resolveDir(site, req);
  let post = postsLib.read(dir, req.params.filename);

  // Not in the active site — check every other editable site and auto-switch if found
  if (!post) {
    const sitesLib = require('../lib/sites');
    const allSites = sitesLib.getEditable();
    for (const s of allSites) {
      if (s.domain === site.domain) continue;
      const pub  = postsLib.read(s.postsDir, req.params.filename);
      const priv = postsLib.read(s.privatePostsDir, req.params.filename);
      const found = pub || priv;
      if (found) {
        // Switch active site to the one that owns this post, then re-render with it.
        res.setHeader('Set-Cookie', `admin_site=${encodeURIComponent(s.domain)}; Path=/; Max-Age=31536000; SameSite=Lax`);
        req.flash('success', `Switched to ${s.domain} (where this post lives)`);
        const dirParam = priv ? '?dir=private-posts' : '';
        return res.redirect(`/posts/edit/${req.params.filename}${dirParam}`);
      }
    }
    return res.status(404).render('error', { code: 404, message: `Post "${req.params.filename}" not found in any site` });
  }

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

  const { title, slug, date, tags, excerpt, image, draft, body, visibility, originalVisibility, redirect } = req.body;
  const currentDir  = originalVisibility === 'private' ? site.privatePostsDir : site.postsDir;
  const targetDir   = visibility === 'private'         ? site.privatePostsDir : site.postsDir;
  const dirParam    = visibility === 'private' ? '?dir=private-posts' : '';

  try {
    // If visibility changed, delete from old dir then write to new dir
    if (visibility !== originalVisibility) {
      postsLib.remove(currentDir, req.params.filename);
    }
    postsLib.write(targetDir, req.params.filename, { title, slug, date, tags, excerpt, image, draft: !!draft, redirect: redirect || undefined, body });
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
