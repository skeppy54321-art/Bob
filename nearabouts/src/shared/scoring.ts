/**
 * Scoring
 * -------
 * score(d) = 5000                                   if d <= r0
 *          = round(5000 * exp(-K * (d - r0) / S))   otherwise
 *
 *   d   great-circle distance between guess and answer (km)
 *   S   the map's "scale" in km. World = 18 000 km. For other maps it is the great-circle
 *       diagonal of the map's bounding box (so a small regional map is judged on its own size,
 *       not the planet's), clamped to [MIN_SCALE_KM, WORLD_SCALE_KM].
 *   r0  "perfect radius" = S * 0.0002 (about 3.6 km on the world map, 200 m on a 1000 km
 *       country, a few metres on a city map).
 *   K   decay constant = 9
 *
 * Examples on the world map (S = 18000): 100 km -> 4,777, 500 km -> 3,894, 2,000 km -> 1,840,
 * 5,000 km -> 408, 10,000 km -> 33. Five rounds therefore cap at 25,000 points.
 */
export const MAX_ROUND_SCORE = 5000;
export const WORLD_SCALE_KM = 18000;
export const MIN_SCALE_KM = 2;
const DECAY_K = 9;
const PERFECT_FRACTION = 0.0002;

export function clampScale(scaleKm: number): number {
  if (!Number.isFinite(scaleKm)) return WORLD_SCALE_KM;
  return Math.min(WORLD_SCALE_KM, Math.max(MIN_SCALE_KM, scaleKm));
}

export function perfectRadiusKm(scaleKm: number): number {
  return clampScale(scaleKm) * PERFECT_FRACTION;
}

export function scoreFromDistance(distanceKm: number, scaleKm: number = WORLD_SCALE_KM): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  const s = clampScale(scaleKm);
  const r0 = s * PERFECT_FRACTION;
  if (distanceKm <= r0) return MAX_ROUND_SCORE;
  return Math.max(0, Math.round(MAX_ROUND_SCORE * Math.exp((-DECAY_K * (distanceKm - r0)) / s)));
}

export const KM_PER_MILE = 1.609344;
export type Units = 'km' | 'mi';
export function formatDistance(km: number, units: Units = 'km'): string {
  const v = units === 'mi' ? km / KM_PER_MILE : km;
  const u = units === 'mi' ? 'mi' : 'km';
  if (v < 1) return `${Math.round(units === 'mi' ? v * 5280 : v * 1000).toLocaleString('en-US')} ${units === 'mi' ? 'ft' : 'm'}`;
  if (v < 100) return `${v.toFixed(1)} ${u}`;
  return `${Math.round(v).toLocaleString('en-US')} ${u}`;
}

export type Medal = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';
/** Explorer medals are earned on a 5-round game (max 25,000). */
export const MEDAL_THRESHOLDS: Record<Exclude<Medal, 'none'>, number> = { bronze: 10000, silver: 15000, gold: 20000, platinum: 23500 };
export function medalFor(score: number): Medal {
  if (score >= MEDAL_THRESHOLDS.platinum) return 'platinum';
  if (score >= MEDAL_THRESHOLDS.gold) return 'gold';
  if (score >= MEDAL_THRESHOLDS.silver) return 'silver';
  if (score >= MEDAL_THRESHOLDS.bronze) return 'bronze';
  return 'none';
}
const MEDAL_ORDER: Medal[] = ['none', 'bronze', 'silver', 'gold', 'platinum'];
export const betterMedal = (a: Medal, b: Medal): Medal => (MEDAL_ORDER.indexOf(a) >= MEDAL_ORDER.indexOf(b) ? a : b);
