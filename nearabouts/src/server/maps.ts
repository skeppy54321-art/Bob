/** Built-in and community maps. */
import { db, now, json, uid } from './db.ts';
import { countries, CONTINENTS, usStates, regionScaleKm, type Region } from './geo.ts';
import { candidatesFor, type MapLike } from './locations.ts';

export interface MapRow {
  id: string; slug: string; name: string; description: string; creator_id: string | null; category: string; kind: string;
  region: string; scale_km: number; visibility: string; builtin: number; featured: number; status: string; plays: number;
  tags: string; created_at: number; updated_at: number;
}

const CITIES: [string, string, number, number, number][] = [
  // slug, name, lat, lng, radius km (city centre coordinates)
  ['london', 'London', 51.5074, -0.1278, 18], ['paris', 'Paris', 48.8566, 2.3522, 12], ['new-york', 'New York City', 40.7128, -74.006, 20],
  ['tokyo', 'Tokyo', 35.6762, 139.6503, 20], ['sydney', 'Sydney', -33.8688, 151.2093, 20], ['rio', 'Rio de Janeiro', -22.9068, -43.1729, 18],
  ['cape-town', 'Cape Town', -33.9249, 18.4241, 15], ['berlin', 'Berlin', 52.52, 13.405, 16], ['rome', 'Rome', 41.9028, 12.4964, 12],
  ['madrid', 'Madrid', 40.4168, -3.7038, 14], ['istanbul', 'Istanbul', 41.0082, 28.9784, 18], ['mumbai', 'Mumbai', 19.076, 72.8777, 18],
  ['mexico-city', 'Mexico City', 19.4326, -99.1332, 18], ['buenos-aires', 'Buenos Aires', -34.6037, -58.3816, 15],
  ['toronto', 'Toronto', 43.6532, -79.3832, 18], ['singapore', 'Singapore', 1.3521, 103.8198, 14], ['seoul', 'Seoul', 37.5665, 126.978, 16],
  ['san-francisco', 'San Francisco Bay', 37.7749, -122.4194, 18], ['amsterdam', 'Amsterdam', 52.3676, 4.9041, 10], ['bangkok', 'Bangkok', 13.7563, 100.5018, 16],
];
const LANDMARKS: [string, number, number][] = [
  ['Eiffel Tower', 48.8584, 2.2945], ['Colosseum', 41.8902, 12.4922], ['Statue of Liberty', 40.6892, -74.0445],
  ['Sydney Opera House', -33.8568, 151.2153], ['Taj Mahal', 27.1751, 78.0421], ['Golden Gate Bridge', 37.8199, -122.4783],
  ['Big Ben', 51.5007, -0.1246], ['Brandenburg Gate', 52.5163, 13.3777], ['Sagrada Família', 41.4036, 2.1744],
  ['Christ the Redeemer', -22.9519, -43.2105], ['Machu Picchu', -13.1631, -72.545], ['Giza Pyramids', 29.9792, 31.1342],
  ['Petra', 30.3285, 35.4444], ['Angkor Wat', 13.4125, 103.867], ['Burj Khalifa', 25.1972, 55.2744],
  ['Tower Bridge', 51.5055, -0.0754], ['Times Square', 40.758, -73.9855], ['Shibuya Crossing', 35.6595, 139.7005],
  ['Neuschwanstein Castle', 47.5576, 10.7498], ['Acropolis of Athens', 37.9715, 23.7257],
];

function upsertBuiltin(slug: string, name: string, description: string, category: string, region: Region, featured = 0, scaleOverride?: number) {
  const existing = db.prepare('SELECT id FROM maps WHERE slug=?').get(slug) as { id: string } | undefined;
  const scale = scaleOverride ?? regionScaleKm(region);
  if (existing) {
    db.prepare('UPDATE maps SET name=?, description=?, category=?, region=?, scale_km=?, featured=? WHERE id=?').run(name, description, category, JSON.stringify(region), scale, featured, existing.id);
    return;
  }
  db.prepare(`INSERT INTO maps(id, slug, name, description, creator_id, category, kind, region, scale_km, visibility, builtin, featured, status, plays, tags, created_at, updated_at)
    VALUES (?,?,?,?,NULL,?,'region',?,?,'public',1,?,'active',0,'',?,?)`).run(uid(), slug, name, description, category, JSON.stringify(region), scale, featured, now(), now());
}

export function seedBuiltinMaps() {
  db.transaction(() => {
    upsertBuiltin('world', 'World', 'Anywhere on Earth with imagery. The classic.', 'world', { world: true }, 1, 18000);
    // Continents spanning the antimeridian or including all of Russia get a hand-set scale.
    const CONTINENT_SCALE: Record<string, number> = { Europe: 6000, Asia: 11000, Africa: 8000, 'North America': 9000, 'South America': 7500, Oceania: 8000 };
    for (const c of CONTINENTS) upsertBuiltin(c.toLowerCase().replace(/ /g, '-'), c, `Every country in ${c}.`, 'continent', { continent: c }, c === 'Europe' ? 1 : 0, CONTINENT_SCALE[c]);
    for (const c of countries) {
      if (c.area < 2000) continue; // micro-states are too small for a whole map
      upsertBuiltin(`country-${c.a2.toLowerCase()}`, c.name, `Explore ${c.name}.`, 'country', { countries: [c.a2] }, ['US', 'FR', 'JP', 'BR'].includes(c.a2) ? 1 : 0,
        ({ US: 5000, RU: 8000, CA: 6000 } as Record<string, number>)[c.a2]);
    }
    upsertBuiltin('us-states', 'United States (50 states)', 'All 50 states plus DC. Used by US state streaks.', 'country', { states: usStates.map((s) => s.code) }, 0, 5000);
    for (const [slug, name, lat, lng, r] of CITIES) upsertBuiltin(`city-${slug}`, name, `Streets within ${r} km of central ${name}.`, 'city', { circles: [{ lat, lng, radiusKm: r }] });
    upsertBuiltin('landmarks', 'Famous Landmarks', 'Within a few hundred metres of world-famous sights.', 'landmark',
      { circles: LANDMARKS.map(([label, lat, lng]) => ({ lat, lng, radiusKm: 0.6, label })) }, 1);
  })();
}

export function mapLike(m: MapRow): MapLike {
  return { id: m.id, kind: m.kind, region: json<Region>(m.region, {}), scale_km: m.scale_km };
}

export function getMap(idOrSlug: string): MapRow | undefined {
  return db.prepare("SELECT * FROM maps WHERE (id=? OR slug=?) AND status='active'").get(idOrSlug, idOrSlug) as MapRow | undefined;
}

let countCache: { at: number; counts: Map<string, number> } | null = null;
/** Playable locations per map (cached briefly; computing it touches every map). */
export function playableCount(m: MapRow): number {
  if (!countCache || now() - countCache.at > 60_000) countCache = { at: now(), counts: new Map() };
  const hit = countCache.counts.get(m.id);
  if (hit !== undefined) return hit;
  const n = candidatesFor(mapLike(m)).length;
  countCache.counts.set(m.id, n);
  return n;
}
export const invalidateCounts = () => { countCache = null; };

export function mapSummary(m: MapRow, viewerId?: string, viewerIsAdmin = false) {
  const fav = viewerId ? !!db.prepare('SELECT 1 FROM map_favorites WHERE user_id=? AND map_id=?').get(viewerId, m.id) : false;
  const favorites = (db.prepare('SELECT COUNT(*) n FROM map_favorites WHERE map_id=?').get(m.id) as any).n;
  const creator = m.creator_id ? (db.prepare('SELECT username FROM users WHERE id=?').get(m.creator_id) as any)?.username ?? null : null;
  const region = json<Region>(m.region, {});
  return {
    id: m.id, slug: m.slug, name: m.name, description: m.description, category: m.category, kind: m.kind,
    creator, builtin: !!m.builtin, featured: !!m.featured, visibility: m.visibility, plays: m.plays, favorites,
    favorited: fav, scaleKm: Math.round(m.scale_km), playable: playableCount(m), tags: m.tags ? m.tags.split(',') : [],
    countryCode: region.countries?.length === 1 ? region.countries[0] : null,
    updatedAt: m.updated_at, isOwner: (!!viewerId && viewerId === m.creator_id) || (viewerIsAdmin && !m.builtin),
  };
}
