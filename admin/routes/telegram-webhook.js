'use strict';

const express = require('express');
const { processUpdate } = require('../services/gratitude');
const router  = express.Router();

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

// POST /webhook/telegram — Telegram pushes updates here (no admin auth)
router.post('/', async (req, res) => {
  // Verify Telegram's secret header — drop anything else
  if (!SECRET || req.headers['x-telegram-bot-api-secret-token'] !== SECRET) {
    return res.status(401).end();
  }
  // Acknowledge fast so Telegram doesn't retry
  res.status(200).end();
  try {
    const result = await processUpdate(req.body);
    if (result && result.created) console.log(`[telegram-webhook] saved entry`);
    else if (result && result.skipped) console.log(`[telegram-webhook] skipped: ${result.skipped}`);
  } catch (e) {
    console.error('[telegram-webhook] error:', e.message);
  }
});

// GET /webhook/telegram/setup?url=https://admin.andresanz.com/webhook/telegram
// Registers the webhook URL with Telegram. Requires admin auth (mounted accordingly).
router.get('/setup', async (req, res) => {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!TOKEN)  return res.status(500).send('TELEGRAM_BOT_TOKEN not set');
  if (!SECRET) return res.status(500).send('TELEGRAM_WEBHOOK_SECRET not set');
  const url = req.query.url || `${process.env.ADMIN_URL || 'https://admin.andresanz.com'}/webhook/telegram`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, secret_token: SECRET, allowed_updates: ['message'] }),
    });
    const data = await r.json();
    res.json({ url, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /webhook/telegram/info — check current webhook status
router.get('/info', async (req, res) => {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!TOKEN) return res.status(500).send('TELEGRAM_BOT_TOKEN not set');
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`);
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
