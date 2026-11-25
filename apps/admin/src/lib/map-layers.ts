import type * as Leaflet from 'leaflet';

// Base maps for every Leaflet map in the console, with a Map / Satellite
// switch (Leaflet's own layers control, top right). No API keys:
// - Map: OpenStreetMap's public tile server (attribution + fair use).
// - Satellite: Esri World Imagery, with Esri's place-name labels on top.
// The last choice is remembered per browser.

type LeafletModule = typeof Leaflet;

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

const ESRI_BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const IMAGERY_URL = `${ESRI_BASE}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const LABELS_URL = `${ESRI_BASE}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`;
const ESRI_ATTRIBUTION =
  'Imagery &copy; <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics';

const STORAGE_KEY = 'dg-map-layer';
const LABELS = { map: 'Map', satellite: 'Satellite' } as const;
type BaseLayer = keyof typeof LABELS;

function savedLayer(): BaseLayer {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'satellite' ? 'satellite' : 'map';
  } catch {
    return 'map';
  }
}

/** Adds the Map and Satellite base layers and the switch to `map`. */
export function addBaseLayers(L: LeafletModule, map: Leaflet.Map): void {
  const layers: Record<BaseLayer, Leaflet.Layer> = {
    map: L.tileLayer(OSM_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }),
    satellite: L.layerGroup([
      // Imagery is 18+ in most places; Leaflet stretches the last level beyond that.
      L.tileLayer(IMAGERY_URL, { maxZoom: 19, maxNativeZoom: 18, attribution: ESRI_ATTRIBUTION }),
      L.tileLayer(LABELS_URL, { maxZoom: 19, maxNativeZoom: 18 }),
    ]),
  };

  layers[savedLayer()].addTo(map);
  L.control
    .layers({ [LABELS.map]: layers.map, [LABELS.satellite]: layers.satellite }, undefined, {
      collapsed: false,
      position: 'topright',
    })
    .addTo(map);

  map.on('baselayerchange', (e: Leaflet.LayersControlEvent) => {
    try {
      localStorage.setItem(STORAGE_KEY, e.name === LABELS.satellite ? 'satellite' : 'map');
    } catch {
      // Storage blocked (private window): the choice just isn't remembered.
    }
  });
}
