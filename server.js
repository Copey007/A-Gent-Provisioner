#!/usr/bin/env node
/**
 * A-Gent Provisioner — Web Server
 * Handles signup form (lead capture) and Stripe webhook processing.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load provisioner logic
const { Provisioner, ClientStore } = require('./provisioner');

const PORT = process.env.PORT || 3000;
const clientStore = new ClientStore(path.join(__dirname, 'clients'));
const provisioner = new Provisioner(clientStore);

// ─── Pending leads storage ─────────────────────────────────

const PENDING_DIR = path.join(__dirname, 'pending');
const LEADS_FILE = path.join(PENDING_DIR, 'leads.json');

function saveLead(lead) {
  fs.mkdirSync(PENDING_DIR, { recursive: true });
  let leads = [];
  if (fs.existsSync(LEADS_FILE)) {
    try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch(e) {}
  }
  // Avoid duplicates by email
  leads = leads.filter(l => l.email !== lead.email);
  leads.push({ ...lead, createdAt: new Date().toISOString(), status: 'confirmed' });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

function getLeads() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch(e) { return []; }
}

// ─── Email sender (stub — replace with SendGrid/Postmark/etc.) ───

async function sendWelcomeEmail(email, name) {
  // TODO: Wire up SendGrid, Postmark, or AWS SES
  console.log(`[Email] Would send welcome email to ${email} (name: ${name})`);
  return true;
}

// ─── HTTP Server ────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // ── Serve static signup page
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/signup')) {
    const filePath = path.join(__dirname, '..', 'sales-agent-web', 'signup.html');
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
    return;
  }

  // ── Lead capture: POST /api/signup
  if (req.method === 'POST' && url.pathname === '/api/signup') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { name, email, company } = JSON.parse(body);

        if (!name || !email || !company) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields' }));
          return;
        }

        const lead = { name, email, company, utm: url.searchParams.get('utm') || 'direct' };

        // Save lead
        saveLead(lead);

        // Send welcome email (async, don't block)
        sendWelcomeEmail(email, name).catch(err => console.error('[Email] Error:', err.message));

        console.log(`[Lead] New signup: ${name} <${email}> at ${company}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Lead captured' }));

      } catch (err) {
        console.error('[Server] Signup error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to capture lead' }));
      }
    });
    return;
  }

  // ── Stripe webhook: POST /webhook/stripe
  if (req.method === 'POST' && url.pathname === '/webhook/stripe') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const event = JSON.parse(body);
        await provisioner.handleWebhook(event);
        res.writeHead(200);
        res.end('ok');
      } catch (err) {
        console.error('[Server] Webhook error:', err.message);
        res.writeHead(400);
        res.end('error');
      }
    });
    return;
  }

  // ── List leads (internal use)
  if (req.method === 'GET' && url.pathname === '/leads') {
    const leads = getLeads();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: leads.length, leads }));
    return;
  }

  // ── Health check
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', leads: getLeads().length }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`[Provisioner Server] Running on http://localhost:${PORT}`);
  console.log(`[Provisioner Server] Signup page: http://localhost:${PORT}/signup`);
  console.log(`[Provisioner Server] Leads: http://localhost:${PORT}/leads`);
});

module.exports = server;