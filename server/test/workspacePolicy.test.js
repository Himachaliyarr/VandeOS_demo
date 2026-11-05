import test from 'node:test';
import assert from 'node:assert/strict';
import { canWriteWorkspaceRecord, workspaceModules, workspaceRecordScope } from '../src/routes/workspace.js';
import User from '../src/models/User.js';
import WorkspaceRecord from '../src/models/WorkspaceRecord.js';
import { invoiceBalance, stockAfterMovement, stockStatus } from '../src/services/workspacePolicy.js';
import { legacyStockValues } from '../src/services/workspaceMigration.js';
import { canWriteWorkspaceModule, hasWorkspaceModuleAccess, reportAccess } from '../src/services/workspaceAccess.js';

test('workspace module policies expose the planned record types', () => {
  assert.deepEqual(workspaceModules.crm.kinds, ['lead', 'client', 'contact', 'deal', 'activity']);
  assert.ok(workspaceModules.academy.kinds.includes('assignment'));
  assert.ok(workspaceModules.finance.roles.includes('SUPER_ADMIN'));
  assert.ok(!workspaceModules.finance.roles.includes('HR'));
});

test('employee workspace scope limits projects and support to owned or assigned records', () => {
  const req = { user: { role: 'EMPLOYEE', _id: 'staff-1' } };
  assert.deepEqual(workspaceRecordScope(req, 'projects'), { $or: [{ assignedTo: 'staff-1' }, { createdBy: 'staff-1' }] });
  assert.deepEqual(workspaceRecordScope(req, 'support'), { $or: [{ assignedTo: 'staff-1' }, { createdBy: 'staff-1' }] });
});

test('employee and HR work-area permissions are enforced independently of job titles', () => {
  const crm = { roles: ['SUPER_ADMIN', 'HR'] };
  const projects = { roles: ['SUPER_ADMIN', 'HR', 'EMPLOYEE'] };
  const finance = { roles: ['SUPER_ADMIN'] };
  const employee = { role: 'EMPLOYEE', workspacePermissions: ['crm', 'projects'] };
  const hr = { role: 'HR', workspacePermissions: ['projects', 'reports'] };

  assert.equal(hasWorkspaceModuleAccess(employee, 'crm', crm), true);
  assert.equal(canWriteWorkspaceModule(employee, 'crm', crm), true);
  assert.equal(hasWorkspaceModuleAccess({ role: 'EMPLOYEE' }, 'projects', projects), true);
  assert.equal(hasWorkspaceModuleAccess({ role: 'EMPLOYEE' }, 'crm', crm), false);
  assert.equal(hasWorkspaceModuleAccess(employee, 'inventory', { roles: ['SUPER_ADMIN', 'HR'] }), false);
  assert.equal(hasWorkspaceModuleAccess({ ...employee, workspacePermissions: ['finance'] }, 'finance', finance), false);
  assert.equal(hasWorkspaceModuleAccess(hr, 'projects', projects), true);
  assert.equal(hasWorkspaceModuleAccess(hr, 'crm', crm), false);
  assert.equal(hasWorkspaceModuleAccess({ role: 'HR' }, 'crm', crm), true);
  assert.equal(hasWorkspaceModuleAccess({ role: 'SUPER_ADMIN' }, 'reports', reportAccess), true);
  assert.equal(hasWorkspaceModuleAccess({ role: 'HR', workspacePermissions: [] }, 'reports', reportAccess), false);
  assert.equal(hasWorkspaceModuleAccess(hr, 'reports', reportAccess), true);
  assert.equal(canWriteWorkspaceModule(hr, 'reports', { roles: ['SUPER_ADMIN', 'HR'] }), true);
  assert.equal(hasWorkspaceModuleAccess({ role: 'SUPER_ADMIN' }, 'finance', finance), true);
});

test('client and student portal scopes are tied to their linked records', () => {
  assert.deepEqual(workspaceRecordScope({ user: { role: 'CLIENT', portalRecord: 'client-1' } }, 'crm'), { _id: 'client-1', kind: 'client' });
  assert.deepEqual(workspaceRecordScope({ user: { role: 'CLIENT', portalRecord: 'client-1' } }, 'finance'), { client: 'client-1' });
  assert.deepEqual(workspaceRecordScope({ user: { role: 'STUDENT', portalRecord: 'student-1' } }, 'academy'), { $or: [{ _id: 'student-1' }, { parent: 'student-1' }, { student: 'student-1' }] });
  assert.deepEqual(workspaceRecordScope({ user: { role: 'CLIENT', portalRecord: null } }, 'crm'), { _id: null });
});

test('portal accounts can read scoped work but cannot edit workspace records', () => {
  assert.equal(canWriteWorkspaceRecord({ user: { role: 'CLIENT' } }, 'support'), false);
  assert.equal(canWriteWorkspaceRecord({ user: { role: 'STUDENT' } }, 'academy'), false);
  assert.equal(canWriteWorkspaceRecord({ user: { role: 'EMPLOYEE' } }, 'projects'), true);
});

test('portal and workspace records pass their Mongoose schema constraints', async () => {
  const client = new User({ name: 'Client User', email: 'client@example.com', passwordHash: 'temporary-password', role: 'CLIENT' });
  const student = new User({ name: 'Student User', email: 'student@example.com', passwordHash: 'temporary-password', role: 'STUDENT' });
  const record = new WorkspaceRecord({ module: 'crm', kind: 'client', title: 'Example Client', status: 'ACTIVE', createdBy: '507f1f77bcf86cd799439011' });
  await client.validate();
  await student.validate();
  await record.validate();
});

test('invoice payment and inventory movement history have typed entries', async () => {
  const creator = '507f1f77bcf86cd799439011';
  const invoice = new WorkspaceRecord({
    module: 'finance',
    kind: 'invoice',
    title: 'Invoice 001',
    status: 'SENT',
    amount: 100,
    paidAmount: 25,
    createdBy: creator,
    paymentEntries: [{ id: 'payment-1', amount: 25, currency: 'INR', recordedBy: creator }]
  });
  const item = new WorkspaceRecord({
    module: 'inventory',
    kind: 'item',
    title: 'Office paper',
    status: 'IN_STOCK',
    stockQuantity: 4,
    createdBy: creator,
    stockMovements: [{ id: 'movement-1', direction: 'IN', quantity: 4, recordedBy: creator }]
  });
  await invoice.validate();
  await item.validate();
  assert.equal(invoice.paymentEntries[0].amount, 25);
  assert.equal(item.stockMovements[0].direction, 'IN');

  invoice.paymentEntries[0].amount = -1;
  item.stockMovements[0].direction = 'SIDEWAYS';
  await assert.rejects(invoice.validate(), /paymentEntries.*amount/i);
  await assert.rejects(item.validate(), /stockMovements.*direction/i);
});

test('invoice payment math returns only the amount still due', () => {
  assert.equal(invoiceBalance(1250, 250), 1000);
  assert.equal(invoiceBalance(0, 0), 0);
  assert.throws(() => invoiceBalance(100, 101), /cannot exceed/i);
});

test('inventory movements enforce non-negative stock and low-stock thresholds', () => {
  assert.equal(stockAfterMovement(8, 'IN', 2), 10);
  assert.equal(stockAfterMovement(8, 'OUT', 3), 5);
  assert.equal(stockStatus(0, 2), 'OUT_OF_STOCK');
  assert.equal(stockStatus(2, 2), 'LOW_STOCK');
  assert.equal(stockStatus(3, 2), 'IN_STOCK');
  assert.throws(() => stockAfterMovement(2, 'OUT', 3), /below zero/i);
});

test('legacy inventory fields migrate to typed stock values safely', () => {
  assert.deepEqual(legacyStockValues({ quantity: '12', reorderLevel: '3' }), { stockQuantity: 12, minStockLevel: 3, status: 'IN_STOCK' });
  assert.deepEqual(legacyStockValues({ quantity: '1', reorderLevel: '3' }), { stockQuantity: 1, minStockLevel: 3, status: 'LOW_STOCK' });
  assert.deepEqual(legacyStockValues({ quantity: 'invalid' }), { stockQuantity: 0, minStockLevel: 0, status: 'OUT_OF_STOCK' });
});
