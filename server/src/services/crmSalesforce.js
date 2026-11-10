import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import CrmConfiguration from '../models/CrmConfiguration.js';
import CrmSyncConflict from '../models/CrmSyncConflict.js';
import CrmSyncLink from '../models/CrmSyncLink.js';
import User from '../models/User.js';
import WorkspaceRecord from '../models/WorkspaceRecord.js';
import { audit } from './audit.js';

const objectKinds = { Lead: 'lead', Account: 'client', Contact: 'contact', Opportunity: 'deal', Task: 'activity' };
const kindObjects = Object.fromEntries(Object.entries(objectKinds).map(([object, kind]) => [kind, object]));
const apiVersion = process.env.SF_API_VERSION || 'v66.0';

function encryptionKey() {
  const secret = process.env.CRM_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error('Set CRM_TOKEN_ENCRYPTION_KEY to at least 32 characters to securely store Salesforce OAuth tokens.');
  return createHash('sha256').update(secret).digest();
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decrypt(value) {
  const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function salesforceLoginUrl() {
  const url = new URL(process.env.SF_LOGIN_URL || 'https://login.salesforce.com');
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('SF_LOGIN_URL must be an HTTP(S) URL.');
  return url.origin;
}

function requireOAuthSettings() {
  const { SF_CLIENT_ID, SF_CLIENT_SECRET, SF_REDIRECT_URI } = process.env;
  if (!SF_CLIENT_ID || !SF_CLIENT_SECRET || !SF_REDIRECT_URI) {
    throw new Error('Configure SF_CLIENT_ID, SF_CLIENT_SECRET, and SF_REDIRECT_URI before connecting Salesforce.');
  }
  return { clientId: SF_CLIENT_ID, clientSecret: SF_CLIENT_SECRET, redirectUri: SF_REDIRECT_URI };
}

export function createSalesforceAuthorizationUrl(configuration) {
  const { clientId, redirectUri } = requireOAuthSettings();
  const state = randomBytes(32).toString('base64url');
  configuration.salesforce.oauthState = state;
  configuration.salesforce.oauthStateExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const url = new URL('/services/oauth2/authorize', salesforceLoginUrl());
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: 'api refresh_token'
  }).toString();
  return url.toString();
}

async function requestToken(values) {
  const response = await fetch(new URL('/services/oauth2/token', salesforceLoginUrl()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Salesforce OAuth failed: ${result.error_description || result.error || response.statusText}`);
  return result;
}

export async function exchangeSalesforceCode(configuration, code, state) {
  if (!state || state !== configuration.salesforce.oauthState || configuration.salesforce.oauthStateExpiresAt < new Date()) {
    throw new Error('Salesforce authorization state is invalid or expired.');
  }
  const { clientId, clientSecret, redirectUri } = requireOAuthSettings();
  const token = await requestToken({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri
  });
  if (!token.refresh_token || !token.instance_url) throw new Error('Salesforce did not return a refresh token and instance URL.');
  configuration.salesforce.refreshTokenEncrypted = encrypt(token.refresh_token);
  configuration.salesforce.instanceUrl = token.instance_url;
  configuration.salesforce.enabled = true;
  configuration.salesforce.oauthState = '';
  configuration.salesforce.oauthStateExpiresAt = null;
  configuration.salesforce.lastSyncError = '';
  await configuration.save();
}

async function accessToken(configuration) {
  const { clientId, clientSecret } = requireOAuthSettings();
  const refreshToken = decrypt(configuration.salesforce.refreshTokenEncrypted);
  const token = await requestToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  });
  return token.access_token;
}

async function sfRequest(configuration, token, path, options = {}) {
  const url = new URL(path, configuration.salesforce.instanceUrl);
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body) ? body.map(item => item.message).join('; ') : body?.message || response.statusText;
    throw new Error(`Salesforce API ${response.status}: ${message}`);
  }
  return body;
}

function soqlDate(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function* querySalesforce(configuration, token, object, since) {
  const fields = {
    Lead: 'Id, SystemModstamp, LastModifiedDate, LastName, FirstName, Company, Email, Phone, Status, Industry, Website',
    Account: 'Id, SystemModstamp, LastModifiedDate, Name, Phone, Website, Industry',
    Contact: 'Id, SystemModstamp, LastModifiedDate, LastName, FirstName, Email, Phone, Title, AccountId',
    Opportunity: 'Id, SystemModstamp, LastModifiedDate, Name, Amount, StageName, CloseDate, Description',
    Task: 'Id, SystemModstamp, LastModifiedDate, Subject, Status, ActivityDate, Description'
  }[object];
  const query = `SELECT ${fields} FROM ${object} WHERE SystemModstamp >= ${soqlDate(since)} ORDER BY SystemModstamp ASC LIMIT 500`;
  let page = await sfRequest(configuration, token, `/services/data/${apiVersion}/query?q=${encodeURIComponent(query)}`);
  while (true) {
    for (const record of page.records) yield record;
    if (page.done) break;
    if (!page.nextRecordsUrl) throw new Error(`Salesforce ${object} query returned an incomplete page without a continuation URL.`);
    page = await sfRequest(configuration, token, page.nextRecordsUrl);
  }
}

function localStage(object, stage) {
  if (object === 'Opportunity') {
    if (stage === 'Closed Won') return 'WON';
    if (stage === 'Closed Lost') return 'LOST';
    if (stage === 'Negotiation/Review' || stage === 'Proposal/Price Quote') return 'PROPOSAL';
    if (stage === 'Qualification') return 'QUALIFIED';
    return 'NEW';
  }
  if (object === 'Lead') {
    if (stage === 'Qualified') return 'QUALIFIED';
    if (/contacted|working/i.test(stage || '')) return 'QUALIFIED';
    if (/converted/i.test(stage || '')) return 'WON';
    return 'NEW';
  }
  if (object === 'Task') return stage === 'Completed' ? 'DONE' : 'OPEN';
  return /inactive/i.test(stage || '') ? 'INACTIVE' : 'ACTIVE';
}

function toLocal(remote, object) {
  const kind = objectKinds[object];
  if (object === 'Lead') {
    const name = [remote.FirstName, remote.LastName].filter(Boolean).join(' ');
    return { kind, title: name || remote.Company || 'Salesforce lead', status: localStage(object, remote.Status), data: { contactName: name || remote.LastName, company: remote.Company, email: remote.Email, phone: remote.Phone, industry: remote.Industry, website: remote.Website, salesforceId: remote.Id } };
  }
  if (object === 'Account') return { kind, title: remote.Name || 'Salesforce account', status: 'ACTIVE', data: { industry: remote.Industry, website: remote.Website, phone: remote.Phone, salesforceId: remote.Id } };
  if (object === 'Contact') return { kind, title: remote.Name || remote.LastName || 'Salesforce contact', status: 'ACTIVE', data: { contactName: remote.Name || remote.LastName, email: remote.Email, phone: remote.Phone, title: remote.Title, salesforceId: remote.Id } };
  if (object === 'Opportunity') return { kind, title: remote.Name || 'Salesforce opportunity', status: localStage(object, remote.StageName), amount: remote.Amount ?? null, dueDate: remote.CloseDate ? new Date(`${remote.CloseDate}T00:00:00.000Z`) : null, data: { salesforceId: remote.Id, description: remote.Description || '' } };
  return { kind, title: remote.Subject || 'Salesforce task', status: localStage(object, remote.Status), dueDate: remote.ActivityDate ? new Date(`${remote.ActivityDate}T00:00:00.000Z`) : null, data: { salesforceId: remote.Id, description: remote.Description || '' } };
}

function toSalesforce(record) {
  const data = record.data instanceof Map ? Object.fromEntries(record.data) : record.data || {};
  const common = { Description: record.description || data.description || undefined };
  if (record.kind === 'lead') return { object: 'Lead', fields: { LastName: data.contactName || record.title, Company: data.company || record.title, Email: data.email || undefined, Phone: data.phone || undefined, Industry: data.industry || undefined, Status: ({ NEW: 'Open - Not Contacted', QUALIFIED: 'Working - Contacted', WON: 'Qualified', LOST: 'Unqualified' })[record.status] || 'Open - Not Contacted', ...common } };
  if (record.kind === 'client') return { object: 'Account', fields: { Name: record.title, Phone: data.phone || undefined, Website: data.website || undefined, Industry: data.industry || undefined, ...common } };
  if (record.kind === 'contact') return { object: 'Contact', fields: { LastName: data.contactName || record.title, Email: data.email || undefined, Phone: data.phone || undefined, Title: data.title || undefined, ...common } };
  if (record.kind === 'deal') return { object: 'Opportunity', fields: { Name: record.title, StageName: ({ WON: 'Closed Won', LOST: 'Closed Lost', PROPOSAL: 'Proposal/Price Quote', QUALIFIED: 'Qualification' })[record.status] || 'Prospecting', CloseDate: record.dueDate ? new Date(record.dueDate).toISOString().slice(0, 10) : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), Amount: record.amount ?? undefined, ...common } };
  if (record.kind === 'activity') return { object: 'Task', fields: { Subject: record.title, Status: record.status === 'DONE' ? 'Completed' : 'Not Started', ActivityDate: record.dueDate ? new Date(record.dueDate).toISOString().slice(0, 10) : undefined, ...common } };
  return null;
}

async function createOrUpdateRemote(configuration, token, record, link) {
  const mapped = toSalesforce(record);
  if (!mapped) return null;
  const root = `/services/data/${apiVersion}/sobjects/${mapped.object}`;
  if (link) {
    await sfRequest(configuration, token, `${root}/${link.salesforceId}`, { method: 'PATCH', body: JSON.stringify(mapped.fields) });
    link.lastSyncedAt = new Date();
    await link.save();
    return link;
  }
  const created = await sfRequest(configuration, token, root, { method: 'POST', body: JSON.stringify(mapped.fields) });
  if (!created?.id) throw new Error(`Salesforce did not return an ID for ${record.kind} ${record.id}.`);
  return CrmSyncLink.create({ record: record._id, salesforceId: created.id, salesforceType: mapped.object, lastSyncedAt: new Date() });
}

async function saveIncoming(configuration, remote, object, link) {
  const input = toLocal(remote, object);
  const record = link ? await WorkspaceRecord.findById(link.record) : null;
  if (record) {
    const localData = record.data instanceof Map ? Object.fromEntries(record.data) : record.data || {};
    Object.assign(record, { ...input, data: { ...localData, ...input.data } });
    await record.save();
    link.lastSyncedAt = new Date();
    await link.save();
    return record;
  }
  const owner = await User.findOne({ role: 'SUPER_ADMIN', active: true }).select('_id');
  if (!owner) throw new Error('Cannot import Salesforce records until an active Super Admin exists.');
  const created = await WorkspaceRecord.create({ module: 'crm', ...input, createdBy: owner._id });
  await CrmSyncLink.create({ record: created._id, salesforceId: remote.Id, salesforceType: object, lastSyncedAt: new Date() });
  return created;
}

export async function syncCrmWithSalesforce() {
  const configuration = await CrmConfiguration.findOne({ key: 'organization' });
  if (!configuration?.salesforce?.enabled || !configuration.salesforce.refreshTokenEncrypted) return;
  try {
    const token = await accessToken(configuration);
    const since = configuration.salesforce.lastSyncAt || new Date(Date.now() - 365 * 86400000);
    for (const object of Object.keys(objectKinds)) {
      for await (const remote of querySalesforce(configuration, token, object, since)) {
        const link = await CrmSyncLink.findOne({ salesforceId: remote.Id });
        if (!link) {
          await saveIncoming(configuration, remote, object, null);
          continue;
        }
        const local = await WorkspaceRecord.findById(link.record);
        if (!local || local.archivedAt) continue;
        const remoteChanged = new Date(remote.SystemModstamp) > link.lastSyncedAt;
        const localChanged = local.updatedAt > link.lastSyncedAt;
        if (remoteChanged && localChanged) {
          const openConflict = await CrmSyncConflict.exists({ record: local._id, status: 'OPEN' });
          if (!openConflict) await CrmSyncConflict.create({
            record: local._id,
            salesforceId: remote.Id,
            salesforceType: object,
            localSnapshot: local.toObject(),
            salesforceSnapshot: remote
          });
        } else if (remoteChanged) {
          await saveIncoming(configuration, remote, object, link);
        }
      }
    }

    const localRecords = await WorkspaceRecord.find({ module: 'crm', archivedAt: null, updatedAt: { $gte: since }, kind: { $in: Object.keys(kindObjects) } }).limit(2000);
    for (const record of localRecords) {
      const link = await CrmSyncLink.findOne({ record: record._id });
      if (link) {
        const conflict = await CrmSyncConflict.exists({ record: record._id, status: 'OPEN' });
        if (conflict) continue;
        if (record.updatedAt <= link.lastSyncedAt) continue;
      }
      await createOrUpdateRemote(configuration, token, record, link);
    }
    configuration.salesforce.lastSyncAt = new Date();
    configuration.salesforce.lastSyncError = '';
    await configuration.save();
  } catch (error) {
    configuration.salesforce.lastSyncError = error.message.slice(0, 1000);
    await configuration.save();
    throw error;
  }
}

export async function resolveCrmSalesforceConflict(conflict, resolution) {
  const configuration = await CrmConfiguration.findOne({ key: 'organization' });
  const link = await CrmSyncLink.findOne({ record: conflict.record });
  const record = await WorkspaceRecord.findById(conflict.record);
  if (!configuration || !link || !record) throw new Error('The linked CRM record or Salesforce connection no longer exists.');
  if (resolution === 'SALESFORCE') await saveIncoming(configuration, conflict.salesforceSnapshot, conflict.salesforceType, link);
  else {
    const token = await accessToken(configuration);
    await createOrUpdateRemote(configuration, token, record, link);
  }
  conflict.status = resolution;
  conflict.resolvedAt = new Date();
  await conflict.save();
  await audit({ user: { _id: conflict.resolvedBy } }, 'CRM_SALESFORCE_CONFLICT_RESOLVED', 'CrmSyncConflict', conflict.id, { resolution });
}
