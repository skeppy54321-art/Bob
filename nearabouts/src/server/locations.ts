/**
 * Location selection.
 * - Only locations whose imagery was confirmed by the active provider are playable ('verified'),
 *   or, in demo mode, the illustrative demo scenes ('demo').
 * - Rounds are spread out: each candidate is weighted by 1/sqrt(#candidates in its country), a
 *   per-country cap applies, and picks must be a minimum distance apart (relaxed only if needed).
 * - Locations never repeat within one game / match.
 */
import { db, now, json } from './db.ts';
import { imagery, providers } from './imagery/index.ts';
import type { PanoRef } from './imagery/provider.ts';
import { DEMO_LIBRARY } from './imagery/demoLibrary.ts';
import { demoRef } from './imagery/demo.ts';
import { countryAt, stateAt, regionContains, regionCountries, randomPointInRegion, type Region } from './geo.ts';
import { haversineKm, mulberry32 } from '../shared/geo.ts';
import type { Difficulty } from '../shared/rules.ts';

export interface LocRow {
  id: string; provider: string; pano_id: string; lat: number; lng: number; heading: number;
  country: string | null; subdivision: string | null; difficulty: number; status: string; attribution: string; meta: string;
}
export interface MapLike { id: string; kind: string; region: Region; scale_km: number }

export class NotEnoughLocationsError extends Error {
  constructor(public available: number, public needed: number) {
    super(`This map has ${available} playable location${available === 1 ? '' : 's'} right now; ${needed} needed.`);
  }
}

export const playableStatus = () => (imagery.live ? 'verified' : 'demo');

export function seedDemoLocations() {
  const ins = db.prepare(`INSERT INTO locations(id, provider, pano_id, lat, lng, heading, country, subdivision, difficulty, status, source, attribution, meta, verified_at, created_at)
    VALUES (@id,'demo',@pano,@lat,@lng,0,@cc,@state,@difficulty,'demo','demo-library',@attr,@meta,NULL,@t)
    ON CONFLICT(id) DO UPDATE SET pano_id=excluded.pano_id, lat=excluded.lat, lng=excluded.lng, country=excluded.country, subdivision=excluded.subdivision, difficulty=excluded.difficulty, meta=excluded.meta`);
  db.transaction(() => {
    for (const d of DEMO_LIBRARY) {
      const ref = demoRef(d.id)!;
      ins.run({ id: d.id, pano: ref.panoId, lat: d.lat, lng: d.lng, cc: d.cc, state: d.state ?? null, difficulty: d.difficulty, attr: JSON.stringify(ref.attribution), meta: JSON.stringify(ref.meta), t: now() });
    }
  })();
}

/** Insert a provider-verified location (idempotent). */
export function upsertVerified(ref: PanoRef, source: string): LocRow {
  const id = `${ref.provider}:${ref.panoId}`;
  db.prepare(`INSERT INTO locations(id, provider, pano_id, lat, lng, heading, country, subdivision, difficulty, status, source, attribution, meta, verified_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,2,'verified',?,?,?,?,?)
    ON CONFLICT(provider, pano_id) DO UPDATE SET status='verified', verified_at=excluded.verified_at`).run(
    id, ref.provider, ref.panoId, ref.lat, ref.lng, ref.heading, countryAt(ref), stateAt(ref), source,
    JSON.stringify(ref.attribution), JSON.stringify(ref.meta ?? {}), now(), now());
  return db.prepare('SELECT * FROM locations WHERE provider=? AND pano_id=?').get(ref.provider, ref.panoId) as LocRow;
}

export function getLocation(id: string): LocRow | undefined {
  return db.prepare('SELECT * FROM locations WHERE id=?').get(id) as LocRow | undefined;
}

/** Playable candidates for a map from the local pool. */
export function candidatesFor(map: MapLike): LocRow[] {
  const status = playableStatus();
  if (map.kind === 'explicit') {
    return db.prepare(`SELECT l.*, COALESCE(ml.heading, l.heading) AS heading FROM map_locations ml JOIN locations l ON l.id = ml.location_id
      WHERE ml.map_id=? AND l.provider=? AND l.status=?`).all(map.id, imagery.id, status) as LocRow[];
  }
  const ccs = regionCountries(map.region);
  let rows: LocRow[];
  if (ccs) {
    const ph = ccs.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM locations WHERE provider=? AND status=? AND country IN (${ph})`).all(imagery.id, status, ...ccs) as LocRow[];
  } else {
    rows = db.prepare('SELECT * FROM locations WHERE provider=? AND status=?').all(imagery.id, status) as LocRow[];
  }
  if (map.region.world) return rows.filter((r) => r.country);
  if (map.region.states?.length) return rows.filter((r) => r.subdivision && map.region.states!.includes(r.subdivision));
  if (map.region.circles?.length) return rows.filter((r) => regionContains(map.region, r));
  return rows;
}

const DIFF_WEIGHT: Record<Difficulty, Record<number, number>> = {
  easy: { 1: 3, 2: 1.2, 3: 0.25 },
  normal: { 1: 1, 2: 1, 3: 1 },
  hard: { 1: 0.35, 2: 1, 3: 2.5 },
};

export function pickDistributed(cands: LocRow[], n: number, opts: { rng: () => number; scaleKm: number; exclude?: Set<string>; difficulty?: Difficulty; recent?: LatLngLike[] }): LocRow[] {
  const pool = cands.filter((c) => !opts.exclude?.has(c.id));
  const groupKey = (c: LocRow) => c.country ?? `${Math.round(c.lat)}:${Math.round(c.lng)}`;
  const groupSize = new Map<string, number>();
  for (const c of pool) groupSize.set(groupKey(c), (groupSize.get(groupKey(c)) ?? 0) + 1);
  const dw = DIFF_WEIGHT[opts.difficulty ?? 'normal'];
  const weight = (c: LocRow) => (dw[c.difficulty] ?? 1) / Math.sqrt(groupSize.get(groupKey(c))!);
  const groups = groupSize.size;
  // At most ceil(n / #countries) picks per country, e.g. 5 rounds over 3 countries -> max 2 each.
  const cap = Math.ceil(n / Math.max(1, Math.min(groups, n)));

  const chosen: LocRow[] = [];
  const perGroup = new Map<string, number>();
  let minSep = opts.scaleKm * 0.03;
  const recent = opts.recent ?? [];
  while (chosen.length < n) {
    const ok = pool.filter((c) => !chosen.includes(c)
      && (perGroup.get(groupKey(c)) ?? 0) < cap
      && chosen.every((x) => haversineKm(x, c) >= minSep)
      && recent.every((x) => haversineKm(x, c) >= minSep));
    if (!ok.length) {
      if (minSep > 0.01) { minSep /= 2; continue; }
      const rest = pool.filter((c) => !chosen.includes(c));
      if (!rest.length) break;
      ok.push(...rest);
    }
    const total = ok.reduce((a, c) => a + weight(c), 0);
    let x = opts.rng() * total;
    let pick = ok[ok.length - 1];
    for (const c of ok) { x -= weight(c); if (x <= 0) { pick = c; break; } }
    chosen.push(pick);
    perGroup.set(groupKey(pick), (perGroup.get(groupKey(pick)) ?? 0) + 1);
  }
  return chosen;
}
type LatLngLike = { lat: number; lng: number };

const sampling = new Map<string, Promise<void>>();
/**
 * With a live provider, grow the verified pool for a region map by probing random points.
 * Bounded by attempts and by the provider's daily budget.
 */
export async function growPool(map: MapLike, target: number, maxAttempts = 40): Promise<void> {
  if (!imagery.live || map.kind === 'explicit') return;
  const key = map.id;
  if (sampling.has(key)) return sampling.get(key);
  const job = (async () => {
    const rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
    let have = candidatesFor(map).length;
    for (let i = 0; i < maxAttempts && have < target; i++) {
      const p = randomPointInRegion(map.region, rng);
      if (!p) continue;
      const radius = Math.min(5000, Math.max(150, map.scale_km * 1000 * 0.002));
      try {
        const ref = await imagery.findNear(p.lat, p.lng, radius);
        if (ref && regionContains(map.region, ref)) { upsertVerified(ref, 'sampled'); have++; }
      } catch (err) {
        console.warn('[imagery] lookup failed:', (err as Error).message);
        break;
      }
    }
  })().finally(() => sampling.delete(key));
  sampling.set(key, job);
  return job;
}

/** Pick n locations for a game, growing the pool first when a live provider is active. */
export async function pickLocations(map: MapLike, n: number, opts: { seed?: number; exclude?: Set<string>; difficulty?: Difficulty } = {}): Promise<LocRow[]> {
  let cands = candidatesFor(map);
  if (imagery.live && cands.length < n * 3) { await growPool(map, n * 3); cands = candidatesFor(map); }
  const usable = cands.filter((c) => !opts.exclude?.has(c.id));
  if (usable.length < n) throw new NotEnoughLocationsError(usable.length, n);
  const rng = mulberry32(opts.seed ?? ((Math.random() * 2 ** 32) >>> 0));
  return pickDistributed(cands, n, { rng, scaleKm: map.scale_km, exclude: opts.exclude, difficulty: opts.difficulty });
}

/** One extra location (streaks, replacements). Returns null when the pool is exhausted. */
export async function pickOne(map: MapLike, exclude: Set<string>, difficulty?: Difficulty, recent: LatLngLike[] = []): Promise<LocRow | null> {
  let cands = candidatesFor(map).filter((c) => !exclude.has(c.id));
  if (imagery.live && cands.length < 5) { await growPool(map, exclude.size + 10); cands = candidatesFor(map).filter((c) => !exclude.has(c.id)); }
  if (!cands.length) return null;
  return pickDistributed(cands, 1, { rng: Math.random, scaleKm: map.scale_km, difficulty, recent: recent.slice(-3) })[0] ?? null;
}

/** Check a location's imagery still exists; mark it dead if not. */
export async function revalidate(loc: LocRow): Promise<boolean> {
  const p = providers[loc.provider];
  if (!p) return false;
  const ok = await p.validate(loc.pano_id).catch(() => true);
  if (!ok) db.prepare("UPDATE locations SET status='dead' WHERE id=?").run(loc.id);
  else if (loc.status === 'verified') db.prepare('UPDATE locations SET verified_at=? WHERE id=?').run(now(), loc.id);
  return ok;
}

/**
 * What the browser receives for a round. Contains what the viewer needs and nothing more: no
 * country, no answer coordinates. (Live provider SDKs can still reveal the position — see
 * docs/SECURITY.md.)
 */
export function panoPayload(loc: LocRow) {
  const meta = json<Record<string, unknown>>(loc.meta, {});
  return {
    provider: loc.provider,
    panoId: loc.pano_id,
    heading: loc.heading,
    attribution: json(loc.attribution, { text: '' }),
    demo: loc.provider === 'demo',
    ...(loc.provider === 'demo' ? { scene: meta } : {}),
  };
}
export type PanoPayload = ReturnType<typeof panoPayload>;
