/**
 * Blog Pipeline — Draft → Review → Publish workflow
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DRAFTS_DIR = path.join(process.env.HOME, '.openclaw', 'workspace', 'agent-content', 'drafts');
const BLOG_DIR = path.join(process.env.HOME, '.openclaw', 'workspace', 'sales-agent-web', 'blog');

// Ensure directories exist
if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

/**
 * Draft a blog post
 * @param {string} title - Post title
 * @param {string} topic - What to write about
 * @param {string} targetChannel - 'x' | 'linkedin' | 'both'
 */
async function draftBlogPost(title, topic, targetChannel = 'both') {
  const date = new Date().toISOString().split('T')[0];
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const filename = `${date}-${slug}.md`;
  const filepath = path.join(DRAFTS_DIR, filename);

  const content = `---
title: "${title}"
date: "${date}"
channel: "${targetChannel}"
status: "draft"
---

# ${title}

*Draft created by Marketing Agent. Awaiting review before publishing.*

## Introduction

${await generateIntro(topic)}

## Key Points

- Point 1
- Point 2
- Point 3

## Main Content

Write your content here.

## Conclusion

Call to action: [Sign up for A-Gent free](https://a-gent.co/signup)

## Internal Notes

- Target audience: [describe]
- Primary CTA: [what]
- Related posts: [links]
`;

  fs.writeFileSync(filepath, content);
  return { filepath, filename, status: 'draft' };
}

/**
 * Generate a blog post intro (placeholder — wire to AI when ready)
 */
async function generateIntro(topic) {
  return `In this post, we explore how ${topic} can transform your sales workflow.`;
}

/**
 * Submit draft for review (escalates to Sales Agent / Mark)
 */
async function submitForReview(filename) {
  const filepath = path.join(DRAFTS_DIR, filename);
  if (!fs.existsSync(filepath)) return { error: 'Draft not found' };

  const content = fs.readFileSync(filepath, 'utf8');
  const updated = content.replace('status: "draft"', 'status: "review"');
  fs.writeFileSync(filepath, updated);

  return { status: 'review', filepath };
}

/**
 * Publish an approved draft to the blog directory
 */
async function publishDraft(filename) {
  const draftPath = path.join(DRAFTS_DIR, filename);
  if (!fs.existsSync(draftPath)) return { error: 'Draft not found' };

  const content = fs.readFileSync(draftPath, 'utf8');
  const updated = content.replace('status: "review"', 'status: "published"');
  
  const blogPath = path.join(BLOG_DIR, filename);
  fs.writeFileSync(blogPath, updated);

  return { status: 'published', blogPath };
}

/**
 * List all drafts
 */
function listDrafts(status = null) {
  const files = fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith('.md'));
  const drafts = files.map(f => {
    const content = fs.readFileSync(path.join(DRAFTS_DIR, f), 'utf8');
    const titleMatch = content.match(/title:\s*"(.+?)"/);
    const statusMatch = content.match(/status:\s*"(.+?)"/);
    return {
      filename: f,
      title: titleMatch ? titleMatch[1] : f,
      status: statusMatch ? statusMatch[1] : 'unknown',
    };
  });

  if (status) return drafts.filter(d => d.status === status);
  return drafts;
}

module.exports = { draftBlogPost, submitForReview, publishDraft, listDrafts, DRAFTS_DIR };