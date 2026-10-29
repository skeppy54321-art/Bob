/** Shared Leaflet setup: built-in vector basemap (Natural Earth borders) + optional tile layer. */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AppConfig } from './types.ts';

let countries: Promise<any> | null = null;
const loadCountries = () => (countries ??= fetch('/geo/countries.json').then((r) => r.json()));

export interface BaseOptions { config: AppConfig | null; mapStyle: 'auto' | 'vector' | 'tiles'; labels?: boolean; interactive?: boolean }

export function createMap(el: HTMLElement, opts: BaseOptions): L.Map {
  const map = L.map(el, {
    worldCopyJump: true, minZoom: 1, maxZoom: 18, zoomControl: true, attributionControl: true, preferCanvas: true,
    zoomSnap: 0.5, wheelPxPerZoomLevel: 90, maxBounds: [[-89, -540], [89, 540]], maxBoundsViscosity: 0.8,
  }).setView([20, 0], 1);
  map.attributionControl.setPrefix(false);
  const useTiles = !!opts.config?.tiles && opts.mapStyle !== 'vector' && opts.labels !== false;
  const renderer = L.canvas({ padding: 0.5 });
  loadCountries().then((fc) => {
    if (!(map as any)._container) return;
    L.geoJSON(fc, {
      renderer, interactive: false,
      style: () => ({ color: '#3d4e68', weight: 0.8, fillColor: useTiles ? 'transparent' : '#1d2a3b', fillOpacity: useTiles ? 0 : 1, opacity: useTiles ? 0 : 1 }),
    } as any).addTo(map);
  }).catch(() => {});
  if (useTiles) {
    L.tileLayer(opts.config!.tiles!.url, { attribution: opts.config!.tiles!.attribution, maxZoom: 19, className: 'tiles-dark', crossOrigin: true } as any).addTo(map);
  } else {
    map.attributionControl.addAttribution('Borders: Natural Earth');
  }
  return map;
}

export function pinIcon(color: string, label?: string): L.DivIcon {
  const svg = `<svg viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 1C6.4 1 1 6.3 1 12.9 1 22 13 33 13 33s12-11 12-20.1C25 6.3 19.6 1 13 1z" fill="${color}" stroke="#0b0e14" stroke-width="1.6"/><circle cx="13" cy="13" r="4.6" fill="#0b0e14"/></svg>`;
  return L.divIcon({ className: 'pin', html: svg + (label ? `<span class="sr-only">${label}</span>` : ''), iconSize: [26, 26], iconAnchor: [13, 24] });
}
export function flagIcon(): L.DivIcon {
  const svg = `<svg viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M6 33V3" stroke="#e9eef6" stroke-width="2.4"/><path d="M7 3h15l-4 5 4 5H7z" fill="#ff6b4a" stroke="#0b0e14" stroke-width="1.2"/></svg>`;
  return L.divIcon({ className: 'pin', html: svg, iconSize: [26, 26], iconAnchor: [6, 24] });
}
export { L };
