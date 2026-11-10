import mongoose from 'mongoose';
import { tenantModel } from '../services/tenantContext.js';

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['INFO', 'SUCCESS', 'WARNING', 'LEAVE', 'ATTENDANCE'], default: 'INFO' },
  href: { type: String, default: '' },
  readAt: { type: Date, default: null }
}, { timestamps: true });
notificationSchema.index({ user: 1, createdAt: -1 });
export default tenantModel('Notification', notificationSchema);
