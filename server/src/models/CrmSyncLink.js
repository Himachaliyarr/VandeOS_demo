import mongoose from 'mongoose';
import { tenantModel } from '../services/tenantContext.js';

const crmSyncLinkSchema = new mongoose.Schema({
  record: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkspaceRecord', required: true, unique: true },
  salesforceId: { type: String, required: true, unique: true },
  salesforceType: { type: String, required: true },
  lastSyncedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

export default tenantModel('CrmSyncLink', crmSyncLinkSchema);
