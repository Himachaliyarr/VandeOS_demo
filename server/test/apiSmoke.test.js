import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import AuditLog from '../src/models/AuditLog.js';
import WorkspaceRecord from '../src/models/WorkspaceRecord.js';

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
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

test('workspace reports reject requests without a session', async () => {
  const response = await fetch(`${baseUrl}/api/workspace/reports/overview`);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.success, false);
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
      body: JSON.stringify({ email: employee.email, password: 'temporary-password' })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.user.role, 'EMPLOYEE');
    assert.match(response.headers.get('set-cookie') || '', /vande_session=/);
  } finally {
    User.findOne = originalFindOne;
    User.findById = originalFindById;
    AuditLog.create = originalAuditCreate;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
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
