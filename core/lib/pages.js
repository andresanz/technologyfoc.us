'use strict';

const fs     = require('fs');
const path   = require('path');
const matter = require('gray-matter');
const md = require('./md');

/**
 * Factory — returns a pages API scoped to a specific directory.
 *
 * Pages live in content/pages/ and are served at /:slug.
 * They don't appear in the post list or RSS feed.
 */
module.exports = function createPagesLib(pagesDir) {
  let _cache = null;

  function bust() { _cache = null; }

  function loadAll() {
    if (_cache) return _cache;

    if (!fs.existsSync(pagesDir)) {
      fs.mkdirSync(pagesDir, { recursive: true });
    }

    _cache = fs.readdirSync(pagesDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('.'))
      .map(f => loadFile(path.join(pagesDir, f)))
      .filter(Boolean)
      .sort((a, b) => (a.order || 99) - (b.order || 99));

    return _cache;
  }

  function loadFile(filepath) {
    try {
      const raw = fs.readFileSync(filepath, 'utf8');
      const { data, content } = matter(raw);
      const filename = path.basename(filepath, '.md');
      const slug     = data.slug || slugify(data.title || filename);

      return {
        slug,
        title:     data.title || filename,
        order:     data.order || 99,
        nav:       data.nav !== false, // show in nav by default
        draft:     data.draft || false,
        raw:       content,
        _filepath: filepath,
        _filename: require('path').basename(filepath),
      };
    } catch (err) {
      console.error(`Error loading page ${filepath}:`, err.message);
      return null;
    }
  }

  function renderPage(page) {
    if (page.html) return page;
    page.html = md.render(page.raw);
    return page;
  }

  function getAll({ includeDrafts = false } = {}) {
    const all = loadAll();
    return includeDrafts ? all : all.filter(p => !p.draft);
  }

  function getNavPages() {
    return getAll().filter(p => p.nav);
  }

  function getBySlug(slug) {
    const page = getAll({ includeDrafts: true }).find(p => p.slug === slug);
    return page ? renderPage(page) : null;
  }

  return { getAll, getNavPages, getBySlug, bust };
};

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
