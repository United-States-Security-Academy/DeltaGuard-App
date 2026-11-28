// Distance on the Earth's surface, the same formula as public.distance_m() in
// Postgres, so the phone's on-site check agrees with the server's.

const EARTH_RADIUS_M = 6_371_000;

export type LatLng = { latitude: number; longitude: number };

/** Haversine distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Up to this much of a fix's reported accuracy counts in the officer's favour
 * when checking a clock-in against the site radius. Same value as in
 * clock_event() (phase 14).
 */
export const CLOCK_IN_ACCURACY_ALLOWANCE_M = 50;

/** True when a clock-in fix is close enough to the site, by clock_event()'s rule. */
export function isWithinClockInRange(
  distanceM: number,
  radiusM: number,
  accuracyM: number | null,
): boolean {
  return distanceM - Math.min(accuracyM ?? 0, CLOCK_IN_ACCURACY_ALLOWANCE_M) <= radiusM;
}
