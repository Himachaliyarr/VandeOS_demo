import mongoose from 'mongoose';

const leaveRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  leaveType: { type: String, enum: ['ANNUAL', 'SICK', 'PERSONAL', 'UNPAID', 'OTHER'], default: 'ANNUAL' },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], default: 'PENDING' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  reviewerNote: { type: String, default: '' }
}, { timestamps: true });
leaveRequestSchema.index({ user: 1, startDate: 1 });
export default mongoose.model('LeaveRequest', leaveRequestSchema);
