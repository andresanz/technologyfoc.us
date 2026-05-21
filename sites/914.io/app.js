'use strict';
process.env.TZ = 'America/New_York';
require('dotenv').config();
const createApp = require('../../core/app-factory');
const app  = createApp(__dirname);
const PORT = process.env.PORT || 4090;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[914.io] listening on http://127.0.0.1:${PORT}`);
});
