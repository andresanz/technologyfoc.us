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
  const key = `${site.domain}/${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

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
  prefix = prefix !== undefined ? prefix : `${site.domain}/`;
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
    }));

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
  const key = `${site.domain}/${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const url = await getSignedUrl(
    makeClient(site),
    new PutObjectCommand({ Bucket: site.s3Bucket, Key: key, ContentType: mimetype }),
    { expiresIn: expires }
  );
  return { uploadUrl: url, publicUrl: publicUrl(site, key) };
}

function publicUrl(site, key) {
  if (site.url) {
    // key: domain.com/images/file.jpg → /images/file.jpg
    const parts = key.split('/');
    const filePath = parts.slice(1).join('/');
    return site.url.replace(/\/$/, '') + '/' + filePath;
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

module.exports = { upload, list, remove, presign };
