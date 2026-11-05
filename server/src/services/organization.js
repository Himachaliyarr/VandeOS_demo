import Organization from '../models/Organization.js';
import Division from '../models/Division.js';
import Department from '../models/Department.js';
import Shift from '../models/Shift.js';

export async function ensureFoundation() {
  let organization = await Organization.findOne();
  if (!organization) organization = await Organization.create({
    name: 'Vande Digital',
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
    settings: {
      officeName: process.env.OFFICE_NAME || 'Vande Digital Office',
      officeLatitude: process.env.OFFICE_LATITUDE ? Number(process.env.OFFICE_LATITUDE) : null,
      officeLongitude: process.env.OFFICE_LONGITUDE ? Number(process.env.OFFICE_LONGITUDE) : null,
      geofenceRadiusMeters: Number(process.env.GEOFENCE_RADIUS_METERS || 150),
      gpsMaxAccuracyMeters: Number(process.env.GPS_MAX_ACCURACY_METERS || 100)
    }
  });
  const divisionDefaults = [
    { name: 'Vande Digital', slug: 'vande-digital' },
    { name: 'Vande Digital Academy', slug: 'vande-digital-academy' }
  ];
  const divisions = {};
  for (const item of divisionDefaults) {
    divisions[item.slug] = await Division.findOneAndUpdate(
      { organization: organization._id, slug: item.slug },
      { $setOnInsert: { ...item, organization: organization._id } },
      { upsert: true, returnDocument: 'after' }
    );
  }
  const departmentDefaults = [
    ['Web Development', 'web-development', 'vande-digital'],
    ['Digital Marketing', 'digital-marketing', 'vande-digital'],
    ['Graphic Designing', 'graphic-designing', 'vande-digital'],
    ['Video Editing', 'video-editing', 'vande-digital'],
    ['Training', 'training', 'vande-digital-academy']
  ];
  for (const [name, slug, division] of departmentDefaults) {
    await Department.findOneAndUpdate(
      { division: divisions[division]._id, slug },
      { $setOnInsert: { name, slug, division: divisions[division]._id } },
      { upsert: true, returnDocument: 'after' }
    );
  }
  if (!await Shift.exists({ name: 'Flexible core hours' })) {
    await Shift.create({ name: 'Flexible core hours', startTime: '09:00', endTime: '18:00', days: [1, 2, 3, 4, 5], flexibleWindowMinutes: 120 });
  }
  organization.divisions = Object.values(divisions).map(({ _id }) => _id);
  await organization.save();
  return organization;
}
