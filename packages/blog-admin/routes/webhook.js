'use strict';

const crypto  = require('crypto');
const { exec } = require('child_process');
const express = require('express');
const router  = express.Router();

const REPO_DIR = process.env.REPO_DIR || '/var/www/server02';
const SERVICE  = 'blog-admin';

function verifySignature(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}

function tg(msg) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  exec(`curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" -d chat_id="${chatId}" -d text="${msg}"`);
}

router.post('/', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verifySignature(req)) return res.status(401).send('Unauthorized');
  if (req.headers['x-github-event'] !== 'push') return res.status(200).send('ok');

  let payload;
  try { payload = JSON.parse(req.body); } catch { return res.status(400).send('Bad JSON'); }
  if (payload.ref !== 'refs/heads/main') return res.status(200).send('ok');

  res.status(200).send('deploying');

  const before = payload.before?.slice(0, 7) || '?';
  const after  = payload.after?.slice(0, 7)  || '?';

  exec(
    `git -C ${REPO_DIR} pull --ff-only && systemctl restart ${SERVICE}`,
    { timeout: 60000 },
    (err, stdout, stderr) => {
      const out = (stdout + stderr).trim();
      if (err) {
        console.error(`[webhook] deploy failed: ${out}`);
        tg(`blog-admin deploy FAILED ${before} -> ${after}: ${out.slice(0, 200)}`);
      } else {
        console.log(`[webhook] deployed ${before} -> ${after}`);
        tg(`blog-admin deployed ${before} -> ${after}`);
      }
    }
  );
});

module.exports = router;
