'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch      = require('node-fetch');
const fs         = require('fs');
const path       = require('path');

const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID        = process.env.TELEGRAM_CHAT_ID;
const BLOG           = process.env.GRATITUDE_BLOG || 'randomcategory.com';
const SITES_ROOT     = process.env.SITES_ROOT || '/var/www';
const GRATITUDE_FILE = path.join(SITES_ROOT, BLOG, 'content', 'gratitude.json');
const STATE_FILE     = path.join(__dirname, '..', 'data', 'gratitude-state.json');

const TGAPI = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Prompts ───────────────────────────────────────────────────────────────────

const PROMPTS_FILE = path.join(__dirname, "..", "data", "gratitude-prompts.json");
function loadPrompts() {
  try { return JSON.parse(fs.readFileSync(PROMPTS_FILE, "utf8")); } catch { return []; }
}
const PROMPTS = [
  "What's one small thing from today you'd miss if it were gone?",
  "Who did something kind for you recently — even something tiny?",
  "What part of your body are you grateful it's working today?",
  "Name something you walked past today without noticing how good it is.",
  "What's a comfort in your life you never really thank yourself for creating?",
  "What's something that used to be hard that's now easy — and you forget to appreciate that?",
  "What smell, sound, or texture brought you quiet pleasure today?",
  "What's a tool or thing you own that genuinely makes your life better?",
  "Who in your life shows up consistently, without fanfare?",
  "What's one thing about where you live that you're glad about right now?",
  "Describe the best ten minutes of your day.",
  "What made you laugh or smile today — even a little?",
  "Was there a moment today when you felt at ease? What was happening?",
  "What's something you ate or drank today that you actually enjoyed?",
  "Was there a moment of quiet today? Where were you?",
  "What's the last thing that genuinely surprised you in a good way?",
  "Did anything go right today that you didn't expect to?",
  "What's a simple pleasure you had access to today?",
  "What's a memory from childhood that still makes you feel good?",
  "Think of a hard time you got through. What does that say about you?",
  "Who's someone from your past you learned something important from?",
  "What's a place you've been that still feels special when you think about it?",
  "What's something you did years ago that you're still glad you did?",
  "What's a version of yourself from 5 years ago you'd want to encourage?",
  "What's a skill you picked up at some point in your life that still serves you?",
  "Who would you call if you needed someone tonight — and how good is it to have them?",
  "Who's someone in your life you don't tell enough that you appreciate them?",
  "What's something a stranger did recently that reminded you people are decent?",
  "Think of someone who believed in you. What did that feel like?",
  "Who makes you feel like yourself when you're around them?",
  "What's something you handled better recently than you would have before?",
  "What's a belief or habit you've changed that improved your life?",
  "What's a hard thing you're doing right now that your past self would be proud of?",
  "What's one thing you know about yourself now that took years to figure out?",
  "What are you getting better at, slowly?",
  "If today were a page in a book, what one line would you highlight?",
  "What would you tell someone going through a hard time, based on your experience?",
  "What's something that felt like a problem that now seems smaller?",
  "What's something you're looking forward to — near or far?",
  "If you had to find one thing beautiful about today, what would it be?",
  "What does your life have right now that you once hoped for?",
  "Describe your morning as if you were writing it for someone who'd never experienced one.",
  "What's a color, a sound, and a feeling that describe today?",
  "Write one sentence about today that could be the first line of a short story.",
];

// ── State ─────────────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastPromptSent: null, lastPrompt: null, updateOffset: 0, usedPrompts: [], processedUpdates: [] }; }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n');
}

function pickPrompt(state) {
  const PROMPTS = loadPrompts();
  const used      = state.usedPrompts || [];
  const allIdx    = PROMPTS.map((_, i) => i);
  const remaining = allIdx.filter(i => !used.includes(i));
  const pool      = remaining.length ? remaining : allIdx;
  const idx       = pool[Math.floor(Math.random() * pool.length)];
  state.usedPrompts = remaining.length ? [...used, idx] : [idx];
  return PROMPTS[idx];
}

// ── Telegram helpers ──────────────────────────────────────────────────────────

async function tgSend(text, chatId) {
  const r = await fetch(`${TGAPI}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId || CHAT_ID, text, parse_mode: 'Markdown' }),
  });
  return r.json();
}

async function tgGetUpdates(offset) {
  const r = await fetch(`${TGAPI}/getUpdates?offset=${offset}&timeout=0&limit=20`);
  return r.json();
}

// ── Send prompt ───────────────────────────────────────────────────────────────

async function sendPrompt() {
  if (!CHAT_ID) { console.error('TELEGRAM_CHAT_ID not set'); process.exit(1); }
  const state  = loadState();
  const prompt = pickPrompt(state);
  const result = await tgSend(`✍️ *Daily Gratitude Prompt*\n\n${prompt}`, CHAT_ID);
  if (!result.ok) { console.error('Telegram error:', JSON.stringify(result)); process.exit(1); }
  state.lastPromptSent = new Date().toISOString();
  state.lastPrompt     = prompt;
  state.updateOffset   = state.updateOffset || 0;
  saveState(state);
  console.log(`[gratitude] Prompt sent: "${prompt.slice(0, 60)}"`);
}

// ── Check replies ─────────────────────────────────────────────────────────────

async function checkReplies() {
  if (!CHAT_ID) { console.error('TELEGRAM_CHAT_ID not set'); return; }
  const state = loadState();
  if (!state.lastPromptSent) { console.log('[gratitude] No prompt sent yet'); return; }

  const data = await tgGetUpdates(state.updateOffset || 0);
  if (!data.ok) { console.error('Telegram error:', data); return; }

  let newOffset = state.updateOffset || 0;
  let created   = 0;

  for (const update of data.result) {
    newOffset = Math.max(newOffset, update.update_id + 1);
    const msg = update.message;
    if (!msg || !msg.text) continue;
    if (String(msg.chat.id) !== String(CHAT_ID)) continue;

    const msgTime    = new Date(msg.date * 1000);
    const promptTime = new Date(state.lastPromptSent);
    if (msgTime <= promptTime) continue;
    if (msg.text.startsWith('/')) continue;

    const updateId = update.update_id;
    if ((state.processedUpdates || []).includes(updateId)) continue;

    console.log(`[gratitude] Processing: "${msg.text.slice(0, 80)}"`);
    await appendEntry(msg.text, state.lastPrompt);

    state.processedUpdates = [...(state.processedUpdates || []), updateId];
    if (state.processedUpdates.length > 500) state.processedUpdates = state.processedUpdates.slice(-500);
    created++;
  }

  state.updateOffset = newOffset;
  saveState(state);
  console.log(`[gratitude] Done — ${created} post(s) created`);
}

// ── Append entry ──────────────────────────────────────────────────────────────

async function appendEntry(rawText, prompt) {
  const dateStr = new Date().toISOString().split('T')[0];
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(GRATITUDE_FILE, 'utf8')); } catch {}
  entries.push({ date: dateStr, prompt, response: rawText });
  fs.mkdirSync(path.dirname(GRATITUDE_FILE), { recursive: true });
  fs.writeFileSync(GRATITUDE_FILE, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  console.log(`[gratitude] Appended entry for ${dateStr} (${entries.length} total)`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const cmd = process.argv[2];
  if      (cmd === 'send')  sendPrompt().catch(e => { console.error(e); process.exit(1); });
  else if (cmd === 'check') checkReplies().catch(e => { console.error(e); process.exit(1); });
  else if (cmd === 'test')  appendEntry(process.argv.slice(3).join(' ') || 'the light through the window this morning', 'What made you smile today?')
    .then(() => console.log('Test entry appended')).catch(console.error);
  else {
    console.log('Usage: node gratitude.js [send|check|test <text>]');
    process.exit(1);
  }
}

module.exports = { appendEntry, loadState };
