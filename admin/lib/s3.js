'use strict';

const {
  S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path   = require('path');
const crypto = require('crypto');

// Build an S3 client from a site's credentials
function makeClient(site) {
  return new S3Client({
    region: site.awsRegion || 'us-east-1',
    credentials: {
      accessKeyId:     site.awsKey,
      secretAccessKey: site.awsSecret,
    },
  });
}

// Upload buffer → S3, return public URL
async function upload(site, { buffer, mimetype, originalname, folder = 'images' }) {
  if (!site.s3Bucket) throw new Error('S3_BUCKET not configured for this site');
  const ext = path.extname(originalname) || mimeToExt(mimetype);
  const key = `${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

  await makeClient(site).send(new PutObjectCommand({
    Bucket:      site.s3Bucket,
    Key:         key,
    Body:        buffer,
    ContentType: mimetype,
  }));

  return { url: publicUrl(site, key), key };
}

// List objects in bucket (paginated)
async function list(site, { prefix, continuationToken, maxKeys = 50 } = {}) {
  prefix = prefix !== undefined ? prefix : '';
  if (!site.s3Bucket) return { objects: [], nextToken: null };

  const cmd = new ListObjectsV2Command({
    Bucket:            site.s3Bucket,
    Prefix:            prefix,
    MaxKeys:           maxKeys,
    ContinuationToken: continuationToken,
  });

  const res = await makeClient(site).send(cmd);

  const objects = (res.Contents || [])
    .filter(o => /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(o.Key))
    .map(o => ({
      key:          o.Key,
      url:          publicUrl(site, o.Key),
      size:         o.Size,
      sizeStr:      formatBytes(o.Size),
      lastModified: o.LastModified,
      dateStr:      new Date(o.LastModified).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }),
    }))
    .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

  return {
    objects,
    nextToken: res.NextContinuationToken || null,
    total:     res.KeyCount || 0,
  };
}

// Delete an object by key
async function remove(site, key) {
  await makeClient(site).send(new DeleteObjectCommand({
    Bucket: site.s3Bucket,
    Key:    key,
  }));
}

// Presigned upload URL (for future client-side direct uploads)
async function presign(site, { filename, mimetype, folder = 'images', expires = 300 }) {
  const ext = path.extname(filename) || mimeToExt(mimetype);
  const key = `${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const url = await getSignedUrl(
    makeClient(site),
    new PutObjectCommand({ Bucket: site.s3Bucket, Key: key, ContentType: mimetype }),
    { expiresIn: expires }
  );
  return { uploadUrl: url, publicUrl: publicUrl(site, key) };
}

function publicUrl(site, key) {
  // key format: images/filename.ext — nginx proxies /images/ → S3
  const cdnBase = site.cdnUrl || site.url;
  if (cdnBase) {
    return cdnBase.replace(/\/$/, '') + '/' + key;
  }
  return `https://${site.s3Bucket}.s3.${site.awsRegion}.amazonaws.com/${key}`;
}

function mimeToExt(mime = '') {
  return {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/avif': '.avif',
  }[mime] || '';
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// ─── Cached full-bucket listing with global newest-first sort ────────────────
// Fetches every object once, caches sorted result, paginates locally.
const allCache = new Map(); // key = bucket → { at, items }
const CACHE_TTL = 5 * 60 * 1000;

function invalidateAllCache(bucket) {
  if (bucket) allCache.delete(bucket);
  else allCache.clear();
}

async function listAll(site, { page = 1, perPage = 48 } = {}) {
  if (!site.s3Bucket) return { objects: [], page: 1, totalPages: 0, total: 0 };

  const cached = allCache.get(site.s3Bucket);
  let items;
  if (cached && (Date.now() - cached.at) < CACHE_TTL) {
    items = cached.items;
  } else {
    items = [];
    let token;
    do {
      const cmd = new ListObjectsV2Command({
        Bucket:            site.s3Bucket,
        MaxKeys:           1000,
        ContinuationToken: token,
      });
      const res = await makeClient(site).send(cmd);
      for (const o of (res.Contents || [])) {
        if (!/\.(jpe?g|png|gif|webp|avif|svg)$/i.test(o.Key)) continue;
        items.push({
          key:          o.Key,
          url:          publicUrl(site, o.Key),
          size:         o.Size,
          sizeStr:      formatBytes(o.Size),
          lastModified: o.LastModified,
          dateStr:      new Date(o.LastModified).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }),
        });
      }
      token = res.NextContinuationToken;
    } while (token);
    items.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    allCache.set(site.s3Bucket, { at: Date.now(), items });
  }

  const total      = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const p          = Math.max(1, Math.min(page, totalPages));
  const objects    = items.slice((p - 1) * perPage, p * perPage);
  return { objects, page: p, totalPages, total };
}

module.exports = { upload, list, listAll, invalidateAllCache, remove, presign };
