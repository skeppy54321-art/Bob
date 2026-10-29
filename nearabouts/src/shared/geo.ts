/** Geographic helpers shared by the server and the browser. */
export const EARTH_RADIUS_KM = 6371.0088;
export type LatLng = { lat: number; lng: number };
export type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance (haversine) in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Point reached from `p` after travelling `km` along initial bearing `bearingDeg`. */
export function destination(p: LatLng, bearingDeg: number, km: number): LatLng {
  const d = km / EARTH_RADIUS_KM;
  const br = rad(bearingDeg);
  const lat1 = rad(p.lat);
  const lng1 = rad(p.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lng: ((deg(lng2) + 540) % 360) - 180 };
}

export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function isValidLatLng(p: any): p is LatLng {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

export function bboxDiagonalKm(b: BBox): number {
  return haversineKm({ lat: b[1], lng: b[0] }, { lat: b[3], lng: b[2] });
}

export function bboxContains(b: BBox, p: LatLng): boolean {
  return p.lat >= b[1] && p.lat <= b[3] && p.lng >= b[0] && p.lng <= b[2];
}

type Ring = number[][];
function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Polygon with holes: rings[0] outer, rest holes. */
export function inPolygon(rings: Ring[], p: LatLng): boolean {
  if (!inRing(rings[0], p.lng, p.lat)) return false;
  for (let i = 1; i < rings.length; i++) if (inRing(rings[i], p.lng, p.lat)) return false;
  return true;
}
export function inGeometry(g: { type: string; coordinates: any }, p: LatLng): boolean {
  if (g.type === 'Polygon') return inPolygon(g.coordinates, p);
  if (g.type === 'MultiPolygon') return g.coordinates.some((poly: Ring[]) => inPolygon(poly, p));
  return false;
}

export function geometryBBox(g: { coordinates: any }): BBox {
  let a = 180, b = 90, c = -180, e = -90;
  const walk = (x: any) => {
    if (typeof x[0] === 'number') { if (x[0] < a) a = x[0]; if (x[0] > c) c = x[0]; if (x[1] < b) b = x[1]; if (x[1] > e) e = x[1]; }
    else for (const y of x) walk(y);
  };
  walk(g.coordinates);
  return [a, b, c, e];
}

/** Bounding box of a circle on the sphere (not valid across the poles / antimeridian, good enough for city maps). */
export function circleBBox(c: LatLng, radiusKm: number): BBox {
  const dLat = deg(radiusKm / EARTH_RADIUS_KM);
  const dLng = deg(radiusKm / (EARTH_RADIUS_KM * Math.max(0.05, Math.cos(rad(c.lat)))));
  return [c.lng - dLng, c.lat - dLat, c.lng + dLng, c.lat + dLat];
}

/** Small seedable PRNG (mulberry32) used for reproducible location selection. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 32-bit FNV-1a string hash for seeding. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
