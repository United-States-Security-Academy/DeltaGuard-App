import { Linking, Platform } from 'react-native';

type Destination = {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Opens turn-by-turn directions to a site in the phone's own maps app. The app
 * itself never reads the phone's location here: the maps app works out the
 * route (CLAUDE.md: location is only collected at clock-in/out and SOS).
 *
 * Returns false if there is nothing to navigate to or no app could open it.
 */
export async function openDirections(site: Destination): Promise<boolean> {
  const hasPin = site.latitude !== null && site.longitude !== null;
  const target = hasPin ? `${site.latitude},${site.longitude}` : site.address?.trim();
  if (!target) return false;
  const encoded = encodeURIComponent(target);
  const label = encodeURIComponent(site.name);

  // Most specific first; fall back to the web if no maps app handles it.
  const candidates =
    Platform.OS === 'ios'
      ? [`https://maps.apple.com/?daddr=${encoded}&q=${label}&dirflg=d`]
      : [
          `google.navigation:q=${encoded}`, // Google Maps, straight into navigation
          hasPin ? `geo:0,0?q=${encoded}(${label})` : `geo:0,0?q=${encoded}`, // any maps app
        ];
  candidates.push(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`);

  for (const url of candidates) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // No app for this URL; try the next one.
    }
  }
  return false;
}

/** Dial a phone number (site contact). */
export function call(phone: string) {
  void Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => undefined);
}
