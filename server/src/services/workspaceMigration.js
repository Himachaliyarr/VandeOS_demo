import WorkspaceRecord from '../models/WorkspaceRecord.js';
import { stockStatus } from './workspacePolicy.js';

export function legacyStockValues(data = {}) {
  const quantity = Number(data.quantity);
  const minimum = Number(data.reorderLevel);
  const stockQuantity = Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
  const minStockLevel = Number.isFinite(minimum) && minimum >= 0 ? minimum : 0;
  return { stockQuantity, minStockLevel, status: stockStatus(stockQuantity, minStockLevel) };
}

export async function migrateLegacyInventory() {
  const legacyItems = await WorkspaceRecord.find({
    module: 'inventory',
    kind: 'item',
    $or: [{ stockQuantity: null }, { stockQuantity: { $exists: false } }]
  }).select('data').lean();
  if (!legacyItems.length) return 0;
  const operations = legacyItems.map(item => ({
    updateOne: {
      filter: { _id: item._id, module: 'inventory', kind: 'item' },
      update: { $set: legacyStockValues(item.data) }
    }
  }));
  await WorkspaceRecord.bulkWrite(operations);
  return operations.length;
}
