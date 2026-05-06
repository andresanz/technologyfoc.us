'use strict';
require('dotenv').config();

const express   = require('../../packages/blog-core/node_modules/express');
const path      = require('path');
const createApp = require('../../packages/blog-core/app-factory');

const blogApp = createApp(__dirname);

// Wrapper app: intercepts /private before the blog app's 404 handler
const app = express();

// Share view engine + locals from blogApp
app.set('view engine', 'ejs');
app.set('views', [
  path.join(__dirname, 'views'),
  '../../packages/blog-core/views',
]);
app.locals.cssVer    = blogApp.locals.cssVer;
app.locals.siteConfig = blogApp.locals.siteConfig;

// Private blog — password-protected, separate content directory
app.use('/private', require('./routes/private')(__dirname));

// Public blog
app.use(blogApp);

const PORT = process.env.PORT || 3003;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[${process.env.SITE_TITLE}] listening on http://127.0.0.1:${PORT}`);
});
