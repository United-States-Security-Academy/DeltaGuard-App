'use client';

import 'leaflet/dist/leaflet.css';

import type * as Leaflet from 'leaflet';
import type { Circle, Map as LeafletMap, Marker } from 'leaflet';
import { useEffect, useRef, useState } from 'react';

type LeafletModule = typeof Leaflet;

// OpenStreetMap's public tile server: free, no API key. Its usage policy
// requires the attribution below and fair use (fine for an internal console).
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

// Deltacon navy and gold.
const PIN_HTML =
  '<div style="width:20px;height:20px;border-radius:9999px;background:#10213A;border:3px solid #D6B562;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>';
const RADIUS_STYLE = { color: '#D6B562', weight: 2, fillColor: '#D6B562', fillOpacity: 0.15 };

/** Postgres stores numeric(9, 6): about 11 cm precision. */
export const roundCoord = (value: number) => Math.round(value * 1e6) / 1e6;

type Props = {
  latitude: number | null;
  longitude: number | null;
  radius: number;
  /** Where to start when the site has no coordinates yet (e.g. another site). */
  fallbackCenter: [number, number] | null;
  /** Changes whenever the parent wants the map to zoom to the pin (e.g. after a search). */
  focusKey: number;
  onPick: (latitude: number, longitude: number) => void;
};

/**
 * Click the map (or drag the pin) to set the site's location; the gold circle
 * shows the clock-in radius. Leaflet touches `window`, so it is imported in
 * the browser only, after mount.
 */
export function MapPicker({
  latitude,
  longitude,
  radius,
  fallbackCenter,
  focusKey,
  onPick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<{
    L: LeafletModule;
    map: LeafletMap;
    marker: Marker | null;
    circle: Circle | null;
  } | null>(null);
  const [ready, setReady] = useState(false);

  // Latest values for callbacks registered once at setup.
  const onPickRef = useRef(onPick);
  const initialView = useRef({ latitude, longitude, fallbackCenter });
  useEffect(() => {
    onPickRef.current = onPick;
  });

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | undefined;

    void import('leaflet').then((mod) => {
      const L = ('default' in mod ? mod.default : mod) as LeafletModule;
      if (cancelled || !containerRef.current) return;

      const start = initialView.current;
      const hasPin = start.latitude !== null && start.longitude !== null;
      map = L.map(containerRef.current, {
        center: hasPin ? [start.latitude!, start.longitude!] : (start.fallbackCenter ?? [20, 0]),
        zoom: hasPin ? 16 : start.fallbackCenter ? 12 : 2,
      });
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
      map.on('click', (e) => onPickRef.current(roundCoord(e.latlng.lat), roundCoord(e.latlng.lng)));

      leafletRef.current = { L, map, marker: null, circle: null };
      setReady(true);
    });

    return () => {
      cancelled = true;
      map?.remove();
      leafletRef.current = null;
    };
  }, []);

  // Keep the pin and radius circle in sync with the form values.
  useEffect(() => {
    const m = leafletRef.current;
    if (!ready || !m) return;

    if (latitude === null || longitude === null) {
      m.marker?.remove();
      m.circle?.remove();
      m.marker = null;
      m.circle = null;
      return;
    }

    const position: [number, number] = [latitude, longitude];
    if (!m.marker || !m.circle) {
      const marker = m.L.marker(position, {
        draggable: true,
        keyboard: false,
        icon: m.L.divIcon({
          className: '',
          html: PIN_HTML,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).addTo(m.map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        onPickRef.current(roundCoord(p.lat), roundCoord(p.lng));
      });
      m.marker = marker;
      m.circle = m.L.circle(position, { ...RADIUS_STYLE, radius }).addTo(m.map);
    } else {
      m.marker.setLatLng(position);
      m.circle.setLatLng(position);
      m.circle.setRadius(radius);
    }
  }, [ready, latitude, longitude, radius]);

  // Zoom to the pin when asked (after an address search).
  useEffect(() => {
    const m = leafletRef.current;
    if (!ready || !m || focusKey === 0 || !m.circle) return;
    m.map.fitBounds(m.circle.getBounds(), { maxZoom: 17, padding: [24, 24] });
  }, [ready, focusKey]);

  return (
    <div
      ref={containerRef}
      className="z-0 h-80 w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
      aria-label="Map: click to place the site"
    />
  );
}
