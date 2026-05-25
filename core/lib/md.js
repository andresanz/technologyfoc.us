'use strict';

/**
 * Shared markdown-it instance with extended capabilities:
 *
 *  Syntax extras
 *  ─────────────
 *  ==highlight==          → <mark>text</mark>
 *  [^1] / [^1]: note      → footnotes
 *  H~2~O / x^2^           → subscript / superscript  (via attrs workaround)
 *  {.class #id attr=val}  → add any attribute to the preceding element
 *
 *  Heading anchors
 *  ───────────────
 *  Every heading gets an id="slug" and a linkable ¶ anchor.
 *
 *  Callout containers
 *  ──────────────────
 *  :::note Optional title
 *  content
 *  :::
 *  Types: note · tip · warning · danger · info · quote · callout
 *
 *  Image captions
 *  ──────────────
 *  ![alt text](url "Caption text")
 *  Images with a title become <figure><img…><figcaption>…</figcaption></figure>
 *
 *  Syntax highlighting
 *  ───────────────────
 *  ```js   →  highlight.js-coloured code block
 */

const MarkdownIt = require('markdown-it');
const attrs      = require('markdown-it-attrs');
const container  = require('markdown-it-container');
const mark       = require('markdown-it-mark');
const footnote   = require('markdown-it-footnote');
const anchor     = require('markdown-it-anchor');
const hljs       = require('highlight.js');

// ── Base instance ─────────────────────────────────────────────────────────────
const md = new MarkdownIt({
  html:        true,   // allow raw HTML in source
  linkify:     true,   // auto-link explicit URLs (http://, https://, mailto:)
  typographer: true,   // smart quotes, dashes, ellipsis
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      } catch (_) { /* fall through */ }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

// ── Plugins ───────────────────────────────────────────────────────────────────

// Don't auto-link bare domain names like "914.io" — only explicit URLs (http://, mailto:)
md.linkify.set({ fuzzyLink: false });

// {.class #id attr=val} on any block or inline element
md.use(attrs, { leftDelimiter: '{', rightDelimiter: '}', allowedAttributes: [] });

// ==highlighted text==
md.use(mark);

// Footnotes  [^1]  /  [^1]: The note.
md.use(footnote);

// Heading anchors  (prepend a ¶ link so you can deep-link to sections)
md.use(anchor, {
  permalink: anchor.permalink.linkInsideHeader({
    symbol: '<span aria-hidden="true" class="heading-anchor-icon">¶</span>',
    placement: 'after',
  }),
  slugify: s => s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, ''),
});

// Callout containers  :::type Optional title
const CALLOUT_TYPES = ['note', 'tip', 'warning', 'danger', 'info', 'quote', 'callout'];
CALLOUT_TYPES.forEach(type => {
  md.use(container, type, {
    render(tokens, idx) {
      const tok   = tokens[idx];
      const title = tok.info.trim().slice(type.length).trim();
      if (tok.nesting === 1) {
        const titleHtml = title
          ? `<div class="callout-title">${md.utils.escapeHtml(title)}</div>\n`
          : '';
        return `<div class="callout callout-${type}">\n${titleHtml}`;
      }
      return '</div>\n';
    },
  });
});

// ── Core rule: italic-only paragraph after image paragraph → figcaption ──────
//
//  Write this in your post:
//
//    ![photo](url.jpg)
//
//    *Caption for the photo*
//
//  The italic paragraph becomes a centered <figcaption> under the image.
//
md.core.ruler.push('img_caption', function (state) {
  const tokens = state.tokens;

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'paragraph_open')  continue;
    if (!tokens[i+1] || tokens[i+1].type !== 'inline') continue;
    if (!tokens[i+2] || tokens[i+2].type !== 'paragraph_close') continue;

    const children = tokens[i+1].children || [];

    // ── Case 1: image and *caption* in the SAME paragraph (no blank line) ──
    //   children: [image, softbreak, em_open, text, em_close]
    const noBreak = children.filter(c => c.type !== 'softbreak');
    if (noBreak.length === 4 &&
        noBreak[0].type === 'image' &&
        noBreak[1].type === 'em_open' &&
        noBreak[2].type === 'text' &&
        noBreak[3].type === 'em_close') {

      const captionText = noBreak[2].content;
      const imgToken    = noBreak[0];
      const src  = imgToken.attrGet('src') || '';
      const alt  = (imgToken.children || []).map(c => c.content).join('');
      const imgTag = `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}">`;

      tokens[i].type    = 'html_block';
      tokens[i].content = `<figure class="img-figure">\n${imgTag}\n<figcaption class="img-caption">${md.utils.escapeHtml(captionText)}</figcaption>\n</figure>\n`;
      tokens[i+1].type    = 'html_block'; tokens[i+1].content = '';
      tokens[i+2].type    = 'html_block'; tokens[i+2].content = '';
      continue;
    }

    // ── Case 2: image paragraph, then separate *caption* paragraph ──
    const onlyImg = children.filter(c => c.type !== 'softbreak');
    if (onlyImg.length !== 1 || onlyImg[0].type !== 'image') continue;

    const j = i + 3;
    if (!tokens[j]   || tokens[j].type   !== 'paragraph_open')  continue;
    if (!tokens[j+1] || tokens[j+1].type !== 'inline')          continue;
    if (!tokens[j+2] || tokens[j+2].type !== 'paragraph_close') continue;

    const cc = (tokens[j+1].children || []).filter(c => c.type !== 'softbreak');
    if (cc.length !== 3)          continue;
    if (cc[0].type !== 'em_open') continue;
    if (cc[1].type !== 'text')    continue;
    if (cc[2].type !== 'em_close') continue;

    const captionText = cc[1].content;

    tokens[i].type    = 'html_block';
    tokens[i].content = '<figure class="img-figure">\n';
    tokens[i+2].type  = 'html_block'; tokens[i+2].content = '';

    tokens[j].type    = 'html_block'; tokens[j].content = '';
    tokens[j+1].type  = 'html_block';
    tokens[j+1].content = `<figcaption class="img-caption">${md.utils.escapeHtml(captionText)}</figcaption>\n</figure>\n`;
    tokens[j+2].type  = 'html_block'; tokens[j+2].content = '';
  }
});

// ── Image → <figure> when a title is present ─────────────────────────────────
md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token  = tokens[idx];
  const src    = token.attrGet('src') || '';
  const alt    = self.renderInlineAsText(token.children, options, env);
  const title  = token.attrGet('title') || '';
  const extras = token.attrs
    ? token.attrs
        .filter(([k]) => k !== 'src' && k !== 'alt' && k !== 'title')
        .map(([k, v]) => ` ${k}="${md.utils.escapeHtml(v)}"`)
        .join('')
    : '';

  const imgTag = `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}"${extras}>`;

  if (title) {
    return `<figure>${imgTag}<figcaption>${md.utils.escapeHtml(title)}</figcaption></figure>`;
  }
  return imgTag;
};

module.exports = md;
