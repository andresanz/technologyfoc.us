import { html, raw } from 'hono/html';
import { join } from 'node:path';
import { makePagesReader } from './pages.js';

const ROOT = join(import.meta.dirname, '..');
const publicPagesReader  = makePagesReader(join(ROOT, 'content/pages'));
const privatePagesReader = makePagesReader(join(ROOT, 'content/private/pages'));

// Configure marked once.
import { marked } from 'marked';
marked.setOptions({ gfm: true, breaks: false });

// ----- Base layout -----
const layout = async ({ title, isPrivate, body }) => {
  const reader = isPrivate ? privatePagesReader : publicPagesReader;
  const navPages = (await reader.list()).filter((p) => p.nav);
  const prefix = isPrivate ? '/private' : '';

  return html`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${isPrivate ? html`<meta name="robots" content="noindex, nofollow, noarchive">` : ''}
    <title>${title ? `${title} — ` : ''}andresanz.com</title>
    <link rel="stylesheet" href="/css/site.css">
  </head>
  <body class="${isPrivate ? 'private' : 'public'}">
    <header class="site-header">
      <div class="container">
        <a href="/" class="site-title">andresanz.com</a>
        <button class="nav-toggle" aria-label="Toggle navigation">
          <span></span><span></span><span></span>
        </button>
        <nav>
          <a href="${isPrivate ? '/private/posts' : '/posts'}">posts</a>
          ${navPages.map((p) => html`<a href="${prefix}/${p.slug}">${p.title || p.slug}</a>`)}
          ${isPrivate ? html`
            <a href="/private">private</a>
            <form action="/auth/logout" method="post" class="inline-form">
              <button type="submit" class="link-button">logout</button>
            </form>
          ` : ''}
        </nav>
      </div>
    </header>
    <main class="container">${raw(body)}</main>
    <footer class="site-footer">
      <div class="container">
        <p class="footer-copy">© ${new Date().getFullYear()} Andre Sanz</p>
      </div>
    </footer>
    <button id="btt" aria-label="Back to top">↑</button>
    <script>
      const t=document.getElementById('btt');
      window.addEventListener('scroll',()=>t.classList.toggle('btt-show',window.scrollY>300));
      t.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
      const tog=document.querySelector('.nav-toggle');
      const nav=document.querySelector('.site-header nav');
      if(tog)tog.addEventListener('click',()=>{tog.classList.toggle('open');nav.classList.toggle('open');});
    </script>
  </body>
</html>`;
};

// ----- Public pages -----
export const renderHome = async () => layout({
  title: null,
  isPrivate: false,
  body: html`
    <section class="hero">
      <h1>Andre Sanz</h1>
      <p class="tagline">Notes on building, breaking, and fixing things.</p>
    </section>
    <p><a href="/posts">Read posts →</a></p>
  `,
});

export const renderLogin = ({ error }) => layout({
  title: 'Sign in',
  isPrivate: false,
  body: html`
    <section class="auth">
      <h1>Sign in</h1>
      ${error ? html`<p class="error">${error}</p>` : ''}
      <form action="/auth/login" method="post" class="auth-form">
        <label><span>Password</span>
          <input type="password" name="password" autocomplete="current-password" autofocus required>
        </label>
        <button type="submit">Continue</button>
      </form>
    </section>
  `,
});

export const renderPrivateHome = () => layout({
  title: 'Private',
  isPrivate: true,
  body: html`
    <h1>Private</h1>
    <ul class="private-nav">
      <li><a href="/private/posts">Private posts</a></li>
      <li><a href="/private/admin">Admin</a></li>
    </ul>
  `,
});

export const renderPostList = ({ posts, prefix, isPrivate }) => layout({
  title: isPrivate ? 'Private posts' : 'Posts',
  isPrivate,
  body: html`
    <div class="page-header">
      <h1>${isPrivate ? 'Private posts' : 'Posts'}</h1>
    </div>
    <div class="post-list">
      ${posts.map((p) => html`
        <article class="post-card">
          <div class="post-card-body">
            <div class="post-meta">
              ${p.date ? html`<time>${p.date}</time>` : ''}
              ${p.tags ? p.tags.map((t) => html`<span class="tag">${t}</span>`) : ''}
            </div>
            <h2><a href="${prefix}/${p.slug}">${p.title || p.slug}</a></h2>
            ${p.description ? html`<p class="excerpt">${p.description}</p>` : ''}
            <a href="${prefix}/${p.slug}" class="read-more">Read more →</a>
          </div>
        </article>
      `)}
    </div>
  `,
});

export const renderPost = ({ meta, html: bodyHtml, isPrivate }) => layout({
  title: meta.title,
  isPrivate,
  body: html`
    <article>
      <div class="post-header">
        <div class="post-meta">
          ${meta.date ? html`<time>${meta.date}</time>` : ''}
          ${meta.tags ? meta.tags.map((t) => html`<span class="tag">${t}</span>`) : ''}
        </div>
        <h1>${meta.title}</h1>
      </div>
      <div class="post-body">${raw(bodyHtml)}</div>
      <div class="post-footer">
        <a href="${isPrivate ? '/private/posts' : '/posts'}" class="back-link">← All posts</a>
        ${meta.tags && meta.tags.length ? html`
          <div class="post-tags">
            ${meta.tags.map((t) => html`<span class="tag">${t}</span>`)}
          </div>
        ` : ''}
      </div>
    </article>
  `,
});

export const renderPage = ({ meta, html: bodyHtml, isPrivate }) => layout({
  title: meta.title,
  isPrivate,
  body: html`
    <article class="page">
      <header><h1>${meta.title}</h1></header>
      <div class="page-body">${raw(bodyHtml)}</div>
    </article>
  `,
});

// ----- Admin shell -----
const adminLayout = ({ title, section, body }) => layout({
  title: `Admin — ${title}`,
  isPrivate: true,
  body: html`
    <div class="admin-layout">
      <aside class="admin-sidebar">
        <h2>Admin</h2>
        <nav>
          <a href="/private/admin"           class="${section === 'dashboard' ? 'active' : ''}">Dashboard</a>
          <a href="/private/admin/posts"     class="${section === 'posts'     ? 'active' : ''}">Posts</a>
          <a href="/private/admin/posts/new">+ New post</a>
          <a href="/private/admin/pages"     class="${section === 'pages'     ? 'active' : ''}">Pages</a>
          <a href="/private/admin/pages/new">+ New page</a>
          <a href="/private/admin/images"    class="${section === 'images'    ? 'active' : ''}">Images</a>
        </nav>
      </aside>
      <section class="admin-main">${raw(body)}</section>
    </div>
  `,
});

export const renderAdminDashboard = ({ counts }) => adminLayout({
  title: 'Dashboard',
  section: 'dashboard',
  body: html`
    <h1>Dashboard</h1>
    <div class="stat-grid">
      <a class="stat" href="/private/admin/posts">
        <span class="stat-num">${counts.publicPosts}</span>
        <span class="stat-label">Public posts</span>
      </a>
      <a class="stat" href="/private/admin/posts">
        <span class="stat-num">${counts.privatePosts}</span>
        <span class="stat-label">Private posts</span>
      </a>
      <a class="stat" href="/private/admin/pages">
        <span class="stat-num">${counts.publicPages}</span>
        <span class="stat-label">Public pages</span>
      </a>
      <a class="stat" href="/private/admin/pages">
        <span class="stat-num">${counts.privatePages}</span>
        <span class="stat-label">Private pages</span>
      </a>
    </div>
    <h2>Quick actions</h2>
    <ul class="quick-actions">
      <li><a href="/private/admin/posts/new">New post →</a></li>
      <li><a href="/private/admin/pages/new">New page →</a></li>
      <li><a href="/private/admin/images">Manage images →</a></li>
    </ul>
  `,
});

export const renderAdminItemList = ({ kind, items }) => adminLayout({
  title: kind === 'posts' ? 'Posts' : 'Pages',
  section: kind,
  body: html`
    <header class="admin-header">
      <h1>${kind === 'posts' ? 'Posts' : 'Pages'}</h1>
      <a class="btn-primary" href="/private/admin/${kind}/new">New ${kind === 'posts' ? 'post' : 'page'}</a>
    </header>
    ${items.length === 0
      ? html`<p class="empty">No ${kind} yet.</p>`
      : html`
        <table class="admin-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Slug</th>
              ${kind === 'posts' ? html`<th>Date</th>` : ''}
              <th>Visibility</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${items.map((it) => html`
              <tr>
                <td><a href="/private/admin/${kind}/${it.slug}">${it.meta?.title || it.slug}</a></td>
                <td class="mono">${it.slug}</td>
                ${kind === 'posts' ? html`<td>${it.meta?.date || ''}</td>` : ''}
                <td>
                  <span class="badge ${it.isPrivate ? 'badge-private' : 'badge-public'}">
                    ${it.isPrivate ? 'private' : 'public'}
                  </span>
                  ${it.meta?.draft ? html`<span class="badge badge-draft">draft</span>` : ''}
                </td>
                <td>
                  <a href="${it.isPrivate ? '/private' : ''}${kind === 'posts' ? '/posts/' : '/'}${it.slug}" target="_blank">view</a>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      `
    }
  `,
});

export const renderAdminEditor = ({ kind, item, today }) => adminLayout({
  title: item ? `Edit ${kind === 'posts' ? 'post' : 'page'}` : `New ${kind === 'posts' ? 'post' : 'page'}`,
  section: kind,
  body: html`
    <form method="post" action="/private/admin/${kind}${item ? `/${item.slug}` : ''}" class="post-form">
      <header class="editor-header">
        <h1>${item ? `Edit ${kind === 'posts' ? 'post' : 'page'}` : `New ${kind === 'posts' ? 'post' : 'page'}`}</h1>
        <span id="editor-status" class="editor-status"></span>
        <div class="editor-actions">
          <button type="button" onclick="toggleVim()" class="btn-secondary">Toggle vim</button>
          <button type="submit">Save</button>
          ${item ? html`
            <button type="submit"
                    formaction="/private/admin/${kind}/${item.slug}/delete"
                    formmethod="post"
                    onclick="return confirm('Delete this ${kind === 'posts' ? 'post' : 'page'}?')"
                    class="btn-danger">Delete</button>
          ` : ''}
        </div>
      </header>

      <div class="meta-fields">
        <label><span>Title</span>
          <input type="text" name="title" required autofocus value="${item?.meta?.title || ''}">
        </label>
        <label><span>Slug</span>
          <input type="text" name="slug" value="${item?.slug || ''}" placeholder="auto-generated from title">
        </label>

        ${kind === 'posts' ? html`
          <label><span>Date</span>
            <input type="date" name="date" value="${item?.meta?.date || today}">
          </label>
          <label><span>Tags</span>
            <input type="text" name="tags"
                   value="${item?.meta?.tags ? item.meta.tags.join(', ') : ''}"
                   placeholder="comma, separated">
          </label>
        ` : html`
          <label><span>Nav order</span>
            <input type="number" name="order" min="0" step="1"
                   value="${item?.meta?.order ?? ''}" placeholder="lower = leftmost">
          </label>
          <label class="inline nav-toggle">
            <input type="checkbox" name="nav" value="1" ${item?.meta?.nav ? 'checked' : ''}>
            <span>Show in site nav</span>
          </label>
        `}

        <label class="full"><span>Description</span>
          <input type="text" name="description" value="${item?.meta?.description || ''}">
        </label>

        <div class="checkboxes">
          <label class="inline">
            <input type="checkbox" name="private" value="1" ${item?.isPrivate ? 'checked' : ''}>
            <span>Private (saves to /private/${kind === 'posts' ? 'posts' : 'pages'}/)</span>
          </label>
          ${kind === 'posts' ? html`
            <label class="inline">
              <input type="checkbox" name="draft" value="1" ${item?.meta?.draft ? 'checked' : ''}>
              <span>Draft (not listed)</span>
            </label>
          ` : ''}
        </div>
      </div>

      <div class="editor-pane">
        <div class="editor-col">
          <h3>Markdown</h3>
          <div class="cm-wrapper">
            <textarea name="body" id="body-editor"
                      data-editor="body-editor" data-preview="preview-pane" data-vim="true"
                      >${item?.body || ''}</textarea>
          </div>
        </div>
        <div class="preview-col">
          <h3>Preview</h3>
          <div id="preview-pane" class="preview"></div>
        </div>
      </div>
    </form>

    <script src="/js/editor.js"></script>
  `,
});

export const renderAdminPostList   = ({ posts }) => renderAdminItemList({ kind: 'posts', items: posts });
export const renderAdminPostEditor = ({ post, today }) => renderAdminEditor({ kind: 'posts', item: post, today });
export const renderAdminPageList   = ({ pages }) => renderAdminItemList({ kind: 'pages', items: pages });
export const renderAdminPageEditor = ({ page }) => renderAdminEditor({ kind: 'pages', item: page });

export const renderAdminImageList = ({ images, visibility }) => adminLayout({
  title: 'Images',
  section: 'images',
  body: html`
    <header class="admin-header">
      <h1>Images</h1>
      <nav class="tab-nav">
        <a href="/private/admin/images?visibility=public"  class="${visibility === 'public'  ? 'active' : ''}">Public</a>
        <a href="/private/admin/images?visibility=private" class="${visibility === 'private' ? 'active' : ''}">Private</a>
      </nav>
    </header>
    <p class="hint">Upload happens from inside the post editor (drag, drop, or paste). This page lists what's already on S3.</p>
    ${images.length === 0
      ? html`<p class="empty">No ${visibility} images yet.</p>`
      : html`
        <div class="image-grid">
          ${images.map((img) => html`
            <div class="image-card">
              <a href="${img.url}" target="_blank">
                <img src="${img.url}?w=200" alt="" loading="lazy">
              </a>
              <div class="image-meta">
                <code class="mono">${img.key}</code>
                <span>${(img.size / 1024).toFixed(0)} KB · ${new Date(img.lastModified).toISOString().slice(0, 10)}</span>
                <form method="post" action="/private/admin/images/delete" class="inline-form">
                  <input type="hidden" name="key" value="${img.key}">
                  <button type="submit" class="btn-link-danger"
                          onclick="return confirm('Delete ${img.key}? This cannot be undone.')">Delete</button>
                </form>
              </div>
            </div>
          `)}
        </div>
      `
    }
  `,
});
