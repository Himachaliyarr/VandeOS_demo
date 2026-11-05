import mongoose from 'mongoose';

const divisionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, lowercase: true, trim: true },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });
divisionSchema.index({ organization: 1, slug: 1 }, { unique: true });
export default mongoose.model('Division', divisionSchema);
