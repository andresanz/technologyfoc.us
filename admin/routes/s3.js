'use strict';

const express   = require('express');
const { execSync } = require('child_process');
const router    = express.Router();

function awsEnv() {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID:     process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION:    process.env.AWS_REGION || 'us-east-1',
  };
}

function aws(args) {
  return execSync(`aws ${args}`, { timeout: 30000, env: awsEnv() }).toString().trim();
}

function listBuckets() {
  const out = aws(`s3api list-buckets --query 'Buckets[].[Name,CreationDate]' --output text`);
  return out.split('\n').filter(Boolean).map(line => {
    const [name, created] = line.split('\t');
    return { name, created: created ? created.split('T')[0] : '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function listObjects(bucket, prefix = '') {
  try {
    const out = aws(
      `s3api list-objects-v2 --bucket ${bucket}` +
      (prefix ? ` --prefix "${prefix}"` : '') +
      ` --delimiter "/" --query '[CommonPrefixes[].Prefix, Contents[].[Key,Size,LastModified]]' --output json`
    );
    const parsed = JSON.parse(out);
    const folders = (parsed[0] || []).map(p => ({
      type: 'folder',
      key:  p,
      name: p.replace(prefix, '').replace(/\/$/, ''),
    }));
    const files = (parsed[1] || []).map(([key, size, modified]) => ({
      type:     'file',
      key,
      name:     key.replace(prefix, ''),
      size,
      modified: modified ? new Date(modified).toLocaleString() : '',
      mb:       size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB'
              : size >= 1024    ? (size / 1024).toFixed(0) + ' KB'
              :                   size + ' B',
    })).filter(f => f.name);
    return { folders, files };
  } catch { return { folders: [], files: [] }; }
}

// GET /s3/images — all images across all buckets
router.get('/images', (req, res) => {
  let error = null;
  let allImages = [];
  const bucketErrors = [];

  const debug = req.query.debug === '1';
  const bucketStats = [];

  try {
    const buckets = listBuckets();
    for (const bucket of buckets) {
      try {
        const out = aws(
          `s3api list-objects-v2 --bucket ${bucket.name} --max-items 2000` +
          ` --query 'Contents[].[Key,Size,LastModified]' --output json`
        );
        const raw = out === 'null' ? '[]' : out;
        const objects = JSON.parse(raw) || [];
        const images = objects
          .filter(([key]) => /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(key))
          .map(([key, size, rawDate]) => ({
            bucket: bucket.name,
            key,
            name: key.split('/').pop(),
            size,
            mb: size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB'
              : size >= 1024    ? (size / 1024).toFixed(0) + ' KB'
              :                   size + ' B',
            rawDate: rawDate || '',
            modified: rawDate ? new Date(rawDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '',
          }));
        allImages = allImages.concat(images);
        if (debug) {
          const sample = objects.slice(0, 3).map(([k]) => k);
          bucketStats.push({ name: bucket.name, total: objects.length, images: images.length, sample });
        }
      } catch (e) {
        bucketErrors.push(`${bucket.name}: ${e.message}`);
      }
    }
    allImages.sort((a, b) => (b.rawDate > a.rawDate ? 1 : -1));
  } catch (e) {
    error = e.message;
  }

  const bucketNames = [...new Set(allImages.map(i => i.bucket))].sort();
  res.render('s3-images', { allImages, bucketNames, error, bucketErrors, debug, bucketStats, flash: req.flash() });
});

// GET /s3 — bucket list
router.get('/', (req, res) => {
  let buckets = [], error = null;
  try { buckets = listBuckets(); }
  catch (e) { error = e.message; }
  res.render('s3', { buckets, error, flash: req.flash() });
});

// GET /s3/:bucket — browse bucket
router.get('/:bucket', (req, res) => {
  const bucket = req.params.bucket.replace(/[^a-z0-9._-]/gi, '');
  const prefix = req.query.prefix || '';
  const { folders, files } = listObjects(bucket, prefix);

  // Build breadcrumb from prefix
  const crumbs = [{ label: bucket, prefix: '' }];
  if (prefix) {
    const parts = prefix.replace(/\/$/, '').split('/');
    let built = '';
    parts.forEach(p => {
      built += p + '/';
      crumbs.push({ label: p, prefix: built });
    });
  }

  res.render('s3-bucket', { bucket, prefix, folders, files, crumbs, flash: req.flash() });
});

// POST /s3/:bucket/delete
router.post('/:bucket/delete', (req, res) => {
  const bucket = req.params.bucket.replace(/[^a-z0-9._-]/gi, '');
  const { key, prefix } = req.body;
  if (!key) { req.flash('error', 'No key specified'); return res.redirect(`/s3/${bucket}?prefix=${prefix||''}`); }
  try {
    aws(`s3 rm "s3://${bucket}/${key}"`);
    req.flash('success', `Deleted ${key}`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect(`/s3/${bucket}?prefix=${encodeURIComponent(prefix || '')}`);
});

// GET /s3/:bucket/download?key=...
router.get('/:bucket/download', (req, res) => {
  const bucket = req.params.bucket.replace(/[^a-z0-9._-]/gi, '');
  const key    = req.query.key || '';
  if (!key) return res.status(400).send('No key');
  try {
    const url = aws(`s3 presign "s3://${bucket}/${key}" --expires-in 300`);
    res.redirect(url);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

module.exports = router;
