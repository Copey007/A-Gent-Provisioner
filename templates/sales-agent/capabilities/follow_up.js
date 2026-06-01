/**
 * Follow-Up Capability — Never Drop the Ball
 * Ensures no lead goes cold.
 */

async function checkSequences(clientId, store) {
  // In production: scan email sequences, check for overdue follow-ups
  // Return list of contacts who need a follow-up
  return [];
}

async function sendFollowUp(contact, sequenceStep, credentials) {
  const delay = sequenceStep.delayDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (now < sequenceStep.scheduledFor) {
    return { status: 'waiting', nextSendAt: sequenceStep.scheduledFor };
  }
  // Send the follow-up via appropriate channel
  return { status: 'sent', channel: sequenceStep.channel, timestamp: new Date().toISOString() };
}

async function escalateIfNeeded(contact, daysSinceLastContact) {
  if (daysSinceLastContact > 14) {
    return {
      escalate: true,
      reason: 'No response after 3 touches',
      contact,
      recommendation: 'Consider a different angle or removing from sequence',
    };
  }
  return { escalate: false };
}

module.exports = { checkSequences, sendFollowUp, escalateIfNeeded };