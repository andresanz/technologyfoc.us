'use strict';

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path   = require('path');
const crypto = require('crypto');

let _client = null;

function client() {
  if (!_client) {
    _client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

async function upload({ buffer, mimetype, originalname, folder = 'images' }) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET env var is not set');

  // Use domain as top-level prefix so all sites share one bucket
  const domain = (process.env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || 'default';
  const ext = path.extname(originalname) || mimeToExt(mimetype);
  const key = `${domain}/${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

  await client().send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        buffer,
    ContentType: mimetype,
  }));

  return publicUrl(key);
}

async function remove(urlOrKey) {
  const bucket = process.env.S3_BUCKET;
  const key    = urlOrKey.startsWith('http') ? keyFromUrl(urlOrKey) : urlOrKey;
  await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

async function presignedUpload({ filename, mimetype, folder = 'images', expires = 300 }) {
  const bucket = process.env.S3_BUCKET;
  const domain = (process.env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || 'default';
  const ext    = path.extname(filename) || mimeToExt(mimetype);
  const key    = `${domain}/${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimetype }),
    { expiresIn: expires }
  );

  return { url, key, publicUrl: publicUrl(key) };
}

function publicUrl(key) {
  // If SITE_URL is set, serve images through the site domain (nginx proxies to S3)
  // key format: domain.com/images/filename.ext  → /images/filename.ext
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (siteUrl) {
    const parts = key.split('/');
    const filePath = parts.slice(1).join('/'); // strip domain prefix
    return `${siteUrl}/${filePath}`;
  }
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || 'us-east-1';
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function keyFromUrl(url) {
  return new URL(url).pathname.replace(/^\//, '');
}

function mimeToExt(mime = '') {
  return { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
           'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/avif': '.avif' }[mime] || '';
}

module.exports = { upload, remove, presignedUpload, publicUrl };
