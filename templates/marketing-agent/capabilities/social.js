/**
 * Social Media Capability — Post to Buffer, track calendar
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load credentials from file
const CRED_PATH = path.join(process.env.HOME, '.openclaw', 'workspace', 'agent-credentials', 'buffer-api.json');
let _bufferToken = null;
function getBufferToken() {
  if (_bufferToken) return _bufferToken;
  if (process.env.BUFFER_ACCESS_TOKEN) return process.env.BUFFER_ACCESS_TOKEN;
  try {
    const creds = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
    _bufferToken = creds.buffer_api_token;
  } catch(e) {
    console.error('[Social] Could not load Buffer credentials:', e.message);
  }
  return _bufferToken;
}

const BUFFER_ENDPOINT = 'https://api.buffer.com';

// Channel IDs from our Buffer setup
const CHANNELS = {
  a_gent_x: '6a130ebac687a22dd41ffe22',
  a_gent_linkedin: '6a132fa9c687a22dd4209138',
  mark_cope_x: '6a162ebbc687a22dd42cec9b',
};

/**
 * Queue a post to Buffer
 * @param {string} text - Post text
 * @param {string} channel - 'a_gent_x' | 'a_gent_linkedin' | 'mark_cope_x'
 */
async function queuePost(text, channel = 'a_gent_x') {
  const channelId = CHANNELS[channel];
  if (!channelId) throw new Error(`Unknown channel: ${channel}`);

  const query = `mutation { createPost(input: { channelId: "${channelId}", text: "${escapeForGraphQL(text)}", schedulingType: automatic, mode: addToQueue }) { ... on PostActionSuccess { post { id text status dueAt } } } }`;

  return await bufferGraphQL(query);
}

/**
 * Queue a post to multiple channels
 */
async function broadcastPost(text, channels = ['a_gent_x', 'a_gent_linkedin']) {
  const results = [];
  for (const channel of channels) {
    try {
      results.push(await queuePost(text, channel));
    } catch (err) {
      results.push({ channel, error: err.message });
    }
  }
  return results;
}

/**
 * Get queued posts for a channel
 */
async function getQueuedPosts(channel = 'a_gent_x') {
  const channelId = CHANNELS[channel];
  const query = `query { channels(channelId: "${channelId}") { name posts(limit: 10) { nodes { id text status dueAt } } } }`;
  return await bufferGraphQL(query);
}

/**
 * Get all channels for the organization
 */
async function getChannels() {
  const query = `query { account { organizations { id name channels { id name service } } } }`;
  return await bufferGraphQL(query);
}

/**
 * Core GraphQL call to Buffer
 */
async function bufferGraphQL(query) {
  const token = getBufferToken();
  if (!token) throw new Error('Buffer token not configured');

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.buffer.com',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) reject(new Error(parsed.errors[0].message));
          else resolve(parsed.data);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function escapeForGraphQL(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

module.exports = { queuePost, broadcastPost, getQueuedPosts, getChannels, CHANNELS };