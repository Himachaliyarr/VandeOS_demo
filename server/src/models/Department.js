import mongoose from 'mongoose';
import { tenantModel } from '../services/tenantContext.js';

const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, lowercase: true, trim: true },
  division: { type: mongoose.Schema.Types.ObjectId, ref: 'Division', required: true },
  head: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  active: { type: Boolean, default: true }
}, { timestamps: true });
departmentSchema.index({ division: 1, slug: 1 }, { unique: true });
export default tenantModel('Department', departmentSchema);
