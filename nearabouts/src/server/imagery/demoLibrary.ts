/**
 * DEMO LOCATIONS — illustrative only.
 *
 * Used when no live imagery provider is configured. Each entry pairs a real coordinate with a
 * *procedurally drawn* scene (biome, road paint, driving side, sun position) generated in the
 * browser by our own code. These are NOT photographs of the place; the UI labels every demo
 * round as "Demo scene". They exist so the full game flow can be played and tested without any
 * API keys. Coordinates were chosen inside the stated country and are checked against the
 * Natural Earth boundaries by tests/demo-library.test.ts.
 */
export type Biome =
  | 'desert' | 'dunes' | 'farmland' | 'forest' | 'boreal' | 'jungle' | 'savanna' | 'alpine'
  | 'tundra' | 'steppe' | 'mediterranean' | 'city' | 'coast' | 'outback' | 'ice';

import { hashString } from '../../shared/geo.ts';

export interface DemoEntry { id: string; cc: string; state?: string; lat: number; lng: number; biome: Biome; line: 'white' | 'yellow' | 'none'; side: 'L' | 'R'; difficulty: 1 | 2 | 3 }

const e = (id: string, cc: string, lat: number, lng: number, biome: Biome, line: DemoEntry['line'], side: DemoEntry['side'], difficulty: DemoEntry['difficulty'] = 2, state?: string): DemoEntry =>
  ({ id: `demo-${id}`, cc, lat, lng, biome, line, side, difficulty, state });

export const DEMO_LIBRARY: DemoEntry[] = [
  // North America
  e('us-nv', 'US', 39.5, -117.0, 'desert', 'yellow', 'R', 1, 'NV'),
  e('us-ia', 'US', 42.0, -93.5, 'farmland', 'yellow', 'R', 1, 'IA'),
  e('us-co', 'US', 39.1, -106.4, 'alpine', 'yellow', 'R', 1, 'CO'),
  e('us-ny', 'US', 40.73, -73.85, 'city', 'yellow', 'R', 1, 'NY'),
  e('us-fl', 'US', 27.5, -81.4, 'coast', 'yellow', 'R', 1, 'FL'),
  e('us-mt', 'US', 47.0, -109.0, 'steppe', 'yellow', 'R', 2, 'MT'),
  e('us-or', 'US', 44.0, -122.2, 'forest', 'yellow', 'R', 2, 'OR'),
  e('us-tx', 'US', 31.0, -100.0, 'savanna', 'yellow', 'R', 2, 'TX'),
  e('us-ak', 'US', 64.8, -147.7, 'boreal', 'yellow', 'R', 2, 'AK'),
  e('ca-ab', 'CA', 52.0, -113.0, 'farmland', 'yellow', 'R', 1),
  e('ca-qc', 'CA', 48.5, -72.5, 'boreal', 'yellow', 'R', 2),
  e('mx-yuc', 'MX', 20.5, -89.0, 'jungle', 'white', 'R', 2),
  e('mx-son', 'MX', 29.5, -111.0, 'desert', 'yellow', 'R', 2),
  e('gl', 'GL', 72.0, -40.0, 'ice', 'none', 'R', 3),
  e('cr', 'CR', 10.2, -84.2, 'jungle', 'yellow', 'R', 3),
  // South America
  e('br-am', 'BR', -3.5, -60.0, 'jungle', 'yellow', 'R', 2),
  e('br-sp', 'BR', -23.55, -46.63, 'city', 'yellow', 'R', 1),
  e('ar-pat', 'AR', -45.0, -69.0, 'steppe', 'white', 'R', 2),
  e('ar-pam', 'AR', -34.5, -62.0, 'farmland', 'white', 'R', 2),
  e('cl-ata', 'CL', -23.5, -69.0, 'desert', 'white', 'R', 2),
  e('pe-and', 'PE', -13.5, -72.0, 'alpine', 'yellow', 'R', 2),
  e('co-bog', 'CO', 4.65, -74.1, 'city', 'yellow', 'R', 2),
  // Europe
  e('gb-lon', 'GB', 51.51, -0.12, 'city', 'white', 'L', 1),
  e('gb-sco', 'GB', 57.3, -4.5, 'tundra', 'white', 'L', 2),
  e('fr-cen', 'FR', 47.3, 2.5, 'farmland', 'white', 'R', 1),
  e('fr-pro', 'FR', 43.8, 5.8, 'mediterranean', 'white', 'R', 2),
  e('de-bw', 'DE', 48.2, 8.2, 'forest', 'white', 'R', 1),
  e('es-mur', 'ES', 38.0, -1.6, 'mediterranean', 'white', 'R', 2),
  e('it-tos', 'IT', 43.4, 11.2, 'farmland', 'white', 'R', 1),
  e('is', 'IS', 64.6, -18.5, 'tundra', 'yellow', 'R', 2),
  e('no-fj', 'NO', 61.5, 8.5, 'alpine', 'yellow', 'R', 2),
  e('se', 'SE', 62.0, 15.5, 'boreal', 'white', 'R', 2),
  e('fi', 'FI', 63.5, 26.5, 'boreal', 'white', 'R', 2),
  e('pl', 'PL', 52.0, 19.5, 'farmland', 'white', 'R', 2),
  e('ru-sib', 'RU', 56.0, 92.0, 'boreal', 'white', 'R', 2),
  e('ru-msk', 'RU', 55.75, 37.62, 'city', 'white', 'R', 1),
  e('gr', 'GR', 37.6, 22.4, 'mediterranean', 'white', 'R', 2),
  e('tr', 'TR', 38.6, 34.8, 'steppe', 'white', 'R', 2),
  // Africa
  e('eg', 'EG', 27.0, 28.0, 'desert', 'none', 'R', 2),
  e('ma', 'MA', 31.1, -7.9, 'alpine', 'white', 'R', 2),
  e('za-kr', 'ZA', -24.0, 31.5, 'savanna', 'yellow', 'L', 2),
  e('za-cape', 'ZA', -33.9, 19.5, 'mediterranean', 'yellow', 'L', 2),
  e('ke', 'KE', -2.0, 37.5, 'savanna', 'white', 'L', 2),
  e('ng', 'NG', 6.5, 3.4, 'city', 'white', 'R', 2),
  e('et', 'ET', 9.0, 38.7, 'alpine', 'none', 'R', 3),
  e('cd', 'CD', -0.5, 23.0, 'jungle', 'none', 'R', 3),
  e('na', 'NA', -24.7, 15.3, 'dunes', 'none', 'L', 2),
  e('mg', 'MG', -19.0, 47.0, 'savanna', 'none', 'R', 3),
  // Asia
  e('sa', 'SA', 24.0, 45.0, 'dunes', 'white', 'R', 2),
  e('ae', 'AE', 25.2, 55.3, 'city', 'white', 'R', 1),
  e('in-raj', 'IN', 27.0, 72.0, 'desert', 'white', 'L', 2),
  e('in-mum', 'IN', 19.07, 72.88, 'city', 'white', 'L', 1),
  e('np', 'NP', 28.2, 84.0, 'alpine', 'none', 'L', 3),
  e('cn-gobi', 'CN', 41.0, 100.0, 'steppe', 'white', 'R', 2),
  e('cn-sh', 'CN', 31.23, 121.47, 'city', 'white', 'R', 1),
  e('jp-tyo', 'JP', 35.68, 139.7, 'city', 'white', 'L', 1),
  e('jp-hok', 'JP', 43.5, 142.8, 'boreal', 'white', 'L', 2),
  e('kr', 'KR', 36.5, 127.8, 'farmland', 'yellow', 'R', 2),
  e('th', 'TH', 18.8, 99.0, 'jungle', 'white', 'L', 2),
  e('id-java', 'ID', -7.5, 110.5, 'jungle', 'white', 'L', 2),
  e('mn', 'MN', 47.0, 104.0, 'steppe', 'none', 'R', 3),
  e('kz', 'KZ', 48.0, 68.0, 'steppe', 'white', 'R', 3),
  // Oceania
  e('au-out', 'AU', -25.0, 134.0, 'outback', 'white', 'L', 1),
  e('au-syd', 'AU', -33.87, 151.2, 'city', 'white', 'L', 1),
  e('nz-alps', 'NZ', -43.6, 170.2, 'alpine', 'white', 'L', 2),
  e('nz-ni', 'NZ', -38.0, 175.7, 'farmland', 'white', 'L', 2),
  e('pg', 'PG', -6.0, 145.0, 'jungle', 'none', 'L', 3),
];

/** Sun elevation/azimuth hint derived from latitude (sun is to the south in the north and vice versa). */
export function demoSun(lat: number): { elev: number; az: number } {
  const elev = Math.max(12, Math.min(78, 82 - Math.abs(lat - 8) * 0.95));
  return { elev, az: lat >= 8 ? 180 : 0 };
}

/** Opaque panorama id so the id sent to browsers does not reveal the place (e.g. not "demo-kz"). */
export const demoPanoId = (id: string) => `d${hashString('nearabouts-demo:' + id).toString(36)}`;
