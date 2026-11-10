import mongoose from 'mongoose';

const tenantRegistrySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, lowercase: true, trim: true, unique: true },
  dbName: { type: String, required: true, unique: true },
  status: { type: String, enum: ['PENDING', 'ACTIVE', 'SUSPENDED'], default: 'PENDING', index: true },
  ownerEmail: { type: String, required: true, lowercase: true, trim: true },
  joiningFeePaise: { type: Number, required: true, min: 1 },
  razorpayOrderId: { type: String, default: '' },
  razorpayPaymentId: { type: String, default: '' },
  paidAt: { type: Date, default: null }
}, { timestamps: true });

export default mongoose.connection.models.TenantRegistry
  || mongoose.connection.model('TenantRegistry', tenantRegistrySchema);
