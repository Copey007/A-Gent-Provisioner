/**
 * Content Calendar — Manage the content calendar file
 */

const fs = require('fs');
const path = require('path');

const CALENDAR_PATH = path.join(process.env.HOME, '.openclaw', 'workspace', 'agent-content', 'calendar.md');

/**
 * Read the content calendar
 */
function readCalendar() {
  if (!fs.existsSync(CALENDAR_PATH)) return null;
  return fs.readFileSync(CALENDAR_PATH, 'utf8');
}

/**
 * Get all posts from calendar that are not yet queued
 */
function getUnqueuedPosts() {
  const content = readCalendar();
  if (!content) return [];

  const posts = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    if (!line.startsWith('Post')) continue;
    
    // Calendar format: Post: "..." — channel: x
    // Or: Post: "..." — ✅ submitted to Buffer (X channel)
    const emDashIdx = line.indexOf('—');
    if (emDashIdx === -1) continue;
    
    // Extract text between first quote and em dash
    const firstQuote = line.indexOf('"');
    const lastQuote = line.lastIndexOf('"');
    if (firstQuote === -1 || lastQuote === -1 || lastQuote <= firstQuote) continue;
    
    const text = line.slice(firstQuote + 1, lastQuote).trim();
    
    // Determine channel from text after em dash
    const afterDash = line.slice(emDashIdx + 1).toLowerCase();
    let channel = 'x';
    if (afterDash.includes('linkedin')) channel = 'linkedin';
    
    posts.push({ text, channel, raw: line });
  }
  
  return posts;
}

/**
 * Mark a post as queued in the calendar
 * Replaces unqueued post line with [QUEUED] version
 */
function markQueued(postText) {
  const content = readCalendar();
  if (!content) return false;
  
  // Find the line containing this post text
  const lines = content.split('\n');
  let updated = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('—') && line.includes(postText.slice(0, 30))) {
      // Replace the line with a queued version
      lines[i] = line.replace(/— ✅ submitted to Buffer.*/, '— [QUEUED]');
      updated = true;
      break;
    }
  }
  
  if (updated) {
    fs.writeFileSync(CALENDAR_PATH, lines.join('\n'));
  }
  return updated;
}

/**
 * Add a new post to the calendar
 */
function addPost(date, text, channel = 'x') {
  const entry = `\n## ${date}\nPost: "${text}" — channel: ${channel}`;
  fs.appendFileSync(CALENDAR_PATH, entry);
}

/**
 * Get this week's posts (all, not filtered by queued status)
 */
function getThisWeeksPosts() {
  const content = readCalendar();
  if (!content) return [];
  
  const posts = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    if (!line.startsWith('Post')) continue;
    const emDashIdx = line.indexOf('—');
    if (emDashIdx === -1) continue;
    const firstQuote = line.indexOf('"');
    const lastQuote = line.lastIndexOf('"');
    if (firstQuote === -1 || lastQuote === -1) continue;
    const text = line.slice(firstQuote + 1, lastQuote);
    posts.push({ text, channel: 'x' });
  }
  
  return posts;
}

module.exports = { readCalendar, getUnqueuedPosts, markQueued, addPost, getThisWeeksPosts };