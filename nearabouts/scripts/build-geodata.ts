/**
 * Builds the boundary files used by the server (country / US-state lookup) and by the
 * browser's built-in vector basemap.
 *
 * Source data: Natural Earth (public domain) via the `world-atlas` and `us-atlas` npm
 * packages (ISC license wrappers). Country metadata: `world-countries` (ODbL / MIT).
 * Run with:  npm run build:data
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { feature } from 'topojson-client';
import countriesMeta from 'world-countries';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../node_modules/${p}`, import.meta.url), 'utf8'));
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * world-atlas / us-atlas geometries are not cut at the antimeridian (they assume a spherical
 * renderer). Planar code (point-in-polygon, Leaflet) needs them cut, so polygons that jump across
 * ±180° are shifted into 0..360 and clipped into a western and an eastern part.
 */
type Pt = [number, number];
function clipHalf(ring: Pt[], keepWest: boolean): Pt[] {
  const keep = (p: Pt) => (keepWest ? p[0] <= 180 : p[0] >= 180);
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i], prev = ring[(i + ring.length - 1) % ring.length];
    const cross = (): Pt => { const t = (180 - prev[0]) / (cur[0] - prev[0]); return [180, prev[1] + t * (cur[1] - prev[1])]; };
    if (keep(cur)) { if (!keep(prev)) out.push(cross()); out.push(cur); }
    else if (keep(prev)) out.push(cross());
  }
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push([...out[0]] as Pt);
  return out.length >= 4 ? out : [];
}
const jumps = (ring: Pt[]) => ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180);
function cutPolygon(poly: Pt[][]): Pt[][][] {
  if (!poly.some(jumps)) return [poly];
  const shifted = poly.map((r) => r.map(([x, y]) => [x < 0 ? x + 360 : x, y] as Pt));
  const west = shifted.map((r) => clipHalf(r, true)).filter((r) => r.length);
  const east = shifted.map((r) => clipHalf(r, false).map(([x, y]) => [x - 360, y] as Pt)).filter((r) => r.length);
  return [west, east].filter((p) => p.length && p[0].length);
}
function cutAntimeridian(g: any): any {
  const polys: Pt[][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const out = polys.flatMap(cutPolygon);
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
}

function roundGeom(g: any, d: number): any {
  const walk = (c: any): any => (typeof c[0] === 'number' ? [round(c[0], d), round(c[1], d)] : c.map(walk));
  return { type: g.type, coordinates: walk(g.coordinates) };
}
function bboxOf(g: any): [number, number, number, number] {
  let a = 180, b = 90, c = -180, e = -90;
  const walk = (x: any) => {
    if (typeof x[0] === 'number') { a = Math.min(a, x[0]); c = Math.max(c, x[0]); b = Math.min(b, x[1]); e = Math.max(e, x[1]); }
    else x.forEach(walk);
  };
  walk(g.coordinates);
  return [a, b, c, e];
}

const byNum = new Map<string, any>();
for (const c of countriesMeta as any[]) if (c.ccn3) byNum.set(c.ccn3, c);
const byName = new Map<string, any>();
for (const c of countriesMeta as any[]) byName.set(c.name.common, c);

// Natural Earth polygons that have no ISO numeric id in world-atlas.
const NAME_FIX: Record<string, string> = {
  Kosovo: 'XK', 'N. Cyprus': 'CY', Somaliland: 'SO',
};

function continentOf(c: any): string {
  if (c.cca2 === 'XK') return 'Europe';
  if (c.region === 'Americas') return c.subregion === 'South America' ? 'South America' : 'North America';
  if (c.region === 'Antarctic') return 'Antarctica';
  return c.region;
}

const topo = read('world-atlas/countries-50m.json');
const fc: any = feature(topo, topo.objects.countries);
for (const f of fc.features) if (f.geometry) f.geometry = cutAntimeridian(f.geometry);
const feats: any[] = [];
const meta: any[] = [];
const seenMeta = new Set<string>();
for (const f of fc.features) {
  let a2: string | undefined;
  let m = f.id ? byNum.get(String(f.id).padStart(3, '0')) : undefined;
  if (!m && NAME_FIX[f.properties.name]) a2 = NAME_FIX[f.properties.name];
  if (m) a2 = m.cca2;
  if (!a2) { console.warn('unmatched', f.id, f.properties.name); continue; }
  const full = (countriesMeta as any[]).find((c) => c.cca2 === a2);
  const name = full?.name.common ?? f.properties.name;
  const continent = a2 === 'XK' ? 'Europe' : continentOf(full);
  if (continent === 'Antarctica') continue;
  feats.push({ type: 'Feature', properties: { a2, name, continent }, geometry: roundGeom(f.geometry, 3) });
  if (!seenMeta.has(a2)) {
    seenMeta.add(a2);
    meta.push({
      a2, name, continent, subregion: full?.subregion ?? '',
      area: full?.area ?? 0, center: full?.latlng ?? [0, 0], independent: full?.independent ?? false,
    });
  }
}
// bbox per country across all its polygons
const bb = new Map<string, number[]>();
for (const f of feats) {
  const b = bboxOf(f.geometry);
  const o = bb.get(f.properties.a2);
  bb.set(f.properties.a2, o ? [Math.min(o[0], b[0]), Math.min(o[1], b[1]), Math.max(o[2], b[2]), Math.max(o[3], b[3])] : b);
}
// Crude per-country bbox for countries spanning the antimeridian (RU, FJ, US): keep as-is; maps use region polygons anyway.
for (const m of meta) m.bbox = bb.get(m.a2)!.map((n) => round(n, 2));

mkdirSync(new URL('../data/geo', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/geo/countries.json', import.meta.url), JSON.stringify({ type: 'FeatureCollection', features: feats }));
writeFileSync(new URL('../data/geo/countries-meta.json', import.meta.url), JSON.stringify(meta));

// Lighter copy for the browser basemap (2 decimals).
const light = feats.map((f) => ({ type: 'Feature', properties: { a2: f.properties.a2, name: f.properties.name }, geometry: roundGeom(f.geometry, 2) }));
writeFileSync(new URL('../public/geo/countries.json', import.meta.url), JSON.stringify({ type: 'FeatureCollection', features: light }));

// US states (lon/lat version of us-atlas).
const FIPS: Record<string, [string, string]> = {
  '01': ['AL', 'Alabama'], '02': ['AK', 'Alaska'], '04': ['AZ', 'Arizona'], '05': ['AR', 'Arkansas'], '06': ['CA', 'California'],
  '08': ['CO', 'Colorado'], '09': ['CT', 'Connecticut'], '10': ['DE', 'Delaware'], '11': ['DC', 'District of Columbia'],
  '12': ['FL', 'Florida'], '13': ['GA', 'Georgia'], '15': ['HI', 'Hawaii'], '16': ['ID', 'Idaho'], '17': ['IL', 'Illinois'],
  '18': ['IN', 'Indiana'], '19': ['IA', 'Iowa'], '20': ['KS', 'Kansas'], '21': ['KY', 'Kentucky'], '22': ['LA', 'Louisiana'],
  '23': ['ME', 'Maine'], '24': ['MD', 'Maryland'], '25': ['MA', 'Massachusetts'], '26': ['MI', 'Michigan'], '27': ['MN', 'Minnesota'],
  '28': ['MS', 'Mississippi'], '29': ['MO', 'Missouri'], '30': ['MT', 'Montana'], '31': ['NE', 'Nebraska'], '32': ['NV', 'Nevada'],
  '33': ['NH', 'New Hampshire'], '34': ['NJ', 'New Jersey'], '35': ['NM', 'New Mexico'], '36': ['NY', 'New York'],
  '37': ['NC', 'North Carolina'], '38': ['ND', 'North Dakota'], '39': ['OH', 'Ohio'], '40': ['OK', 'Oklahoma'], '41': ['OR', 'Oregon'],
  '42': ['PA', 'Pennsylvania'], '44': ['RI', 'Rhode Island'], '45': ['SC', 'South Carolina'], '46': ['SD', 'South Dakota'],
  '47': ['TN', 'Tennessee'], '48': ['TX', 'Texas'], '49': ['UT', 'Utah'], '50': ['VT', 'Vermont'], '51': ['VA', 'Virginia'],
  '53': ['WA', 'Washington'], '54': ['WV', 'West Virginia'], '55': ['WI', 'Wisconsin'], '56': ['WY', 'Wyoming'],
};
const st = read('us-atlas/states-10m.json');
const sfc: any = feature(st, st.objects.states);
for (const f of sfc.features) if (f.geometry) f.geometry = cutAntimeridian(f.geometry);
const sf: any[] = [];
for (const f of sfc.features) {
  const e = FIPS[String(f.id).padStart(2, '0')];
  if (!e) continue; // territories are excluded from the 50-state set
  sf.push({ type: 'Feature', properties: { code: e[0], name: e[1], bbox: bboxOf(f.geometry).map((n) => round(n, 2)) }, geometry: roundGeom(f.geometry, 3) });
}
writeFileSync(new URL('../data/geo/us-states.json', import.meta.url), JSON.stringify({ type: 'FeatureCollection', features: sf }));
console.log(`countries: ${feats.length} polygons, ${meta.length} countries; us states: ${sf.length}`);
