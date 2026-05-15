---
title: Building the new andresanz.com
date: 2026-05-14
tags: [meta, build, dev]
description: Running log of the consolidation — killing five separate Node apps and replacing them with one clean Hono site.
---

Running log of how this site got built. Updated as work continues.

---

## The problem (May 12)

Had five separate Node/Express apps running on five separate domains — randomcategory.com, 914.io, therandomactofwriting.com, samsanz.info, andresanz.com — plus a standalone redirect service and an admin panel. Each ran on its own port, had its own systemd unit, its own nginx vhost, its own copy of shared middleware that kept drifting out of sync with the others. A mess.

The fix: one app, one domain, one process.

---

## Architecture decisions

**Framework:** Switched from Express to [Hono](https://hono.dev). Same mental model (routers, middleware, `app.use()`), but ESM-native, web-standard Request/Response, and noticeably cleaner to write. The whole app is `import`/`export`, no `require()` anywhere.

**Templates:** Dropped EJS. Using `hono/html` tagged templates — auto-escaped by default, `raw()` to opt out for rendered markdown. No template files to manage, no build step for views.

**Auth:** Shared password gate on all `/private/*` using bcryptjs + signed cookies. No session store, no database. The signed cookie *is* the credential. One `app.use('/private/*', requirePrivateAuth)` covers everything — no per-route exceptions to forget.

**Images:** S3 (bucket: `andresanz-images`), Sharp for resize/EXIF strip, disk cache. `/img/*` for public, `/private/img/*` for gated — the auth gate covers image requests automatically since they're under `/private/`.

**No Apache:** Dropped Apache entirely. nginx stays as the TLS front door (it's already serving ~40 other vhosts on the box), proxying to the Hono app on `127.0.0.1:3000`.

---

## Content structure

Four parallel trees, all markdown on disk:

- `content/posts/` → `/posts/:slug` (public)
- `content/private/posts/` → `/private/posts/:slug` (gated)
- `content/pages/` → `/:slug` (public, catch-all)
- `content/private/pages/` → `/private/:slug` (gated, catch-all)

Pages are catch-alls registered last, so structured routes always win. A page file named `posts.md` can't shadow the `/posts` route.

---

## What shipped May 13

Built the whole thing in one chat session, scaffolded locally in a Claude Code sandbox, tested with 27 smoke tests (all passing), tarballed, and deployed to server02.

Cutover:
1. Started the new `andresanz.service` alongside the running stack on a high port
2. Confirmed it responded on `127.0.0.1:3000`
3. Swapped nginx vhosts — removed 6 old per-domain configs, added one new combined config
4. All 5 retired domains instantly 301-ing to andresanz.com
5. Stopped and disabled the 7 old `blog-*` systemd services

One snag: `sanz.me` had no cert on this server — DNS points to WordPress.com. Dropped it from the new nginx vhost config.

---

## May 14 — Style and editor

Pulled the CSS from the old [andresanz-sites](https://github.com/andresanz/andresanz-sites) monorepo (`packages/blog-core/public/css/style.css`). Updated the Hono views to match the expected HTML structure: `.container` wrappers, `.post-card` listings, `.post-header`/`.post-footer` on single posts, hamburger mobile nav, back-to-top button.

Replaced the CodeMirror 6 + vim mode editor with [Tiptap](https://tiptap.dev). Reasons:
- Vim emulation in a browser is always a half-baked context-switch
- CodeMirror 6 is code-editor UX, not prose UX
- Tiptap is proper contenteditable with real toolbar, handles paste-from-anywhere gracefully, works on mobile
- Uses `tiptap-markdown` extension for native markdown in/out — the textarea (and the `.md` file on disk) stays markdown throughout
- Still has drag/drop and paste image upload to S3, localStorage autosave, live preview

Bundle went from 674KB (CodeMirror) to 576KB (Tiptap). Both are admin-only, heavily cacheable.

---

---

## May 14 — Webhook deploy + Telegram gratitude journal

**Webhook deploy**: `POST /webhook/deploy` — GitHub sends a signed push event, server does `git fetch + reset --hard origin/main + npm install + systemctl restart andresanz`. Responds 200 immediately, runs deploy async. Sends Telegram notification on success or failure. sudoers entry gives `www-data` passwordless restart of the one service.

**Gratitude journal**: Two pieces.

1. `scripts/send-gratitude-prompt.js` — sends a random prompt from a 44-item list via the Telegram bot. Runs via cron at 9am. 
2. `POST /telegram/gratitude` — Telegram webhook receiver. Verified with `x-telegram-bot-api-secret-token`. Saves each reply as a private markdown post (`content/private/posts/YYYY-MM-DD-gratitude.md`). First reply creates the file; subsequent replies the same day append to it.

The old system used polling (`getUpdates` loop) and stored entries as JSON. The new version uses Telegram's webhook push mode — no polling, no state file, entries go straight to the post system as markdown.

---

## What's coming

See the [README](https://github.com/andresanz/andresanz.com) for the full backlog. Near-term:

- RSS/Atom/JSON feeds
- Full-text search
- Tag pages + filtering
- Analytics (SQLite, no GA)
