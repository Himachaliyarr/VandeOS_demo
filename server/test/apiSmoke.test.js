import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import AuditLog from '../src/models/AuditLog.js';
import WorkspaceRecord from '../src/models/WorkspaceRecord.js';
import CrmConfiguration from '../src/models/CrmConfiguration.js';
import TenantRegistry from '../src/models/TenantRegistry.js';

let server;
let baseUrl;
const originalTenantFindOne = TenantRegistry.findOne;
const testTenant = { slug: 'vande-digital', name: 'Vande Digital', dbName: 'test', status: 'ACTIVE' };

before(async () => {
  TenantRegistry.findOne = async () => testTenant;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  TenantRegistry.findOne = originalTenantFindOne;
});

test('health endpoint returns API status', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
});

if (process.env.NODE_ENV !== 'production') {
  test('root endpoint lists available API routes', async () => {
    const response = await fetch(baseUrl);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.service, 'vande-os-api');
    assert.ok(body.endpoints.includes('GET /api/health'));
    assert.ok(body.endpoints.includes('POST /api/workspace/:module'));
  });
}

if (process.env.NODE_ENV === 'production') {
  test('production server serves the built app and SPA routes', async () => {
    const root = await fetch(baseUrl, { headers: { Accept: 'text/html' } });
    const route = await fetch(`${baseUrl}/portal/client`, { headers: { Accept: 'text/html' } });
    const apiRoute = await fetch(`${baseUrl}/api/unknown`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type'), /text\/html/);
    assert.equal(route.status, 200);
    assert.equal(apiRoute.status, 404);
  });
}

test('employee endpoints reject requests without a session', async () => {
  const response = await fetch(`${baseUrl}/api/employees`);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.match(body.message, /sign in/i);
});

test('workspace modules reject requests without a session', async () => {
  const response = await fetch(`${baseUrl}/api/workspace/finance`);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.match(body.message, /sign in/i);
});

test('CRM CSV import and export require a session', async () => {
  const exportResponse = await fetch(`${baseUrl}/api/workspace/crm/export.csv`);
  const importResponse = await fetch(`${baseUrl}/api/workspace/crm/import.csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: 'kind,title\nlead,Example'
  });
  assert.equal(exportResponse.status, 401);
  assert.equal(importResponse.status, 401);
});

test('CRM timeline and sales reports are authenticated, scoped, and return usable data', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  const originalFind = User.find;
  const originalConfigurationFindOne = CrmConfiguration.findOne;
  const originalRecordFindOne = WorkspaceRecord.findOne;
  const originalRecordFind = WorkspaceRecord.find;
  const originalRecordCreate = WorkspaceRecord.create;
  const originalRecordAggregate = WorkspaceRecord.aggregate;
  const originalCountDocuments = WorkspaceRecord.countDocuments;
  const originalAuditCreate = AuditLog.create;
  let parentFilter;
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
  const owner = { _id: 'owner-1', role: 'SUPER_ADMIN', active: true, name: 'Workspace Owner' };
  const activity = {
    _id: 'activity-1',
    id: 'activity-1',
    title: 'Discovery call',
    description: 'Discussed customer requirements.',
    status: 'DONE',
    data: { interactionType: 'CALL', occurredAt: '2025-01-01T10:00:00.000Z' },
    createdBy: { name: owner.name },
    createdAt: '2025-01-01T10:00:00.000Z'
  };
  User.findById = () => ({ populate: async () => owner });
  User.find = () => ({
    select: projection => projection === 'name'
      ? { lean: async () => [{ _id: 'owner-1', name: owner.name }] }
      : Promise.resolve([])
  });
  CrmConfiguration.findOne = async () => new CrmConfiguration({ key: 'organization' });
  WorkspaceRecord.findOne = filter => {
    parentFilter = filter;
    assert.equal(filter.module, 'crm');
    assert.equal(filter._id, 'lead-1');
    return { select: async () => ({ _id: 'lead-1', title: 'Example lead' }) };
  };
  WorkspaceRecord.create = async record => {
    assert.equal(record.module, 'crm');
    assert.equal(record.kind, 'activity');
    assert.equal(String(record.parent), 'lead-1');
    assert.equal(record.data.interactionType, 'CALL');
    return activity;
  };
  WorkspaceRecord.find = filter => {
    assert.equal(filter.module, 'crm');
    assert.equal(filter.kind, 'activity');
    assert.equal(String(filter.parent), 'lead-1');
    return {
      populate() { return this; },
      sort() { return this; },
      limit() { return this; },
      lean: async () => [activity]
    };
  };
  WorkspaceRecord.aggregate = async pipeline => {
    assert.equal(pipeline[0].$match.module, 'crm');
    assert.equal(pipeline[0].$match.archivedAt, null);
    const group = pipeline.find(stage => stage.$group)?.$group;
    if (group?._id === null) {
      assert.ok(group.openDeals.$sum.$cond[0].$and[1].$not);
      assert.equal(Object.hasOwn(group.openDeals.$sum.$cond[0].$and[1], '$nin'), false);
    }
    if (group?._id?.kind) return [{ _id: { kind: 'deal', status: 'WON' }, count: 1, amount: 15000 }];
    if (group?._id === '$data.source') return [{ _id: 'Referral', count: 1 }];
    if (group?._id === '$assignedTo') return [{ _id: 'owner-1', count: 1, wonDeals: 1, wonRevenue: 15000 }];
    return [{ leads: 4, qualifiedLeads: 2, deals: 2, wonDeals: 1, openDeals: 1, wonRevenue: 15000 }];
  };
  WorkspaceRecord.countDocuments = async filter => {
    assert.equal(filter.kind, 'activity');
    assert.equal(filter['data.interactionType'], 'TASK');
    return 2;
  };
  AuditLog.create = async () => ({});
  const token = jwt.sign({ sub: owner._id }, process.env.JWT_SECRET, { expiresIn: '1m' });
  const headers = { Cookie: `vande_session=${token}` };
  try {
    const createResponse = await fetch(`${baseUrl}/api/workspace/crm/lead-1/timeline`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'CALL', title: 'Discovery call', description: 'Discussed customer requirements.' })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);
    assert.equal(created.data.activity.data.interactionType, 'CALL');

    const timelineResponse = await fetch(`${baseUrl}/api/workspace/crm/lead-1/timeline`, { headers });
    const timeline = await timelineResponse.json();
    assert.equal(timelineResponse.status, 200);
    assert.equal(timeline.data.timeline[0].title, 'Discovery call');

    const reportResponse = await fetch(`${baseUrl}/api/workspace/crm/reports`, { headers });
    const report = await reportResponse.json();
    assert.equal(reportResponse.status, 200);
    assert.equal(report.data.summary.wonRevenue, 15000);
    assert.equal(report.data.summary.overdue, 2);
    assert.equal(report.data.summary.conversionRate, 50);
    assert.equal(report.data.leadSources[0]._id, 'Referral');

    const employee = { _id: 'employee-1', role: 'EMPLOYEE', active: true, name: 'Team Member', workspacePermissions: ['crm'] };
    User.findById = () => ({ populate: async () => employee });
    CrmConfiguration.findOne = async () => new CrmConfiguration({
      key: 'organization',
      permissions: { EMPLOYEE: { view: true, edit: false, export: false, assign: false } }
    });
    const employeeToken = jwt.sign({ sub: employee._id }, process.env.JWT_SECRET, { expiresIn: '1m' });
    const deniedResponse = await fetch(`${baseUrl}/api/workspace/crm/lead-1/timeline`, {
      method: 'POST',
      headers: { Cookie: `vande_session=${employeeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'NOTE', title: 'Private note' })
    });
    assert.equal(deniedResponse.status, 403);

    CrmConfiguration.findOne = async () => new CrmConfiguration({
      key: 'organization',
      permissions: { EMPLOYEE: { view: true, edit: true, export: false, assign: false } }
    });
    const scopedResponse = await fetch(`${baseUrl}/api/workspace/crm/lead-1/timeline`, {
      headers: { Cookie: `vande_session=${employeeToken}` }
    });
    assert.equal(scopedResponse.status, 200);
    assert.equal(String(parentFilter.assignedTo), employee._id);
  } finally {
    User.findById = originalFindById;
    User.find = originalFind;
    CrmConfiguration.findOne = originalConfigurationFindOne;
    WorkspaceRecord.findOne = originalRecordFindOne;
    WorkspaceRecord.find = originalRecordFind;
    WorkspaceRecord.create = originalRecordCreate;
    WorkspaceRecord.aggregate = originalRecordAggregate;
    WorkspaceRecord.countDocuments = originalCountDocuments;
    AuditLog.create = originalAuditCreate;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('workspace reports reject requests without a session', async () => {
  const response = await fetch(`${baseUrl}/api/workspace/reports/overview`);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.success, false);
});

test('CRM CSV import creates validated records and export returns CSV', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  const originalInsertMany = WorkspaceRecord.insertMany;
  const originalFind = WorkspaceRecord.find;
  const originalAuditCreate = AuditLog.create;
  const originalConfigurationFindOne = CrmConfiguration.findOne;
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
  User.findById = () => ({ populate: async () => ({ _id: 'owner-1', role: 'SUPER_ADMIN', active: true }) });
  CrmConfiguration.findOne = async () => new CrmConfiguration({ key: 'organization' });
  WorkspaceRecord.insertMany = async records => records;
  WorkspaceRecord.find = filter => {
    assert.equal(filter.module, 'crm');
    return { sort() { return this; }, lean: async () => [] };
  };
  AuditLog.create = async () => ({});
  const token = jwt.sign({ sub: 'owner-1' }, process.env.JWT_SECRET, { expiresIn: '1m' });
  try {
    const importResponse = await fetch(`${baseUrl}/api/workspace/crm/import.csv`, {
      method: 'POST',
      headers: { Cookie: `vande_session=${token}`, 'Content-Type': 'text/csv' },
      body: 'kind,title,data.company\nlead,"Example, Inc.",Acme'
    });
    const importBody = await importResponse.json();
    assert.equal(importResponse.status, 201);
    assert.equal(importBody.data.imported, 1);

    const exportResponse = await fetch(`${baseUrl}/api/workspace/crm/export.csv`, {
      headers: { Cookie: `vande_session=${token}` }
    });
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-type'), /text\/csv/);
    assert.match(await exportResponse.text(), /kind.*title/);
  } finally {
    User.findById = originalFindById;
    WorkspaceRecord.insertMany = originalInsertMany;
    WorkspaceRecord.find = originalFind;
    AuditLog.create = originalAuditCreate;
    CrmConfiguration.findOne = originalConfigurationFindOne;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('employee accounts can sign in and receive a session', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindOne = User.findOne;
  const originalFindById = User.findById;
  const originalAuditCreate = AuditLog.create;
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
  const employee = {
    _id: 'employee-1',
    id: 'employee-1',
    name: 'Team Member',
    email: 'member@example.com',
    role: 'EMPLOYEE',
    active: true,
    lastLoginAt: null,
    verifyPassword: async password => password === 'temporary-password',
    save: async () => {}
  };
  User.findOne = () => ({ select: async () => employee });
  User.findById = () => ({ populate: async () => ({ toSafeJSON: () => ({ id: employee.id, name: employee.name, email: employee.email, role: employee.role }) }) });
  AuditLog.create = async () => ({});
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationSlug: 'vande-digital', email: employee.email, password: 'temporary-password' })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.user.role, 'EMPLOYEE');
    assert.deepEqual(body.data.organization, { name: 'Vande Digital', slug: 'vande-digital' });
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal(jwt.decode(cookie.slice('vande_session='.length)).tenantSlug, 'vande-digital');
    assert.match(response.headers.get('set-cookie') || '', /vande_session=/);
  } finally {
    User.findOne = originalFindOne;
    User.findById = originalFindById;
    AuditLog.create = originalAuditCreate;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('failed sign-in attempts are recorded in the organization audit log', async () => {
  const originalFindOne = User.findOne;
  const originalAuditCreate = AuditLog.create;
  const testUser = {
    id: 'employee-1',
    active: true,
    verifyPassword: async () => false
  };
  let auditEntry;
  User.findOne = () => ({ select: async () => testUser });
  AuditLog.create = async entry => {
    auditEntry = entry;
    return {};
  };
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationSlug: 'vande-digital', email: 'member@example.com', password: 'wrong-password' })
    });
    assert.equal(response.status, 401);
    assert.equal(auditEntry.action, 'AUTH_LOGIN_FAILED');
    assert.equal(auditEntry.entity, 'User');
    assert.equal(auditEntry.entityId, 'employee-1');
    assert.equal(auditEntry.actor, null);
    assert.deepEqual(auditEntry.details, { reason: 'INVALID_PASSWORD' });
  } finally {
    User.findOne = originalFindOne;
    AuditLog.create = originalAuditCreate;
  }
});

test('login rejects organizations without an active tenant record', async () => {
  const activeFindOne = TenantRegistry.findOne;
  TenantRegistry.findOne = async () => null;
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationSlug: 'unknown-tenant', email: 'member@example.com', password: 'password' })
    });
    assert.equal(response.status, 401);
  } finally {
    TenantRegistry.findOne = activeFindOne;
  }
});

test('client sessions cannot access internal people, attendance, or automation APIs', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
  User.findById = () => ({ populate: async () => ({ _id: 'client-1', role: 'CLIENT', active: true, portalRecord: 'record-1' }) });
  const token = jwt.sign({ sub: 'client-1' }, process.env.JWT_SECRET, { expiresIn: '1m' });
  try {
    for (const path of ['/api/employees', '/api/attendance/me', '/api/workspace/automations']) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: `vande_session=${token}` } });
      assert.equal(response.status, 403, `${path} should reject a client account`);
    }
  } finally {
    User.findById = originalFindById;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('client sessions cannot record invoice payments', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
  User.findById = () => ({ populate: async () => ({ _id: 'client-1', role: 'CLIENT', active: true, portalRecord: 'record-1' }) });
  const token = jwt.sign({ sub: 'client-1' }, process.env.JWT_SECRET, { expiresIn: '1m' });
  try {
    const response = await fetch(`${baseUrl}/api/workspace/finance/invoice-1/payments`, {
      method: 'POST',
      headers: { Cookie: `vande_session=${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10, currency: 'INR' })
    });
    assert.equal(response.status, 403);
  } finally {
    User.findById = originalFindById;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('employee and HR sessions cannot open unassigned work areas', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
  const users = {
    'employee-1': { _id: 'employee-1', role: 'EMPLOYEE', active: true, workspacePermissions: ['projects', 'support'] },
    'hr-1': { _id: 'hr-1', role: 'HR', active: true, workspacePermissions: ['projects'] }
  };
  User.findById = id => ({ populate: async () => users[String(id)] });
  try {
    for (const [userId, path] of [['employee-1', '/api/workspace/crm'], ['hr-1', '/api/workspace/crm']]) {
      const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1m' });
      const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: `vande_session=${token}` } });
      assert.equal(response.status, 403, `${userId} should not access ${path}`);
    }
  } finally {
    User.findById = originalFindById;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('workspace GET detail returns only an accessible active record', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  const originalFindOne = WorkspaceRecord.findOne;
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
  const record = { _id: 'project-1', module: 'projects', title: 'Project one' };
  User.findById = () => ({ populate: async () => ({
    _id: 'employee-1',
    role: 'EMPLOYEE',
    active: true,
    workspacePermissions: ['projects']
  }) });
  WorkspaceRecord.findOne = filter => {
    assert.equal(filter.module, 'projects');
    assert.equal(filter._id, 'project-1');
    assert.equal(filter.archivedAt, null);
    assert.ok(filter.$or.some(scope => scope.assignedTo === 'employee-1'));
    return {
      populate() { return this; },
      lean: async () => record
    };
  };
  const token = jwt.sign({ sub: 'employee-1' }, process.env.JWT_SECRET, { expiresIn: '1m' });
  try {
    const response = await fetch(`${baseUrl}/api/workspace/projects/project-1`, {
      headers: { Cookie: `vande_session=${token}` }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.data.record, record);
  } finally {
    User.findById = originalFindById;
    WorkspaceRecord.findOne = originalFindOne;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('unknown API paths return a structured not found response', async () => {
  const response = await fetch(`${baseUrl}/api/not-a-real-endpoint`);
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.success, false);
});
