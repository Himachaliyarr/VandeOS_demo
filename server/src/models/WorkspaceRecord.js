import mongoose from 'mongoose';

const paymentEntrySchema = new mongoose.Schema({
  id: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recordedAt: { type: Date, required: true, default: Date.now }
}, { _id: false });

const stockMovementSchema = new mongoose.Schema({
  id: { type: String, required: true },
  direction: { type: String, enum: ['IN', 'OUT'], required: true },
  quantity: { type: Number, required: true, min: 0 },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recordedAt: { type: Date, required: true, default: Date.now }
}, { _id: false });

const workspaceRecordSchema = new mongoose.Schema({
  module: { type: String, enum: ['crm', 'projects', 'academy', 'finance', 'marketing', 'inventory', 'support', 'automations'], required: true, index: true },
  kind: { type: String, required: true, trim: true, maxlength: 40 },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, trim: true, maxlength: 5000, default: '' },
  status: { type: String, required: true, trim: true, maxlength: 40 },
  data: { type: Map, of: String, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkspaceRecord', default: null, index: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkspaceRecord', default: null, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkspaceRecord', default: null, index: true },
  dueDate: { type: Date, default: null, index: true },
  amount: { type: Number, min: 0, default: null },
  paidAmount: { type: Number, min: 0, default: 0 },
  paymentEntries: { type: [paymentEntrySchema], default: [] },
  stockQuantity: { type: Number, min: 0, default: 0 },
  minStockLevel: { type: Number, min: 0, default: 0 },
  stockMovements: { type: [stockMovementSchema], default: [] },
  quantity: { type: Number, min: 0, default: null },
  currency: { type: String, uppercase: true, trim: true, minlength: 3, maxlength: 3, default: 'INR' },
  archivedAt: { type: Date, default: null, index: true }
}, { timestamps: true });

workspaceRecordSchema.index({ module: 1, kind: 1, status: 1, archivedAt: 1, updatedAt: -1 });
workspaceRecordSchema.index({ module: 1, client: 1, archivedAt: 1 });
workspaceRecordSchema.index(
  { parent: 1, student: 1 },
  { unique: true, partialFilterExpression: { module: 'academy', kind: 'submission', archivedAt: null } }
);

export default mongoose.model('WorkspaceRecord', workspaceRecordSchema);
