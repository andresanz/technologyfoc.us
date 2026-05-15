'use strict';

const express      = require('express');
const multer       = require('multer');
const sharp        = require('sharp');
const s3Lib        = require('../lib/s3');
const sharpConfig  = require('../lib/sharp-config');
const sharpStats   = require('../lib/sharp-stats');
const router       = express.Router();

const SKIP_TYPES = new Set(['image/gif', 'image/svg+xml']);

async function processImage(file, cfg) {
  if (SKIP_TYPES.has(file.mimetype)) return { ...file, skipped: true };

  const img  = sharp(file.buffer).rotate();
  const meta = await img.metadata();

  if (meta.width && meta.width > cfg.maxWidth) {
    img.resize({ width: cfg.maxWidth, withoutEnlargement: true });
  }

  let buffer, mimetype;
  if (file.mimetype === 'image/png') {
    buffer   = await img.png({ compressionLevel: cfg.pngEffort }).toBuffer();
    mimetype = 'image/png';
  } else if (file.mimetype === 'image/webp') {
    buffer   = await img.webp({ quality: cfg.webpQ }).toBuffer();
    mimetype = 'image/webp';
  } else {
    buffer   = await img.jpeg({ quality: cfg.jpegQ, mozjpeg: true }).toBuffer();
    mimetype = 'image/jpeg';
  }

  return { ...file, buffer, mimetype, skipped: false };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 500 * 1024 * 1024 },  // 500MB for video
  fileFilter(_req, file, cb) {
    const ok = ['image/jpeg','image/png','image/gif','image/webp','image/avif','image/svg+xml','video/mp4','video/webm','video/quicktime','video/x-msvideo','video/mov'];
    ok.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Unsupported: ${file.mimetype}`));
  },
});

// GET /media
router.get('/', async (req, res) => {
  const site = req.site;

  const isJson = 'json' in req.query;
  try {
    const result = await s3Lib.list(site, {
      continuationToken: req.query.next || undefined,
      maxKeys: isJson ? 200 : 48,
    });
    if (isJson) return res.json({ ok: true, ...result });
    res.render('media', { site, ...result, s3Error: null, flash: req.flash() });
  } catch (e) {
    if (isJson) return res.status(500).json({ error: e.message });
    res.render('media', { site, objects: [], nextToken: null, flash: req.flash(), s3Error: e.message });
  }
});

// POST /media/upload
router.post('/upload', upload.array('images', 20), async (req, res) => {
  const site = req.site;

  try {
    const isVideo   = (req.files || []).some(f => f.mimetype.startsWith('video/'));
    const folder    = (req.body.folder || (isVideo ? 'videos' : 'posts')).replace(/[^a-z0-9_-]/gi, '');
    const cfg       = sharpConfig.loadForSite(site.domain);
    const processed = await Promise.all((req.files || []).map(f => f.mimetype.startsWith('video/') ? Promise.resolve({...f, skipped: true}) : processImage(f, cfg)));

    // Log stats
    processed.forEach((f, i) => {
      if (!f.skipped) {
        sharpStats.log({
          domain:        site.domain,
          filename:      f.originalname,
          originalSize:  req.files[i].buffer.length,
          processedSize: f.buffer.length,
          originalType:  req.files[i].mimetype,
        });
      }
    });

    const results = await Promise.all(
      processed.map(f => s3Lib.upload(site, {
        buffer:       f.buffer,
        mimetype:     f.mimetype,
        originalname: f.originalname,
        folder,
      }))
    );
    res.json({ ok: true, files: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /media/delete
router.post('/delete', async (req, res) => {
  const site = req.site;

  try {
    await s3Lib.remove(site, req.body.key);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
