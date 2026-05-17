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
      const { sendPrompt, checkReplies } = require('./gratitude');
      const result = await sendPrompt();
      console.log('Gratitude prompt:', result);
      if (result.sent) {
        // Poll for reply every 10 min for 2 hours
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const r = await checkReplies();
            console.log(`Gratitude check replies: ${r.created} new`);
            if (r.created > 0 || attempts >= 12) clearInterval(poll);
          } catch (e) {
            console.error('Gratitude check error:', e.message);
            if (attempts >= 12) clearInterval(poll);
          }
        }, 10 * 60 * 1000);
      }
    } catch (e) {
      console.error('Gratitude scheduler error:', e.message);
    }
    schedule();
  }, next - now);
  console.log(`Gratitude prompt scheduled for ${next.toLocaleTimeString()}`);
}

function getNextFireTime() { return nextFireTime; }

module.exports = { schedule, getNextFireTime };
