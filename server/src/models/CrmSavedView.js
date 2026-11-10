import mongoose from 'mongoose';
import { tenantModel } from '../services/tenantContext.js';

const crmSavedViewSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  shared: { type: Boolean, default: false },
  layout: { type: String, enum: ['TABLE', 'KANBAN', 'CALENDAR'], default: 'TABLE' },
  filters: {
    kind: { type: String, default: '' },
    status: { type: String, default: '' },
    assignedTo: { type: String, default: '' },
    search: { type: String, default: '' },
    overdue: { type: Boolean, default: false }
  }
}, { timestamps: true });

crmSavedViewSchema.index({ shared: 1, updatedAt: -1 });
export default tenantModel('CrmSavedView', crmSavedViewSchema);
