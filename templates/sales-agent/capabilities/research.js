/**
 * Research Capability — Account Research for Sales
 * Researches companies, finds contacts, detects buying signals.
 */

const https = require('https');

const SERPER_API_KEY = process.env.SERPER_API_KEY;

async function searchGoogle(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ q: query });
    const req = https.request({
      hostname: 'google.serper.dev',
      path: '/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': SERPER_API_KEY || '',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function researchCompany(companyName) {
  const results = await searchGoogle(`${companyName} funding 2024 2025`);
  return {
    name: companyName,
    searchResults: results.organic?.slice(0, 5) || [],
    timestamp: new Date().toISOString(),
  };
}

async function findDecisionMakers(companyName) {
  const results = await searchGoogle(`site:linkedin.com "${companyName}" "VP of Sales" OR "Head of" OR "Director of"`);
  return results.organic?.slice(0, 5).map(r => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
  })) || [];
}

module.exports = { researchCompany, findDecisionMakers, searchGoogle };