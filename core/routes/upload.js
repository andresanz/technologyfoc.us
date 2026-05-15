'use strict';

const express = require('express');
const multer  = require('multer');
const s3      = require('../lib/s3');

module.exports = function createUploadRouter() {
  const router = express.Router();

  function requireAdminKey(req, res, next) {
    if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized — send X-Admin-Key header' });
    }
    next();
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 20 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
      const ok = ['image/jpeg','image/png','image/gif','image/webp','image/avif','image/svg+xml'];
      ok.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Unsupported: ${file.mimetype}`));
    },
  });

  // POST /upload  — multipart, field "image"
  router.post('/', requireAdminKey, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file — use field name "image"' });
      const folder = (req.body.folder || 'images').replace(/[^a-z0-9_-]/gi, '');
      const url = await s3.upload({
        buffer: req.file.buffer, mimetype: req.file.mimetype,
        originalname: req.file.originalname, folder,
      });
      res.json({ ok: true, url });
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /upload/presign  — JSON body { filename, mimetype, folder? }
  router.post('/presign', requireAdminKey, async (req, res) => {
    try {
      const { filename, mimetype, folder } = req.body || {};
      if (!filename || !mimetype) return res.status(400).json({ error: 'filename and mimetype required' });
      const result = await s3.presignedUpload({ filename, mimetype, folder });
      res.json({ ok: true, uploadUrl: result.url, publicUrl: result.publicUrl });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.use((err, _req, res, _next) => {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
  });

  return router;
};
