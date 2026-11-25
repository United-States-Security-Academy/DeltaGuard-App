'use client';

import 'leaflet/dist/leaflet.css';

import type * as Leaflet from 'leaflet';
import type { Circle, Map as LeafletMap, Marker, Polyline } from 'leaflet';
import { useEffect, useRef, useState } from 'react';

import { addBaseLayers } from '@/lib/map-layers';
import { createClient } from '@/lib/supabase/client';

type LeafletModule = typeof Leaflet;
type Point = {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  recorded_at: string;
};

const PIN_HTML =
  '<div style="width:22px;height:22px;border-radius:9999px;background:#DC2626;border:3px solid #fff;box-shadow:0 0 0 4px rgba(220,38,38,.35),0 1px 4px rgba(0,0,0,.5)"></div>';

/**
 * Live map of an SOS: the latest position (red pin and accuracy circle) and the
 * trail of earlier ones. New positions arrive by Realtime (RLS: staff only).
 * Leaflet touches `window`, so it loads in the browser after mount.
 */
export function SosMap({ alertId, className = 'h-72' }: { alertId: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layers = useRef<{
    L: LeafletModule;
    map: LeafletMap;
    marker: Marker | null;
    circle: Circle | null;
    trail: Polyline | null;
    fitted: boolean;
  } | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Positions: what's there now, then live.
  useEffect(() => {
    const supabase = createClient();
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const { data } = await supabase
        .from('sos_locations')
        .select('latitude, longitude, accuracy_m, recorded_at')
        .eq('alert_id', alertId)
        .order('recorded_at');
      if (disposed) return;
      setPoints(data ?? []);
      setLoaded(true);
      await supabase.realtime.setAuth();
      if (disposed) return;
      channel = supabase
        .channel(`sos-map:${alertId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'sos_locations',
            filter: `alert_id=eq.${alertId}`,
          },
          (payload) => setPoints((current) => [...current, payload.new as Point]),
        )
        .subscribe();
    })();
    return () => {
      disposed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [alertId]);

  // The map itself, once.
  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || layers.current) return;
      const map = L.map(containerRef.current, { zoomControl: true }).setView([39.5, -98.35], 4);
      addBaseLayers(L, map);
      layers.current = { L, map, marker: null, circle: null, trail: null, fitted: false };
      // Draw whatever arrived before Leaflet loaded.
      setPoints((p) => [...p]);
    });
    return () => {
      cancelled = true;
      layers.current?.map.remove();
      layers.current = null;
    };
  }, []);

  // Redraw on every new position.
  useEffect(() => {
    const l = layers.current;
    if (!l || points.length === 0) return;
    const latest = points[points.length - 1]!;
    const at: [number, number] = [Number(latest.latitude), Number(latest.longitude)];
    const icon = l.L.divIcon({
      html: PIN_HTML,
      className: '',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    if (l.marker) l.marker.setLatLng(at);
    else l.marker = l.L.marker(at, { icon }).addTo(l.map);

    const radius = Number(latest.accuracy_m ?? 0);
    if (radius > 0) {
      if (l.circle) l.circle.setLatLng(at).setRadius(radius);
      else {
        l.circle = l.L.circle(at, {
          radius,
          color: '#DC2626',
          weight: 1,
          fillColor: '#DC2626',
          fillOpacity: 0.12,
        }).addTo(l.map);
      }
    }

    const path = points.map((p) => [Number(p.latitude), Number(p.longitude)] as [number, number]);
    if (l.trail) l.trail.setLatLngs(path);
    else {
      l.trail = l.L.polyline(path, { color: '#D6B562', weight: 3, dashArray: '4 6' }).addTo(l.map);
    }

    if (!l.fitted) {
      l.map.setView(at, 17);
      l.fitted = true;
    } else if (!l.map.getBounds().contains(at)) {
      l.map.panTo(at);
    }
  }, [points]);

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-surface-2 ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {loaded && points.length === 0 ? (
        <p className="absolute inset-0 z-[500] flex items-center justify-center bg-surface-2/90 p-4 text-center text-sm text-muted">
          No position from the phone yet (location may be off, or no GPS signal).
        </p>
      ) : null}
    </div>
  );
}
