'use strict';
require('dotenv').config();
const createApp = require('../../packages/blog-core/app-factory');
const app  = createApp(__dirname);
const PORT = process.env.PORT || 3004;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[${process.env.SITE_TITLE}] listening on http://127.0.0.1:${PORT}`);
});
