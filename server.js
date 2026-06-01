#!/usr/bin/env node
/**
 * A-Gent Provisioner — Web Server
 * Handles signup form (lead capture) and Stripe webhook processing.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Resend } = require('resend');

// Load provisioner logic
const { Provisioner, ClientStore } = require('./provisioner');

const PORT = process.env.PORT || 3000;
const clientStore = new ClientStore(path.join(__dirname, 'clients'));
const provisioner = new Provisioner(clientStore);

// Resend client
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'A-Gent <noreply@a-gent.co>';

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

// ─── Email sender (Resend) ──────────────────────────────────────────

async function sendWelcomeEmail(email, name) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[Email] RESEND_API_KEY not set — skipping welcome email to ${email}`);
    return false;
  }
  try {
    const loginUrl = 'https://dashboard.a-gent.co';
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Welcome to A-Gent — Your AI Sales Agent is Ready',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 40px;">
            <img src="https://a-gent.co/icons/logo.png" alt="A-Gent" width="64" height="64" style="border-radius: 12px;">
            <h1 style="color: #f9f9f9; font-size: 28px; margin: 20px 0 10px;">Welcome${name ? ', ' + name : ''}!</h1>
            <p style="color: #888; font-size: 16px;">Your AI sales agent is now active and ready to work.</p>
          </div>

          <div style="background: #111; border: 1px solid #222; border-radius: 16px; padding: 30px; margin-bottom: 30px;">
            <h2 style="color: #c9a227; font-size: 18px; margin: 0 0 20px;">🚀 What happens next</h2>
            <ol style="color: #ccc; font-size: 15px; line-height: 1.8; padding-left: 20px;">
              <li>Check your OpenClaw dashboard for your AI agent</li>
              <li>Your agent is researching prospects and building outreach lists</li>
              <li>You'll receive a weekly performance report</li>
              <li>Reply anytime — your agent works 24/7</li>
            </ol>
          </div>

          <div style="background: #111; border: 1px solid #222; border-radius: 16px; padding: 30px; margin-bottom: 30px;">
            <h2 style="color: #c9a227; font-size: 18px; margin: 0 0 20px;">🔑 Your agent dashboard</h2>
            <a href="${loginUrl}" style="display: inline-block; background: #c9a227; color: #050508; padding: 14px 28px; border-radius: 10px; font-weight: 700; font-size: 16px; text-decoration: none;">Access Your Dashboard</a>
            <p style="color: #666; font-size: 13px; margin-top: 15px;">Or visit: <a href="${loginUrl}" style="color: #888;">${loginUrl}</a></p>
          </div>

          <div style="background: #0a0a0a; border: 1px solid #c9a227; border-radius: 12px; padding: 24px; text-align: center;">
            <p style="color: #c9a227; font-size: 14px; margin: 0;">💬 Need help? Message us on <a href="https://t.me/OpenClawSalesBot" style="color: #c9a227;">Telegram</a> — we respond within hours.</p>
          </div>
        </div>
      `,
    });
    console.log(`[Email] Welcome email sent to ${email}`);
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send to ${email}:`, err.message);
    return false;
  }
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