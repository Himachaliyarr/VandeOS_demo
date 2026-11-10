import mongoose from 'mongoose';
import { tenantModel } from '../services/tenantContext.js';

const shiftSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  days: { type: [Number], default: [1, 2, 3, 4, 5], validate: v => v.every(n => n >= 0 && n <= 6) },
  flexibleWindowMinutes: { type: Number, default: 120, min: 0, max: 720 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

export default tenantModel('Shift', shiftSchema);
