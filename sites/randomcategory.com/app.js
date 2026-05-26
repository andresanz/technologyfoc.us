require('dotenv').config();
const createApp = require('../../core/app-factory');
const app = createApp(__dirname);
const PORT = process.env.PORT || 4091;
app.listen(PORT, '127.0.0.1', () => console.log(`[randomcategory.com] listening on http://127.0.0.1:${PORT}`));
