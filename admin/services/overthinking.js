'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fetch     = require('node-fetch');
const fs        = require('fs');
const path      = require('path');

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID     = process.env.TELEGRAM_CHAT_ID;
const STATE_FILE  = path.join(__dirname, '..', 'data', 'overthinking-state.json');
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'overthinking-config.json');

const TGAPI = `https://api.telegram.org/bot${BOT_TOKEN}`;

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { message: "Don't think too much.", imageUrl: '' }; }
}

// 9am–9pm split into four 3-hour slots; pick one random minute per slot
const SLOTS = [
  { start: 9,  end: 12 },
  { start: 12, end: 15 },
  { start: 15, end: 18 },
  { start: 18, end: 21 },
];

function pad(n) { return String(n).padStart(2, '0'); }

function generateSchedule() {
  return SLOTS.map(({ start, end }) => {
    const totalMinutes = (end - start) * 60;
    const offset = Math.floor(Math.random() * totalMinutes);
    const h = start + Math.floor(offset / 60);
    const m = offset % 60;
    return `${pad(h)}:${pad(m)}`;
  });
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { date: null, scheduledTimes: [], sentTimes: [] }; }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n');
}

async function tgSend(message, imageUrl) {
  if (imageUrl) {
    const r = await fetch(`${TGAPI}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, photo: imageUrl, caption: message }),
    });
    return r.json();
  }
  const r = await fetch(`${TGAPI}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' }),
  });
  return r.json();
}

async function sendReminder() {
  if (!CHAT_ID) { console.error('TELEGRAM_CHAT_ID not set'); process.exit(1); }

  const state = loadState();
  const today = new Date().toISOString().split('T')[0];

  if (state.date !== today) {
    state.date           = today;
    state.scheduledTimes = generateSchedule();
    state.sentTimes      = [];
    console.log(`[overthinking] New schedule for ${today}: ${state.scheduledTimes.join(', ')}`);
  }

  const now  = new Date();
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const due  = state.scheduledTimes.filter(t => t <= hhmm && !state.sentTimes.includes(t));

  if (!due.length) {
    console.log(`[overthinking] Nothing due at ${hhmm}`);
    saveState(state);
    return;
  }

  const { message, imageUrl } = loadConfig();
  for (const t of due) {
    const result = await tgSend(message, imageUrl);
    if (!result.ok) {
      console.error(`[overthinking] Telegram error at ${t}:`, JSON.stringify(result));
      continue;
    }
    state.sentTimes.push(t);
    console.log(`[overthinking] Sent at ${t}`);
  }

  saveState(state);
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'send') {
    sendReminder().catch(e => { console.error(e); process.exit(1); });
  } else {
    console.log('Usage: node overthinking.js send');
    process.exit(1);
  }
}
