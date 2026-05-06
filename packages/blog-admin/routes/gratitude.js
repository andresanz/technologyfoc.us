'use strict';

const express  = require('express');
const twilio   = require('twilio');
const { appendEntry, loadState } = require('../services/gratitude');
const router   = express.Router();

const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;

// POST /gratitude/webhook — Twilio posts incoming SMS here
router.post('/webhook', express.urlencoded({ extended: false }), (req, res) => {
  // Validate request is from Twilio
  const signature = req.headers['x-twilio-signature'];
  const url       = `${process.env.ADMIN_URL}/gratitude/webhook`;
  const valid     = twilio.validateRequest(AUTH_TOKEN, signature, url, req.body);

  if (!valid) {
    console.warn('[gratitude] Invalid Twilio signature');
    return res.status(403).send('Forbidden');
  }

  const from = req.body.From;
  const body = (req.body.Body || '').trim();

  if (!body) return res.sendStatus(204);

  const state = loadState();
  appendEntry(body, state.lastPrompt || '')
    .then(() => console.log(`[gratitude] Saved reply from ${from}: "${body.slice(0, 60)}"`))
    .catch(e => console.error('[gratitude] Failed to save reply:', e));

  // Respond with empty TwiML so Twilio doesn't send an error
  res.type('text/xml').send('<Response></Response>');
});

module.exports = router;
