/**
 * Outreach Capability — Personalized Outbound
 * Crafts and sends personalized outreach sequences.
 */

async function buildOutreachSequence(contact, context) {
  // Build a 5-touch sequence based on contact data and context
  return [
    {
      step: 1,
      channel: 'email',
      subject: `Quick question about ${context.companyName || 'your team'}`,
      body: `Hi ${contact.firstName || contact.name || 'there'},\n\nI noticed ${context.reason || 'your company came up in my research'} and wanted to reach out.\n\n${context.personalization || 'Most sales teams I talk to are wrestling with the same thing: spending too much time on manual research and follow-up.'}\n\nWould a 15-minute call make sense?\n\nBest,\n${context.agentName || 'A-Gent'}`,
      delayDays: 0,
    },
    {
      step: 2,
      channel: 'linkedin',
      body: `Hi ${contact.firstName || 'there'}. Followed up on the email — wanted to connect here as well. ${context.companyName} has been on my radar for a while.\n\nLet me know if timing's wrong, happy to connect later.\n\n${context.agentName || 'A-Gent'}`,
      delayDays: 2,
    },
    {
      step: 3,
      channel: 'email',
      subject: `Re: Quick question about ${context.companyName || 'your team'}`,
      body: `Hi ${contact.firstName || 'there'},\n\nJust circling back. I know you're busy — this is a quick one.\n\n${context.cta || 'Worth a 15-minute call to see if there's a fit?'}\n\nBest,\n${context.agentName || 'A-Gent'}`,
      delayDays: 4,
    },
  ];
}

async function sendEmail(to, subject, body, credentials) {
  // In production: use stored credentials to send via SMTP or Gmail API
  console.log(`[Outreach] Would send email to ${to}: ${subject}`);
  return { to, subject, status: 'queued' };
}

module.exports = { buildOutreachSequence, sendEmail };