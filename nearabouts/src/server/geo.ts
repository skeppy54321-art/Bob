/** Country / US-state lookup and region sampling, backed by Natural Earth boundaries. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BBox, type LatLng, bboxContains, circleBBox, geometryBBox, haversineKm, inGeometry, destination,
} from '../shared/geo.ts';
import { WORLD_SCALE_KM, clampScale } from '../shared/scoring.ts';

const DATA = join(process.cwd(), 'data', 'geo');
interface Feat { code: string; name: string; continent?: string; bbox: BBox; geometry: any }

export interface CountryMeta { a2: string; name: string; continent: string; subregion: string; area: number; center: [number, number]; bbox: BBox; independent: boolean }

const countryFeats: Feat[] = JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8')).features.map((f: any) => ({
  code: f.properties.a2, name: f.properties.name, continent: f.properties.continent, bbox: geometryBBox(f.geometry), geometry: f.geometry,
}));
const stateFeats: Feat[] = JSON.parse(readFileSync(join(DATA, 'us-states.json'), 'utf8')).features.map((f: any) => ({
  code: f.properties.code, name: f.properties.name, bbox: geometryBBox(f.geometry), geometry: f.geometry,
}));
export const countries: CountryMeta[] = JSON.parse(readFileSync(join(DATA, 'countries-meta.json'), 'utf8'));
export const countryByCode = new Map(countries.map((c) => [c.a2, c]));
export const usStates = stateFeats.map((s) => ({ code: s.code, name: s.name }));
export const stateByCode = new Map(usStates.map((s) => [s.code, s]));
export const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania'] as const;

function lookup(feats: Feat[], p: LatLng): Feat | null {
  for (const f of feats) if (bboxContains(f.bbox, p) && inGeometry(f.geometry, p)) return f;
  return null;
}
export const countryAt = (p: LatLng): string | null => lookup(countryFeats, p)?.code ?? null;
export const stateAt = (p: LatLng): string | null => lookup(stateFeats, p)?.code ?? null;
export const countryName = (code: string | null | undefined) => (code ? countryByCode.get(code)?.name ?? code : 'Unknown');
export const stateName = (code: string | null | undefined) => (code ? stateByCode.get(code)?.name ?? code : 'Unknown');

/**
 * Bounding box for a set of features that may cross the antimeridian (Russia, Fiji, USA,
 * New Zealand). Longitudes are taken from the largest empty longitudinal gap.
 */
/**
 * Keep only a feature's "main" polygons (>= 20% of its largest polygon's approximate area) so that
 * far-flung islands (Caribbean Netherlands, French Guiana, Svalbard…) don't inflate a map's scale.
 */
function mainPolygons(geoms: any[]): any[] {
  const out: any[] = [];
  for (const g of geoms) {
    const polys: any[] = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    const area = (p: any) => { const b = geometryBBox({ coordinates: p }); return (b[2] - b[0]) * (b[3] - b[1]) * Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180); };
    const areas = polys.map(area);
    const max = Math.max(...areas);
    polys.forEach((p, i) => { if (areas[i] >= max * 0.2) out.push({ type: 'Polygon', coordinates: p }); });
  }
  return out;
}

function wrapAwareExtent(geomsIn: any[]): { bbox: BBox; scaleKm: number } {
  const geoms = mainPolygons(geomsIn);
  const lngs: number[] = [];
  let minLat = 90, maxLat = -90;
  const walk = (x: any) => {
    if (typeof x[0] === 'number') { lngs.push(x[0]); if (x[1] < minLat) minLat = x[1]; if (x[1] > maxLat) maxLat = x[1]; }
    else for (const y of x) walk(y);
  };
  for (const g of geoms) walk(g.coordinates);
  lngs.sort((a, b) => a - b);
  let gap = 0, gapEnd = 0;
  for (let i = 0; i < lngs.length; i++) {
    const a = lngs[i], b = i + 1 < lngs.length ? lngs[i + 1] : lngs[0] + 360;
    if (b - a > gap) { gap = b - a; gapEnd = b; }
  }
  const west = ((gapEnd + 180) % 360) - 180;
  const span = 360 - gap;
  const east = west + span;
  const midLat = (minLat + maxLat) / 2;
  const width = haversineKm({ lat: midLat, lng: 0 }, { lat: midLat, lng: Math.min(180, span) }) * (span > 180 ? 2 : 1);
  const height = haversineKm({ lat: minLat, lng: 0 }, { lat: maxLat, lng: 0 });
  return { bbox: [west, minLat, east, maxLat], scaleKm: Math.sqrt(width * width + height * height) };
}

/** A map region. Exactly one family of fields is normally set. */
export interface Region {
  world?: boolean;
  continent?: string;
  countries?: string[];
  states?: string[];
  circles?: { lat: number; lng: number; radiusKm: number; label?: string }[];
}

export function regionContains(r: Region, p: LatLng): boolean {
  if (r.circles?.length) return r.circles.some((c) => haversineKm(c, p) <= c.radiusKm);
  if (r.states?.length) { const s = stateAt(p); return !!s && r.states.includes(s); }
  const c = countryAt(p);
  if (!c) return false;
  if (r.countries?.length) return r.countries.includes(c);
  if (r.continent) return countryByCode.get(c)?.continent === r.continent;
  return true; // world: any land
}

/** Countries a region can contain (used for fast DB filtering). null = not restricted by country. */
export function regionCountries(r: Region): string[] | null {
  if (r.circles?.length) return null;
  if (r.states?.length) return ['US'];
  if (r.countries?.length) return r.countries;
  if (r.continent) return countries.filter((c) => c.continent === r.continent).map((c) => c.a2);
  return null;
}

export function regionScaleKm(r: Region): number {
  if (r.world) return WORLD_SCALE_KM;
  if (r.circles?.length) {
    if (r.circles.length === 1) return clampScale(r.circles[0].radiusKm * 2 * Math.SQRT2);
    const lats = r.circles.map((c) => c.lat), lngs = r.circles.map((c) => c.lng);
    return clampScale(haversineKm({ lat: Math.min(...lats), lng: Math.min(...lngs) }, { lat: Math.max(...lats), lng: Math.max(...lngs) }));
  }
  const feats = r.states?.length ? stateFeats.filter((f) => r.states!.includes(f.code))
    : countryFeats.filter((f) => (r.countries?.length ? r.countries.includes(f.code) : r.continent ? f.continent === r.continent : true));
  if (!feats.length) return WORLD_SCALE_KM;
  return clampScale(wrapAwareExtent(feats.map((f) => f.geometry)).scaleKm);
}

export function regionBBox(r: Region): BBox {
  if (r.circles?.length) {
    const bs = r.circles.map((c) => circleBBox(c, c.radiusKm));
    return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
  }
  const feats = r.states?.length ? stateFeats.filter((f) => r.states!.includes(f.code))
    : countryFeats.filter((f) => (r.countries?.length ? r.countries.includes(f.code) : r.continent ? f.continent === r.continent : true));
  if (r.world || !feats.length) return [-180, -60, 180, 85];
  return wrapAwareExtent(feats.map((f) => f.geometry)).bbox;
}

/**
 * Random point on land inside the region. Countries are chosen with weight sqrt(area) so large
 * countries do not swamp the sample while small ones still appear.
 */
export function randomPointInRegion(r: Region, rng: () => number): LatLng | null {
  if (r.circles?.length) {
    const c = r.circles[Math.floor(rng() * r.circles.length)];
    return destination(c, rng() * 360, c.radiusKm * Math.sqrt(rng()));
  }
  const pool = r.states?.length ? stateFeats.filter((f) => r.states!.includes(f.code)) : (() => {
    const allowed = regionCountries(r);
    return countryFeats.filter((f) => !allowed || allowed.includes(f.code));
  })();
  if (!pool.length) return null;
  const weights = pool.map((f) => Math.sqrt(Math.max(1, r.states?.length ? 1 : countryByCode.get(f.code)?.area ?? 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng() * total, feat = pool[0];
  for (let i = 0; i < pool.length; i++) { x -= weights[i]; if (x <= 0) { feat = pool[i]; break; } }
  const b = feat.bbox;
  for (let i = 0; i < 200; i++) {
    const p = { lat: b[1] + rng() * (b[3] - b[1]), lng: b[0] + rng() * (b[2] - b[0]) };
    if (inGeometry(feat.geometry, p)) return p;
  }
  return null;
}
