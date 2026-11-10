import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { runWithTenant, tenantModel } from '../src/services/tenantContext.js';

test('model operations resolve against the active organization connection', async () => {
  const model = tenantModel('TenantContextProbe', new mongoose.Schema({ value: String }));
  const firstTenant = mongoose.createConnection();
  const secondTenant = mongoose.createConnection();

  await Promise.all([
    runWithTenant(firstTenant, async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(model.db, firstTenant);
    }),
    runWithTenant(secondTenant, async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      assert.equal(model.db, secondTenant);
    })
  ]);
});
