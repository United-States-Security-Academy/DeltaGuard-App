import { APP_NAME, COMPANY_NAME } from '@deltaguard/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatDistance } from '@/lib/clock-messages';
import { brand } from '@/lib/theme';

// A static map of a site: OpenStreetMap tiles (the same ones the admin map
// picker uses) with the clock-in radius drawn on top. No maps SDK or API key,
// and it never reads the phone's location. Tapping it opens directions in
// the phone's maps app.

const TILE = 256;
const HEIGHT = 200;
const TILE_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
// The OSM tile policy requires an identifying User-Agent and attribution.
const TILE_HEADERS = { 'User-Agent': `${APP_NAME}/1.0 (${COMPANY_NAME} internal app)` };

/** Web Mercator position of a point, in pixels at zoom z. */
function project(lat: number, lng: number, z: number) {
  const size = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

const metresPerPixel = (lat: number, z: number) =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** The closest zoom at which the whole radius circle fits comfortably. */
function zoomFor(lat: number, radiusM: number): number {
  for (let z = 18; z > 3; z--) {
    if ((2 * radiusM) / metresPerPixel(lat, z) <= HEIGHT * 0.6) return z;
  }
  return 3;
}

export function SiteMap({
  latitude,
  longitude,
  radiusM,
  label,
  onPress,
}: {
  latitude: number;
  longitude: number;
  radiusM: number;
  label: string;
  onPress?: () => void;
}) {
  const [width, setWidth] = useState(0);
  const z = zoomFor(latitude, radiusM);
  const centre = project(latitude, longitude, z);
  const diameter = (2 * radiusM) / metresPerPixel(latitude, z);
  const tilesPerSide = 2 ** z;

  const tiles: { key: string; uri: string; left: number; top: number }[] = [];
  if (width > 0) {
    const left = centre.x - width / 2;
    const top = centre.y - HEIGHT / 2;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + HEIGHT) / TILE); ty++) {
        if (ty < 0 || ty >= tilesPerSide) continue;
        const wrappedX = ((tx % tilesPerSide) + tilesPerSide) % tilesPerSide;
        tiles.push({
          key: `${tx}-${ty}`,
          uri: TILE_URL(z, wrappedX, ty),
          left: tx * TILE - left,
          top: ty * TILE - top,
        });
      }
    }
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={`Map of ${label}, with the ${formatDistance(radiusM)} clock-in area.${
        onPress ? ' Opens directions.' : ''
      }`}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className="overflow-hidden rounded-xl border border-white/10 bg-navy"
      style={{ height: HEIGHT }}
    >
      {tiles.map((t) => (
        <Image
          key={t.key}
          source={{ uri: t.uri, headers: TILE_HEADERS }}
          style={{ position: 'absolute', left: t.left, top: t.top, width: TILE, height: TILE }}
          cachePolicy="disk"
          transition={150}
        />
      ))}
      {width > 0 ? (
        <>
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: width / 2 - diameter / 2,
              top: HEIGHT / 2 - diameter / 2,
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              borderWidth: 2,
              borderColor: brand.gold,
              backgroundColor: 'rgba(214, 181, 98, 0.18)',
            }}
          />
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: width / 2 - 14, top: HEIGHT / 2 - 28 }}
          >
            <Ionicons name="location" size={28} color={brand.ink} />
          </View>
        </>
      ) : null}
      <Text className="absolute bottom-0 right-0 bg-white/80 px-1.5 py-0.5 text-[10px] text-ink">
        © OpenStreetMap contributors
      </Text>
    </Pressable>
  );
}
