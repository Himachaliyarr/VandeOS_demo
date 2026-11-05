export function metersBetween(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = value => value * Math.PI / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function checkInPolicy(input, user, settings) {
  if (input.method === 'REMOTE_WEB') {
    return user.remoteApproved
      ? { allowed: true, location: null }
      : { allowed: false, status: 403, message: 'Web attendance is available only to employees approved for remote work.' };
  }
  if (input.latitude === undefined || input.longitude === undefined) {
    return { allowed: false, status: 400, message: 'Office check-in requires a GPS location.' };
  }
  if (input.accuracy !== undefined && input.accuracy > settings.gpsMaxAccuracyMeters) {
    return { allowed: false, status: 400, message: `GPS accuracy is too low. Move outside or try again (maximum ${settings.gpsMaxAccuracyMeters} m).` };
  }
  if (settings.officeLatitude === null || settings.officeLatitude === undefined || settings.officeLongitude === null || settings.officeLongitude === undefined) {
    return { allowed: false, status: 503, message: 'The Owner must configure office coordinates before GPS attendance is available.' };
  }
  const distance = metersBetween(input.latitude, input.longitude, settings.officeLatitude, settings.officeLongitude);
  if (distance > settings.geofenceRadiusMeters) {
    return { allowed: false, status: 403, message: `You are outside the office attendance area (${Math.round(distance)} m away).`, distance };
  }
  return {
    allowed: true,
    distance,
    location: { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy }
  };
}
