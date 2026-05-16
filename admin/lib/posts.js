'use strict';

const fs     = require('fs');
const path   = require('path');
const matter = require('gray-matter');

// ── List all posts for a site ─────────────────────────────────────────────────
function list(postsDir) {
  if (!fs.existsSync(postsDir)) return [];

  return fs.readdirSync(postsDir)
    .filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => {
      const filepath = path.join(postsDir, f);
      try {
        const { data } = matter(fs.readFileSync(filepath, 'utf8'));
        const stat     = fs.statSync(filepath);
        const date     = data.date ? new Date(String(data.date).replace(/^(\d{4}-\d{2}-\d{2})$/, '$1T12:00:00')) : stat.mtime;
        return {
          filename: f,
          slug:     data.slug || slugify(data.title || path.basename(f, '.md')),
          title:    data.title || path.basename(f, '.md'),
          date,
          mtime:    stat.mtime,
          dateStr:  date.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }),
          tags:     Array.isArray(data.tags) ? data.tags : (data.tags ? [data.tags] : []),
          draft:    !!data.draft,
          excerpt:  data.excerpt || '',
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (new Date(b.date) - new Date(a.date)) || (b.mtime - a.mtime));
}

// ── Read a single post (raw) ─────────────────────────────────────────────────
function read(postsDir, filename) {
  const filepath = path.join(postsDir, filename);
  if (!fs.existsSync(filepath)) return null;

  const raw      = fs.readFileSync(filepath, 'utf8');
  const { data, content } = matter(raw);
  const stat     = fs.statSync(filepath);
  const date     = data.date ? new Date(String(data.date).replace(/^(\d{4}-\d{2}-\d{2})$/, '$1T12:00:00')) : stat.mtime;

  return {
    filename,
    slug:    data.slug    || slugify(data.title || path.basename(filename, '.md')),
    title:   data.title   || '',
    date:    date.toISOString().split('T')[0],  // YYYY-MM-DD for <input type=date>
    tags:    Array.isArray(data.tags) ? data.tags.join(', ') : (data.tags || ''),
    excerpt: data.excerpt || '',
    image:   data.image   || '',
    draft:   !!data.draft,
    body:    content.trimStart(),
  };
}

// ── Write (create or update) a post ─────────────────────────────────────────
function write(postsDir, filename, { title, slug, date, tags, excerpt, image, draft, body }) {
  if (!fs.existsSync(postsDir)) fs.mkdirSync(postsDir, { recursive: true });

  const fm = {
    title,
    date:  date || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
    slug:  slug || slugify(title),
    ...(tags    ? { tags: tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) } : {}),
    ...(excerpt ? { excerpt } : {}),
    ...(image   ? { image }   : {}),
    ...(draft   ? { draft: true } : {}),
  };

  const fileContent = matter.stringify('\n' + (body || ''), fm);
  const outPath = path.join(postsDir, filename);
  const tmpPath = outPath + '.tmp';
  fs.writeFileSync(tmpPath, fileContent, { encoding: 'utf8', mode: 0o640 });
  fs.renameSync(tmpPath, outPath);
  try { require('child_process').execSync('chown www-data:www-data ' + outPath); } catch {}
}

// ── Delete a post ─────────────────────────────────────────────────────────────
function remove(postsDir, filename) {
  const filepath = path.join(postsDir, filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
}

// ── Slugify ───────────────────────────────────────────────────────────────────
function slugify(str = '') {
  return str.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { list, read, write, remove, slugify, getAllTags };

// ── Get all unique tags across posts and private-posts ────────────────────────
function getAllTags(site) {
  const dirs = [site.postsDir, site.privatePostsDir].filter(Boolean);
  const tagSet = new Set();
  dirs.forEach(dir => {
    list(dir).forEach(p => p.tags.forEach(t => { if (t) tagSet.add(t.toLowerCase()); }));
  });
  return [...tagSet].sort((a, b) => a.localeCompare(b));
}
