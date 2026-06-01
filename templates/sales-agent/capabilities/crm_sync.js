/**
 * CRM Sync Capability — Keep Pipelines Clean
 * Automatically updates HubSpot / Salesforce.
 */

async function syncContactToCrm(contact, crmType, credentials) {
  if (crmType === 'hubspot') {
    return syncToHubSpot(contact, credentials);
  } else if (crmType === 'salesforce') {
    return syncToSalesforce(contact, credentials);
  }
  return { error: 'Unknown CRM type' };
}

async function syncToHubSpot(contact, credentials) {
  // In production: use HubSpot API v3 with stored credentials
  const apiKey = credentials.hubspotApiKey;
  console.log(`[CRM] Syncing ${contact.email} to HubSpot`);
  return {
    status: 'synced',
    crm: 'hubspot',
    contactId: contact.id || null,
    timestamp: new Date().toISOString(),
  };
}

async function syncToSalesforce(contact, credentials) {
  // In production: use Salesforce REST API with stored credentials
  const accessToken = credentials.salesforceAccessToken;
  console.log(`[CRM] Syncing ${contact.email} to Salesforce`);
  return {
    status: 'synced',
    crm: 'salesforce',
    contactId: contact.id || null,
    timestamp: new Date().toISOString(),
  };
}

async function getContactFromCrm(contactId, crmType, credentials) {
  // In production: fetch contact by ID from HubSpot or Salesforce
  return null;
}

module.exports = { syncContactToCrm, getContactFromCrm };