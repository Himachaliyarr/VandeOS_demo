import mongoose from 'mongoose';
import { tenantModel } from '../services/tenantContext.js';

const crmAutomationRunSchema = new mongoose.Schema({
  record: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkspaceRecord', required: true },
  automation: { type: String, required: true },
  runKey: { type: String, required: true, unique: true },
  ranAt: { type: Date, default: Date.now }
});

export default tenantModel('CrmAutomationRun', crmAutomationRunSchema);
