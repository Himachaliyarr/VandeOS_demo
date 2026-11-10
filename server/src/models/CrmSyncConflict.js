import mongoose from 'mongoose';
import { tenantModel } from '../services/tenantContext.js';

const crmSyncConflictSchema = new mongoose.Schema({
  record: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkspaceRecord', required: true, index: true },
  salesforceId: { type: String, required: true },
  salesforceType: { type: String, required: true },
  localSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  salesforceSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['OPEN', 'LOCAL', 'SALESFORCE'], default: 'OPEN' },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true });

crmSyncConflictSchema.index({ record: 1, status: 1 });
export default tenantModel('CrmSyncConflict', crmSyncConflictSchema);
