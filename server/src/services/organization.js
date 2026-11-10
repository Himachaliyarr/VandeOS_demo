import Organization from '../models/Organization.js';
import Division from '../models/Division.js';
import Department from '../models/Department.js';
import Shift from '../models/Shift.js';

export async function ensureFoundation({ name = 'Vande Digital', useEnvironment = true } = {}) {
  let organization = await Organization.findOne();
  if (!organization) organization = await Organization.create({
    name,
    timezone: useEnvironment ? process.env.TIMEZONE || 'Asia/Kolkata' : 'Asia/Kolkata',
    settings: {
      officeName: useEnvironment && process.env.OFFICE_NAME || `${name} Office`,
      officeLatitude: useEnvironment && process.env.OFFICE_LATITUDE ? Number(process.env.OFFICE_LATITUDE) : null,
      officeLongitude: useEnvironment && process.env.OFFICE_LONGITUDE ? Number(process.env.OFFICE_LONGITUDE) : null,
      geofenceRadiusMeters: useEnvironment ? Number(process.env.GEOFENCE_RADIUS_METERS || 150) : 150,
      gpsMaxAccuracyMeters: useEnvironment ? Number(process.env.GPS_MAX_ACCURACY_METERS || 100) : 100
    }
  });
  const organizationSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization';
  const divisionDefaults = name === 'Vande Digital'
    ? [
      { name: 'Vande Digital', slug: 'vande-digital' },
      { name: 'Vande Digital Academy', slug: 'vande-digital-academy' }
    ]
    : [
      { name, slug: organizationSlug },
      { name: `${name} Academy`, slug: `${organizationSlug}-academy` }
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
    ['Web Development', 'web-development', divisionDefaults[0].slug],
    ['Digital Marketing', 'digital-marketing', divisionDefaults[0].slug],
    ['Graphic Designing', 'graphic-designing', divisionDefaults[0].slug],
    ['Video Editing', 'video-editing', divisionDefaults[0].slug],
    ['Training', 'training', divisionDefaults[1].slug]
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
