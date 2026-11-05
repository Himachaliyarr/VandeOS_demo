import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInPolicy, metersBetween } from '../src/services/attendancePolicy.js';

const office = { officeLatitude: 28.6139, officeLongitude: 77.209, geofenceRadiusMeters: 150, gpsMaxAccuracyMeters: 100 };

test('GPS check-in is accepted at the configured office', () => {
  const result = checkInPolicy({ method: 'OFFICE_GPS', latitude: 28.6139, longitude: 77.209, accuracy: 12 }, { remoteApproved: false }, office);
  assert.equal(result.allowed, true);
  assert.equal(result.location.latitude, office.officeLatitude);
});

test('GPS check-in is rejected outside the office radius', () => {
  const result = checkInPolicy({ method: 'OFFICE_GPS', latitude: 28.62, longitude: 77.209, accuracy: 10 }, { remoteApproved: false }, office);
  assert.equal(result.allowed, false);
  assert.equal(result.status, 403);
  assert.ok(result.distance > office.geofenceRadiusMeters);
});

test('GPS check-in rejects an inaccurate reading', () => {
  const result = checkInPolicy({ method: 'OFFICE_GPS', latitude: office.officeLatitude, longitude: office.officeLongitude, accuracy: 120 }, { remoteApproved: false }, office);
  assert.equal(result.allowed, false);
  assert.equal(result.status, 400);
});

test('GPS check-in is unavailable until the Owner configures coordinates', () => {
  const result = checkInPolicy({ method: 'OFFICE_GPS', latitude: 28.6139, longitude: 77.209 }, { remoteApproved: false }, { ...office, officeLatitude: null, officeLongitude: null });
  assert.equal(result.allowed, false);
  assert.equal(result.status, 503);
});

test('remote web check-in requires remote approval', () => {
  assert.equal(checkInPolicy({ method: 'REMOTE_WEB' }, { remoteApproved: true }, office).allowed, true);
  assert.equal(checkInPolicy({ method: 'REMOTE_WEB' }, { remoteApproved: false }, office).status, 403);
});

test('geofence distance uses a geographic distance in metres', () => {
  const distance = metersBetween(0, 0, 0, 0.001);
  assert.ok(distance > 110 && distance < 112);
});
