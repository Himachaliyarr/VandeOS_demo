import mongoose from 'mongoose';
import { tenantModel } from '../services/tenantContext.js';

const pointSchema = new mongoose.Schema({
  latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 },
  accuracy: { type: Number, min: 0 }
}, { _id: false });

const eventSchema = new mongoose.Schema({
  at: { type: Date, required: true },
  method: { type: String, enum: ['OFFICE_GPS', 'REMOTE_WEB'], required: true },
  location: { type: pointSchema, default: null },
  note: { type: String, default: '' }
}, { _id: false });

const attendanceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  workDate: { type: String, required: true },
  checkIn: { type: eventSchema, required: true },
  checkOut: { type: eventSchema, default: null },
  totalMinutes: { type: Number, default: 0 },
  status: { type: String, enum: ['IN_PROGRESS', 'COMPLETE'], default: 'IN_PROGRESS' }
}, { timestamps: true });
attendanceSchema.index({ user: 1, workDate: 1 }, { unique: true });
export default tenantModel('Attendance', attendanceSchema);
