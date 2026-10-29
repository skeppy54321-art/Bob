/**
 * Shared Leaflet setup for the guess map and result maps.
 * Styles: "satellite" (imagery + borders + place labels, like a hybrid view), "streets" (road map)
 * and "borders" (our built-in Natural Earth border map, works with no tile service at all).
 * A small switcher on the map changes style live.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AppConfig, MapStyle } from './types.ts';

let countries: Promise<any> | null = null;
const loadCountries = () => (countries ??= fetch('/geo/countries.json').then((r) => r.json()));

export interface BaseOptions {
  config: AppConfig | null;
  mapStyle: MapStyle;
  /** false = never show place-name labels or street maps (hard difficulty) */
  labels?: boolean;
  onStyleChange?: (s: MapStyle) => void;
  /** Show the three-button style switcher (default true). Small maps use cycleStyle() instead. */
  control?: boolean;
}

export const STYLE_ICON: Record<MapStyle, string> = { satellite: '🛰', streets: '🗺', borders: '🌐' };
/** Switch a map created by createMap to its next available style; returns the new style. */
export function cycleStyle(map: L.Map): MapStyle | null {
  return (map as any)._naCycle?.() ?? null;
}

const STYLE_LABEL: Record<MapStyle, string> = { satellite: 'Satellite', streets: 'Map', borders: 'Borders' };

export function availableStyles(config: AppConfig | null, labels = true): MapStyle[] {
  const out: MapStyle[] = [];
  if (config?.tiles.satellite) out.push('satellite');
  if (config?.tiles.streets && labels) out.push('streets');
  out.push('borders');
  return out;
}

export function createMap(el: HTMLElement, opts: BaseOptions): L.Map {
  const map = L.map(el, {
    worldCopyJump: true, minZoom: 1, maxZoom: 18, zoomControl: true, attributionControl: true, preferCanvas: true,
    zoomSnap: 0.5, wheelPxPerZoomLevel: 90, maxBounds: [[-89, -540], [89, 540]], maxBoundsViscosity: 0.8,
  }).setView([20, 0], 1);
  map.attributionControl.setPrefix(false);
  const tiles = opts.config?.tiles;
  const styles = availableStyles(opts.config, opts.labels !== false);
  const renderer = L.canvas({ padding: 0.5 });
  let current: L.Layer[] = [];
  let style: MapStyle = styles.includes(opts.mapStyle) ? opts.mapStyle : styles[0];

  const borderLayer = (filled: boolean) => {
    const g = L.geoJSON(undefined, {
      renderer, interactive: false,
      style: () => (filled
        ? { color: '#3d4e68', weight: 0.8, fillColor: '#1d2a3b', fillOpacity: 1 }
        : { color: '#ffffff', weight: 0.9, opacity: 0.55, fill: false }),
    } as any);
    loadCountries().then((fc) => { if ((map as any)._container) g.addData(fc); }).catch(() => {});
    return g;
  };
  const tileLayer = (cfg: { url: string; attribution: string; maxZoom: number }, pane?: string) =>
    L.tileLayer(cfg.url, { attribution: cfg.attribution, maxNativeZoom: cfg.maxZoom, maxZoom: 18, crossOrigin: true, ...(pane ? { pane } : {}) } as any);

  if (!map.getPane('labels')) {
    map.createPane('labels');
    const p = map.getPane('labels')!;
    p.style.zIndex = '450';
    p.style.pointerEvents = 'none';
  }

  const apply = (s: MapStyle) => {
    for (const l of current) map.removeLayer(l);
    current = [];
    style = s;
    el.classList.toggle('map-satellite', s === 'satellite');
    if (s === 'satellite' && tiles?.satellite) {
      current.push(tileLayer(tiles.satellite), borderLayer(false));
      if (tiles.labels && opts.labels !== false) current.push(tileLayer(tiles.labels, 'labels'));
    } else if (s === 'streets' && tiles?.streets) {
      current.push(tileLayer(tiles.streets));
    } else {
      current.push(borderLayer(true));
    }
    for (const l of current) l.addTo(map);
    switcher?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.style === s)));
  };

  // Style switcher control (top-right).
  let switcher: HTMLElement | null = null;
  if (styles.length > 1 && opts.control !== false) {
    const Ctl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'map-style-switch leaflet-bar');
        for (const s of styles) {
          const b = L.DomUtil.create('button', '', div) as HTMLButtonElement;
          b.type = 'button';
          b.dataset.style = s;
          b.textContent = STYLE_LABEL[s];
          b.title = `${STYLE_LABEL[s]} view`;
          L.DomEvent.on(b, 'click', (e) => { L.DomEvent.stop(e); apply(s); opts.onStyleChange?.(s); });
        }
        L.DomEvent.disableClickPropagation(div);
        switcher = div;
        return div;
      },
    });
    new Ctl({ position: 'topright' }).addTo(map);
  }
  (map as any)._naCycle = () => {
    const next = styles[(styles.indexOf(style) + 1) % styles.length];
    apply(next);
    opts.onStyleChange?.(next);
    return next;
  };
  apply(style);
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
