import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, required: true, index: true },
  entity: { type: String, required: true },
  entityId: { type: String, default: '' },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String, default: '' }
}, { timestamps: true });
auditLogSchema.index({ createdAt: -1 });
export default mongoose.model('AuditLog', auditLogSchema);
