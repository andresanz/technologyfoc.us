'use strict';

const express = require('express');
const { execSync } = require('child_process');
const router  = express.Router();

// GET /webhooks
router.get('/', async (req, res) => {
  const webhooks = [];

  // ── Inbound: Telegram (gratitude bot) ──────────────────────────────────────
  webhooks.push(await telegramInbound({
    label: 'Telegram → Gratitude replies',
    token: process.env.TELEGRAM_BOT_TOKEN,
    expectedUrl: `${process.env.ADMIN_URL || 'https://admin.technologyfoc.us'}/webhook/telegram`,
    direction: 'inbound',
  }));

  // ── Inbound: GitHub deploy ─────────────────────────────────────────────────
  webhooks.push(githubDeployInbound());

  // ── Outbound: Deploy notification → Servers bot ────────────────────────────
  webhooks.push(telegramOutbound({
    label: 'Deploy notifications → Servers bot',
    token: process.env.DEPLOY_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN,
    chat:  process.env.DEPLOY_TELEGRAM_CHAT_ID   || process.env.TELEGRAM_CHAT_ID,
  }));

  // ── Outbound: Gratitude prompts → Gratitude bot ────────────────────────────
  webhooks.push(telegramOutbound({
    label: 'Gratitude prompts → Gratitude bot',
    token: process.env.TELEGRAM_BOT_TOKEN,
    chat:  process.env.TELEGRAM_CHAT_ID,
  }));

  res.render('webhooks', { webhooks, flash: req.flash() });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function telegramInbound({ label, token, expectedUrl, direction }) {
  const wh = { label, direction, kind: 'telegram', expectedUrl };
  if (!token) { wh.status = 'error'; wh.detail = 'No bot token set'; return wh; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const d = await r.json();
    const info = d.result || {};
    wh.url = info.url;
    wh.pending = info.pending_update_count || 0;
    wh.lastError = info.last_error_date
      ? { when: new Date(info.last_error_date * 1000), message: info.last_error_message }
      : null;
    if (!info.url) wh.status = 'error', wh.detail = 'Not registered';
    else if (info.url !== expectedUrl) wh.status = 'warning', wh.detail = `URL mismatch (expected ${expectedUrl})`;
    else if (wh.lastError) wh.status = 'warning', wh.detail = `Last error: ${wh.lastError.message}`;
    else wh.status = 'ok', wh.detail = `${wh.pending} pending`;
  } catch (e) {
    wh.status = 'error'; wh.detail = e.message;
  }
  return wh;
}

function telegramOutbound({ label, token, chat }) {
  const wh = { label, direction: 'outbound', kind: 'telegram' };
  if (!token || !chat) {
    wh.status = 'error';
    wh.detail = !token ? 'Bot token missing' : 'Chat ID missing';
  } else {
    wh.status = 'ok';
    wh.detail = `Bot ${token.split(':')[0]} → chat ${chat}`;
  }
  return wh;
}

function githubDeployInbound() {
  const wh = { label: 'GitHub → Deploy webhook', direction: 'inbound', kind: 'github' };
  try {
    const active = execSync('systemctl is-active andresanz-deploy', { timeout: 3000 }).toString().trim();
    if (active === 'active') {
      wh.status = 'ok';
      try {
        const lastDeploy = execSync('journalctl -u andresanz-deploy --no-pager -n 1 -g "deployed" -o short-iso 2>/dev/null', { timeout: 3000 }).toString().trim();
        wh.detail = lastDeploy ? `Service active · ${lastDeploy.split(' ')[0]}` : 'Service active';
      } catch { wh.detail = 'Service active'; }
    } else {
      wh.status = 'error';
      wh.detail = `Service ${active}`;
    }
  } catch (e) {
    wh.status = 'error';
    wh.detail = `Service check failed`;
  }
  return wh;
}

module.exports = router;
