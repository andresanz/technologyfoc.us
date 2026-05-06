'use strict';

const PER_PAGE = parseInt(process.env.PER_PAGE) || 5;

/**
 * Process shortcodes in rendered HTML.
 *
 * Supported:
 *   [posts count=N]
 *   [posts count=N tags=a,b,c]
 *   [post paginate]                  — paginated list, uses ?page=N
 *   [post paginate perpage=N]
 */
function processShortcodes(html, postsLib, opts) {
  if (!postsLib) return html;
  const currentPage = Math.max(1, parseInt((opts || {}).page) || 1);


  // [video src="url" poster="url" loop autoplay]
  html = html.replace(/<p>\s*(\[video[^\]]*\])\s*<\/p>|\[video([^\]]*)\]/gi, (match, inP, bare) => {
    const attrs = inP ? inP.replace(/^\[video/i,'').replace(/\]$/,'') : (bare||'');
    const src     = (attrs.match(/src=["']?([^"' \]]+)/i)||[])[1] || '';
    const poster  = (attrs.match(/poster=["']?([^"' \]]+)/i)||[])[1] || '';
    const loop    = /loop/i.test(attrs) ? ' loop' : '';
    const auto    = /autoplay/i.test(attrs) ? ' autoplay muted' : '';
    if (!src) return match;
    return `<div class="video-wrap"><video controls${loop}${auto} playsinline${poster ? ` poster="${poster}"` : ''}><source src="${src}"></video></div>`;
  });

  return html.replace(/<p>\s*(\[posts?[^\]]*\])\s*<\/p>|\[posts?([^\]]*)\]/gi, (match, inP, bare) => {
    const attrs = inP ? inP.replace(/^\[posts?/i, '').replace(/\]$/, '') : (bare || '');
    const paginate   = /paginate/i.test(attrs);
    const count      = parseInt((attrs.match(/count=(\d+)/i)       || [])[1], 10) || (paginate ? PER_PAGE : 5);
    const perPage    = parseInt((attrs.match(/perpage=(\d+)/i)     || [])[1], 10) || count;
    const tagsRaw    = (attrs.match(/tags=([\w,\-]+)/i)            || [])[1];
    const filterTags = tagsRaw
      ? tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      : [];

    let posts = postsLib.getAll();
    if (filterTags.length) {
      posts = posts.filter(p => p.tags.some(t => filterTags.includes(t.toLowerCase())));
    }

    if (!paginate) {
      return renderPostList(posts.slice(0, count));
    }

    // Paginated
    const totalPages = Math.ceil(posts.length / perPage);
    const page       = Math.min(currentPage, Math.max(1, totalPages));
    const slice      = posts.slice((page - 1) * perPage, page * perPage);
    const listHtml   = renderPostList(slice);

    if (totalPages <= 1) return listHtml;

    const prev = page > 1
      ? `<a href="?page=${page - 1}" class="prev">← Newer</a>`
      : '<span></span>';
    const next = page < totalPages
      ? `<a href="?page=${page + 1}" class="next">Older →</a>`
      : '<span></span>';
    const paginationHtml = `<nav class="pagination">${prev}<span>Page ${page} of ${totalPages}</span>${next}</nav>`;

    return listHtml + '\n' + paginationHtml;
  });
}

function renderPostList(posts) {
  if (!posts.length) return '';
  const cards = posts.map(p => {
    const cover = p.coverImage
      ? `<a href="/post/${p.slug}" class="post-cover"><img src="${esc(p.coverImage)}" alt="${esc(p.title)}"></a>`
      : '';
    const tags = p.tags.map(t =>
      `<a href="/tag/${esc(t)}" class="tag">${esc(t)}</a>`
    ).join('');
    const ex      = p.excerpt || '';
    const excerpt = ex
      ? `<p class="excerpt">${esc(ex.length > 140 ? ex.slice(0, 137) + '\u2026' : ex)}</p>`
      : '';
    return `<article class="post-card">
  ${cover}
  <div class="post-card-body">
    <div class="post-meta">
      <time datetime="${esc(p.dateISO)}">${esc(p.dateStr)}</time>
      ${tags}
    </div>
    <h2><a href="/post/${esc(p.slug)}">${esc(p.title)}</a></h2>
    ${excerpt}
    <a href="/post/${esc(p.slug)}" class="read-more">Read more \u2192</a>
  </div>
</article>`;
  });
  return `<div class="post-list shortcode-posts">\n${cards.join('\n')}\n</div>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { processShortcodes };
