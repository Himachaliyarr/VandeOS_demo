import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, default: 'Vande Digital' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  divisions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Division' }],
  settings: {
    officeName: { type: String, default: 'Vande Digital Office' },
    officeLatitude: { type: Number, default: null },
    officeLongitude: { type: Number, default: null },
    geofenceRadiusMeters: { type: Number, default: 150, min: 25, max: 5000 },
    gpsMaxAccuracyMeters: { type: Number, default: 100, min: 10, max: 1000 },
    attendanceMode: { type: String, enum: ['GPS_OFFICE_REMOTE_WEB'], default: 'GPS_OFFICE_REMOTE_WEB' }
  }
}, { timestamps: true });

export default mongoose.model('Organization', organizationSchema);
