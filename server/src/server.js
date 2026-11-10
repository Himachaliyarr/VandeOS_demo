import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
import { connectDatabase } from './config/db.js';
import { ensureFoundation } from './services/organization.js';
import User from './models/User.js';
import TenantRegistry from './models/TenantRegistry.js';
import { connectionForTenant, runWithTenant } from './services/tenantContext.js';
import { ensureTenantIndexes } from './services/tenantIndexes.js';
import { migrateLegacyInventory } from './services/workspaceMigration.js';
import { audit } from './services/audit.js';
import { runCrmFollowUpAutomations } from './services/crmAutomation.js';
import { syncCrmWithSalesforce } from './services/crmSalesforce.js';

const port = Number(process.env.PORT || 5000);

async function runForActiveTenants(label, task) {
  const tenants = await TenantRegistry.find({ status: 'ACTIVE' }).lean();
  for (const tenant of tenants) {
    try {
      await runWithTenant(connectionForTenant(tenant), task);
    } catch (error) {
      console.error(`${label} failed for organization ${tenant.slug}:`, error.message);
    }
  }
}

async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET to a random value of at least 32 characters.');
  await connectDatabase();
  await TenantRegistry.createIndexes();
  let initialTenant = await TenantRegistry.findOne({ slug: 'vande-digital' });
  if (!initialTenant) {
    const existingOwner = await runWithTenant(mongoose.connection, () => User.findOne({ role: 'SUPER_ADMIN' }).select('email').lean());
    initialTenant = await TenantRegistry.create({
      name: 'Vande Digital',
      slug: 'vande-digital',
      dbName: mongoose.connection.name,
      status: 'ACTIVE',
      ownerEmail: existingOwner?.email || process.env.OWNER_EMAIL?.toLowerCase() || 'owner@vande-digital.invalid',
      joiningFeePaise: 50000
    });
  }
  await runWithTenant(connectionForTenant(initialTenant), async () => {
    await ensureTenantIndexes();
    const migratedInventoryItems = await migrateLegacyInventory();
    if (migratedInventoryItems) console.log(`Migrated stock quantities for ${migratedInventoryItems} inventory item(s).`);
    await ensureFoundation({ name: initialTenant.name });
    const accountCount = await User.countDocuments();
    if (!accountCount && process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD) {
      if (process.env.OWNER_PASSWORD.length < 12) throw new Error('OWNER_PASSWORD must be at least 12 characters.');
      const owner = await User.create({
        name: process.env.OWNER_NAME || 'Vande OS Owner',
        email: process.env.OWNER_EMAIL.toLowerCase(),
        passwordHash: process.env.OWNER_PASSWORD,
        role: 'SUPER_ADMIN',
        mustChangePassword: true
      });
      await audit({ user: owner }, 'OWNER_BOOTSTRAPPED', 'User', owner.id, {});
      initialTenant.ownerEmail = owner.email;
      await initialTenant.save();
      console.log(`Initial Super Admin provisioned: ${owner.email}. Change the password after first sign-in.`);
    }
  });
  const { default: app } = await import('./app.js');
  const server = app.listen(port, () => {
    console.log(`Vande OS API listening on http://localhost:${port}`);
    const runAutomations = () => runForActiveTenants('CRM follow-up automation', runCrmFollowUpAutomations);
    runAutomations();
    const automationTimer = setInterval(runAutomations, 5 * 60 * 1000);
    automationTimer.unref();
    const runSalesforceSync = () => runForActiveTenants('Salesforce CRM sync', syncCrmWithSalesforce);
    runSalesforceSync();
    const salesforceTimer = setInterval(runSalesforceSync, 5 * 60 * 1000);
    salesforceTimer.unref();
  });
}

start().catch(error => {
  console.error('Startup failed:', error.message);
  process.exit(1);
});
