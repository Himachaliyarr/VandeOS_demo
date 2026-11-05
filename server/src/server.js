import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
import { connectDatabase } from './config/db.js';
import { ensureFoundation } from './services/organization.js';
import User from './models/User.js';
import WorkspaceRecord from './models/WorkspaceRecord.js';
import { migrateLegacyInventory } from './services/workspaceMigration.js';
import { audit } from './services/audit.js';

const port = Number(process.env.PORT || 5000);

async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET to a random value of at least 32 characters.');
  await connectDatabase();
  await WorkspaceRecord.createIndexes();
  const migratedInventoryItems = await migrateLegacyInventory();
  if (migratedInventoryItems) console.log(`Migrated stock quantities for ${migratedInventoryItems} inventory item(s).`);
  await ensureFoundation();
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
    console.log(`Initial Super Admin provisioned: ${owner.email}. Change the password after first sign-in.`);
  }
  const { default: app } = await import('./app.js');
  app.listen(port, () => console.log(`Vande OS API listening on http://localhost:${port}`));
}

start().catch(error => {
  console.error('Startup failed:', error.message);
  process.exit(1);
});
