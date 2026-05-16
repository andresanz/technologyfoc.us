'use strict';

let nextFireTime = null;
let timer        = null;

function schedule() {
  const now  = new Date();
  const next = new Date();
  next.setHours(21, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  nextFireTime = next;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const { sendPrompt } = require('./gratitude');
      const result = await sendPrompt();
      console.log('Gratitude prompt:', result);
    } catch (e) {
      console.error('Gratitude scheduler error:', e.message);
    }
    schedule();
  }, next - now);
  console.log(`Gratitude prompt scheduled for ${next.toLocaleTimeString()}`);
}

function getNextFireTime() { return nextFireTime; }

module.exports = { schedule, getNextFireTime };
