'use strict';

const fs      = require('fs');
const path    = require('path');
const matter  = require('gray-matter');
const md = require('./md');

/**
 * Factory — returns a posts API scoped to a specific directory.
 *
 * Usage:
 *   const posts = require('./lib/posts')('/var/www/mysite/content/posts');
 *   posts.getAll()
 */
module.exports = function createPostsLib(postsDir) {
  let _cache = null;

  // ── Cache management ───────────────────────────────────────────────────────
  function bust() { _cache = null; }

  // ── Load all posts from disk ───────────────────────────────────────────────
  function loadAll() {
    if (_cache) return _cache;

    if (!fs.existsSync(postsDir)) {
      fs.mkdirSync(postsDir, { recursive: true });
    }

    const files = fs.readdirSync(postsDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('.'))
      .map(f => loadFile(path.join(postsDir, f)))
      .filter(Boolean);

    files.sort((a, b) => (new Date(b.date) - new Date(a.date)) || (b.mtime - a.mtime));
    _cache = files;
    return _cache;
  }

  // ── Parse a single .md file ────────────────────────────────────────────────
  function loadFile(filepath) {
    try {
      const raw  = fs.readFileSync(filepath, 'utf8');
      const { data, content } = matter(raw);

      const filename = path.basename(filepath, '.md');
      const slug     = data.slug || slugify(data.title || filename);
      const stat     = fs.statSync(filepath);
      const date     = data.date ? new Date(data.date) : stat.mtime;

      return {
        slug,
        title:      data.title     || filename,
        date,
        mtime:      stat.mtime,
        dateISO:    date.toISOString(),
        dateStr:    date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        tags:       Array.isArray(data.tags) ? data.tags : (data.tags ? [data.tags] : []),
        excerpt:    data.excerpt   || excerptFrom(content),
        coverImage: data.image     || null,
        draft:      data.draft     || false,
        raw:        content,
        _filepath:  filepath,
      };
    } catch (err) {
      console.error(`Error loading ${filepath}:`, err.message);
      return null;
    }
  }

  // ── Lazily render HTML ─────────────────────────────────────────────────────
  function renderPost(post) {
    if (post.html) return post;
    post.html = md.render(post.raw);
    return post;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function getAll({ includeDrafts = false } = {}) {
    const all = loadAll();
    return includeDrafts ? all : all.filter(p => !p.draft);
  }

  function getBySlug(slug) {
    const post = getAll({ includeDrafts: true }).find(p => p.slug === slug);
    return post ? renderPost(post) : null;
  }

  function getByTag(tag) {
    return getAll().filter(p => p.tags.includes(tag));
  }

  function getAllTags() {
    const counts = {};
    for (const post of getAll()) {
      for (const tag of post.tags) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }


  function search(query) {
    const q = (query || '').toLowerCase().trim();
    if (q.length < 2) return [];
    return getAll()
      .map(post => {
        let score = 0;
        if (post.title.toLowerCase().includes(q))             score += 10;
        if (post.tags.some(t => t.toLowerCase().includes(q))) score += 5;
        if ((post.excerpt || '').toLowerCase().includes(q))   score += 3;
        if ((post.raw || '').toLowerCase().includes(q))       score += 1;
        return { post, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ post }) => post);
  }

  return { getAll, getBySlug, getByTag, getAllTags, bust, search };
};

// ── Helpers ────────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function excerptFrom(content) {
  const stripped = content
    .replace(/^#+.*/gm, '')           // remove headings
    .replace(/!\[.*?\]\(.*?\)/g, '')  // remove images
    .replace(/\[(.+?)\]\(.*?\)/g, '$1') // unwrap links
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // remove inline/block code
    .replace(/[*_~]/g, '')            // remove emphasis markers
    .trim();

  // Try each paragraph until we find one with real text
  const paras = stripped.split(/\n\n+/);
  for (const para of paras) {
    const text = para.trim();
    if (text.length > 20) {
      return text.length > 160 ? text.slice(0, 157) + '…' : text;
    }
  }
  return '';
}
