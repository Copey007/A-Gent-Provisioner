#!/usr/bin/env node
/**
 * A-Gent Provisioner Agent
 * Handles client onboarding, agent creation, monitoring, and escalations.
 * 
 * Run: node provisioner.js
 * Webhook endpoint: POST /webhook/stripe
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ─── Config ───────────────────────────────────────────────
const CONFIG = {
  port: 3000,
  provisionerSecret: process.env.PROVISIONER_SECRET || 'set-me-in-env',
  masterKey: process.env.MASTER_KEY, // AES-256 key for credential encryption
  clientsDir: path.join(__dirname, 'clients'),
  templatesDir: path.join(__dirname, 'templates'),
  webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:3000/webhook/stripe',
};

// ─── Utilities ────────────────────────────────────────────

/** Encrypt a string with AES-256-GCM */
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    data: encrypted,
    tag: authTag.toString('hex'),
  };
}

/** Decrypt an encrypted object */
function decrypt(encrypted, key) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(encrypted.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
  let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** Generate a client ID */
function generateClientId() {
  return 'client_' + crypto.randomBytes(8).toString('hex');
}

/** Generate a client-specific encryption key */
function deriveClientKey(masterKey, clientId) {
  return crypto.createHash('sha256').update(masterKey + clientId).digest('hex');
}

/** Simple HTTP client */
function httpRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers,
    };
    const req = (urlObj.protocol === 'https:' ? https : http).request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Client Store ──────────────────────────────────────────

class ClientStore {
  constructor(clientsDir) {
    this.clientsDir = clientsDir;
    if (!fs.existsSync(clientsDir)) {
      fs.mkdirSync(clientsDir, { recursive: true });
    }
  }

  /** Create a new client directory and config */
  async create(clientId, plan = 'starter') {
    const clientDir = path.join(this.clientsDir, clientId);
    fs.mkdirSync(clientDir, { recursive: true });
    fs.mkdirSync(path.join(clientDir, 'credentials'), { recursive: true });
    fs.mkdirSync(path.join(clientDir, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(clientDir, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(clientDir, 'memory/daily'), { recursive: true });

    const config = {
      id: clientId,
      plan,
      createdAt: new Date().toISOString(),
      status: 'provisioning',
      channels: [],
    };

    fs.writeFileSync(
      path.join(clientDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    return config;
  }

  /** Load a client's config */
  load(clientId) {
    const configPath = path.join(this.clientsDir, clientId, 'config.json');
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  /** Update a client's config */
  save(clientId, config) {
    const configPath = path.join(this.clientsDir, clientId, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  /** Store encrypted credentials for a client */
  async storeCredential(clientId, name, plaintext) {
    if (!CONFIG.masterKey) throw new Error('MASTER_KEY not set');
    const key = deriveClientKey(CONFIG.masterKey, clientId);
    const encrypted = encrypt(plaintext, key);
    const credPath = path.join(this.clientsDir, clientId, 'credentials', `${name}.enc.json`);
    fs.writeFileSync(credPath, JSON.stringify(encrypted));
  }

  /** Retrieve and decrypt a credential */
  async getCredential(clientId, name) {
    if (!CONFIG.masterKey) throw new Error('MASTER_KEY not set');
    const credPath = path.join(this.clientsDir, clientId, 'credentials', `${name}.enc.json`);
    if (!fs.existsSync(credPath)) return null;
    const encrypted = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const key = deriveClientKey(CONFIG.masterKey, clientId);
    return decrypt(encrypted, key);
  }

  /** List all clients */
  list() {
    const dirs = fs.readdirSync(this.clientsDir).filter(f => {
      return fs.statSync(path.join(this.clientsDir, f)).isDirectory();
    });
    return dirs.map(id => this.load(id)).filter(Boolean);
  }

  /** Delete a client (offboard) */
  async delete(clientId) {
    const clientDir = path.join(this.clientsDir, clientId);
    if (fs.existsSync(clientDir)) {
      fs.rmSync(clientDir, { recursive: true, force: true });
    }
  }
}

// ─── Agent Provisioner ──────────────────────────────────────

class Provisioner {
  constructor(clientStore) {
    this.store = clientStore;
  }

  /** Handle a new client signup (called from webhook) */
  async onNewClient(clientData) {
    const { email, name, plan = 'starter', stripeCustomerId } = clientData;
    console.log(`[Provisioner] New client: ${name} (${email}) plan=${plan}`);

    // 1. Create client workspace
    const clientId = generateClientId();
    const config = await this.store.create(clientId, plan);

    // 2. Update config with client metadata
    config.email = email;
    config.name = name;
    config.stripeCustomerId = stripeCustomerId;
    config.status = 'active';
    this.store.save(clientId, config);

    // 3. Copy agent template to client workspace
    await this.copyTemplate(clientId);

    // 4. Create client-specific AGENTS.md
    await this.writeClientAgentMd(clientId, name, email);

    console.log(`[Provisioner] ✅ Client ${clientId} provisioned successfully`);
    return clientId;
  }

  /** Copy base template to client workspace */
  async copyTemplate(clientId) {
    const templateSrc = path.join(CONFIG.templatesDir, 'sales-agent');
    const clientDest = path.join(CONFIG.clientsDir, clientId, 'workspace');

    // Create workspace directory
    fs.mkdirSync(clientDest, { recursive: true });
    fs.mkdirSync(path.join(clientDest, 'capabilities'), { recursive: true });
    fs.mkdirSync(path.join(clientDest, 'integrations'), { recursive: true });
    fs.mkdirSync(path.join(clientDest, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(clientDest, 'memory/daily'), { recursive: true });

    // Copy template files
    const filesToCopy = [
      { src: 'SOUL.md', dest: 'SOUL.md' },
      { src: 'capabilities/research.js', dest: 'capabilities/research.js' },
      { src: 'capabilities/outreach.js', dest: 'capabilities/outreach.js' },
      { src: 'capabilities/follow_up.js', dest: 'capabilities/follow_up.js' },
      { src: 'capabilities/crm_sync.js', dest: 'capabilities/crm_sync.js' },
    ];

    for (const { src, dest } of filesToCopy) {
      const srcPath = path.join(templateSrc, src);
      if (fs.existsSync(srcPath)) {
        const destPath = path.join(clientDest, dest);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /** Write client-specific AGENTS.md */
  async writeClientAgentMd(clientId, name, email) {
    const workspaceDir = path.join(CONFIG.clientsDir, clientId, 'workspace');
    const agentsMd = `# AGENTS.md — ${name}

## Client
- **Name:** ${name}
- **Email:** ${email}
- **Client ID:** ${clientId}

## Context
This is a managed AI sales agent, owned and operated by A-Gent.
Configured specifically for this client's sales workflow.

## Memory
Daily logs → memory/daily/
Long-term notes → memory/MEMORY.md

## Access
- Channel: Configured during onboarding
- CRM: Stored in encrypted credentials
- Email: Stored in encrypted credentials

## Status
- Provisioned: ${new Date().toISOString()}
- Plan: Active
`;

    fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), agentsMd);
    fs.writeFileSync(path.join(workspaceDir, 'USER.md'), `# USER.md\n\nName: ${name}\nEmail: ${email}\nClient since: ${new Date().toISOString()}\n`);
    fs.writeFileSync(path.join(workspaceDir, 'MEMORY.md'), `# MEMORY.md — ${name}\n\n*Auto-provisioned. Update with client context.*\n`);
  }

  /** Handle Stripe webhook */
  async handleWebhook(event) {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        console.log(`[Provisioner] Subscription event: ${event.type}`);
        // Update client status based on subscription
        break;

      case 'customer.subscription.deleted':
        console.log(`[Provisioner] Churn detected: ${event.type}`);
        // Mark client for offboarding
        break;

      case 'invoice.payment_failed':
        console.log(`[Provisioner] Payment failed for customer: ${event.data.object.customer}`);
        // Send warning to client, flag in dashboard
        break;
    }
  }

  /** Store client credentials (HubSpot, Gmail, etc.) */
  async storeCredentials(clientId, credentials) {
    for (const [name, value] of Object.entries(credentials)) {
      await this.store.storeCredential(clientId, name, value);
    }
  }

  /** Get a client's decrypted credential */
  async getCredential(clientId, name) {
    return this.store.getCredential(clientId, name);
  }

  /** Offboard a client */
  async offboardClient(clientId) {
    const config = this.store.load(clientId);
    if (!config) return;
    config.status = 'offboarding';
    this.store.save(clientId, config);
    // In production: export data, cancel subscriptions, then delete
    console.log(`[Provisioner] Client ${clientId} offboarding initiated`);
  }
}

// ─── HTTP Server ──────────────────────────────────────────

async function startServer() {
  const store = new ClientStore(CONFIG.clientsDir);
  const provisioner = new Provisioner(store);

  // Ensure master key is set
  if (!CONFIG.masterKey) {
    console.warn('[Provisioner] WARNING: MASTER_KEY not set. Credentials will not be encrypted.');
  }

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', clients: store.list().length }));
      return;
    }

    // Stripe webhook
    if (req.method === 'POST' && url.pathname === '/webhook/stripe') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const event = JSON.parse(body);
          // Verify signature in production
          await provisioner.handleWebhook(event);
          res.writeHead(200);
          res.end('ok');
        } catch (err) {
          console.error('[Provisioner] Webhook error:', err.message);
          res.writeHead(400);
          res.end('error');
        }
      });
      return;
    }

    // Manual client creation (for testing)
    if (req.method === 'POST' && url.pathname === '/client') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (url.searchParams.get('secret') !== CONFIG.provisionerSecret) {
            res.writeHead(401);
            res.end('unauthorized');
            return;
          }
          const clientId = await provisioner.onNewClient(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ clientId }));
        } catch (err) {
          console.error('[Provisioner] Create client error:', err.message);
          res.writeHead(500);
          res.end('error');
        }
      });
      return;
    }

    // List clients
    if (req.method === 'GET' && url.pathname === '/clients') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(store.list()));
      return;
    }

    // Get client
    if (req.method === 'GET' && url.pathname.startsWith('/client/')) {
      const clientId = url.pathname.split('/')[2];
      const config = store.load(clientId);
      if (!config) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  server.listen(CONFIG.port, () => {
    console.log(`[Provisioner] Running on port ${CONFIG.port}`);
    console.log(`[Provisioner] Webhook endpoint: POST /webhook/stripe`);
    console.log(`[Provisioner] Clients dir: ${CONFIG.clientsDir}`);
  });
}

// Expose classes for use by server.js
module.exports = { Provisioner, ClientStore, generateClientId };