'use strict';

const express = require('express');
const router  = express.Router();

const LINODE_API = 'https://api.linode.com/v4';

function linodeGet(path) {
  const token = process.env.LINODE_TOKEN;
  return fetch(`${LINODE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }).then(r => r.json());
}

function linodePost(path, body) {
  const token = process.env.LINODE_TOKEN;
  return fetch(`${LINODE_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

function linodelPut(path, body) {
  const token = process.env.LINODE_TOKEN;
  return fetch(`${LINODE_API}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

function linodeDel(path) {
  const token = process.env.LINODE_TOKEN;
  return fetch(`${LINODE_API}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.status === 200 ? r.json() : { ok: true });
}

function awsCli(cmd) {
  const { execSync } = require('child_process');
  const out = execSync(`aws ${cmd} --output json 2>/dev/null`, {
    timeout: 15000, env: { ...process.env },
  }).toString().trim();
  return JSON.parse(out);
}

async function route53Domains() {
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      'aws route53domains list-domains --region us-east-1 --output json 2>/dev/null',
      {
        timeout: 15000,
        env: { ...process.env },
      }
    ).toString().trim();
    const data = JSON.parse(out);
    return (data.Domains || []).sort((a, b) => a.DomainName.localeCompare(b.DomainName));
  } catch { return []; }
}

// GET /domains
router.get('/', async (req, res) => {
  try {
    const [linodeData, r53domains] = await Promise.all([
      linodeGet('/domains?page_size=200'),
      route53Domains(),
    ]);
    console.log('[domains] linode results:', linodeData.results, 'errors:', linodeData.errors);
    const domains = (linodeData.data || []).sort((a, b) => a.domain.localeCompare(b.domain));
    res.render('domains', { domains, r53domains, flash: req.flash() });
  } catch (e) {
    console.error('[domains] error:', e);
    res.render('domains', { domains: [], r53domains: [], error: e.message, flash: req.flash() });
  }
});


const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// GET /domains/r53/:name — Route 53 domain detail
router.get('/r53/:name', async (req, res) => {
  const name = req.params.name;
  if (!DOMAIN_RE.test(name)) { req.flash('error', 'Invalid domain'); return res.redirect('/domains'); }
  try {
    const detail = awsCli(`route53domains get-domain-detail --region us-east-1 --domain-name ${name}`);
    res.render('domain-r53', { domain: detail, flash: req.flash() });
  } catch (e) {
    req.flash('error', e.message);
    res.redirect('/domains');
  }
});

// POST /domains/r53/:name/nameservers — update nameservers
router.post('/r53/:name/nameservers', async (req, res) => {
  const name = req.params.name;
  const { nameservers } = req.body;
  try {
    const nsList = (Array.isArray(nameservers) ? nameservers : [nameservers])
      .map(n => n.trim()).filter(Boolean).map(n => ({ Name: n }));
    const { execSync } = require('child_process');
    execSync(
      `aws route53domains update-domain-nameservers --region us-east-1 --domain-name ${name} --nameservers '${JSON.stringify(nsList)}' --output json 2>/dev/null`,
      { timeout: 15000, env: { ...process.env } }
    );
    req.flash('success', 'Nameservers updated');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect(`/domains/r53/${name}`);
});

// GET /domains/:id/records
router.get('/:id/records', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const [domainData, recordsData] = await Promise.all([
      linodeGet(`/domains/${id}`),
      linodeGet(`/domains/${id}/records?page_size=200`),
    ]);
    const records = (recordsData.data || []).sort((a, b) => {
      const typeOrder = { SOA:0, NS:1, MX:2, A:3, AAAA:4, CNAME:5, TXT:6, SRV:7 };
      return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99) || a.name.localeCompare(b.name);
    });
    res.render('domain-records', { domain: domainData, records, flash: req.flash() });
  } catch (e) {
    req.flash('error', e.message);
    res.redirect('/domains');
  }
});

// POST /domains/:id/records — create record
router.post('/:id/records', async (req, res) => {
  const id = parseInt(req.params.id);
  const { type, name, target, ttl_sec, priority } = req.body;
  try {
    const body = { type, name, target, ttl_sec: parseInt(ttl_sec) || 300 };
    if (priority) body.priority = parseInt(priority);
    const result = await linodePost(`/domains/${id}/records`, body);
    if (result.errors) req.flash('error', result.errors.map(e => e.reason).join(', '));
    else req.flash('success', `Record created`);
  } catch (e) { req.flash('error', e.message); }
  res.redirect(`/domains/${id}/records`);
});

// POST /domains/:id/records/:rid/delete
router.post('/:id/records/:rid/delete', async (req, res) => {
  const { id, rid } = req.params;
  try {
    await linodeDel(`/domains/${id}/records/${rid}`);
    req.flash('success', 'Record deleted');
  } catch (e) { req.flash('error', e.message); }
  res.redirect(`/domains/${id}/records`);
});

// POST /domains/:id/records/:rid — update record
router.post('/:id/records/:rid', async (req, res) => {
  const { id, rid } = req.params;
  const { type, name, target, ttl_sec, priority } = req.body;
  try {
    const body = { type, name, target, ttl_sec: parseInt(ttl_sec) || 300 };
    if (priority) body.priority = parseInt(priority);
    const result = await linodelPut(`/domains/${id}/records/${rid}`, body);
    if (result.errors) req.flash('error', result.errors.map(e => e.reason).join(', '));
    else req.flash('success', 'Record updated');
  } catch (e) { req.flash('error', e.message); }
  res.redirect(`/domains/${id}/records`);
});

module.exports = router;
