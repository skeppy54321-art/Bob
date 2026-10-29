import { describe, it, expect } from 'vitest';
import { countryAt, stateAt, regionContains, randomPointInRegion, regionScaleKm } from '../src/server/geo.ts';
import { DEMO_LIBRARY, demoPanoId } from '../src/server/imagery/demoLibrary.ts';
import { pickDistributed, type LocRow } from '../src/server/locations.ts';
import { mulberry32, haversineKm } from '../src/shared/geo.ts';

describe('boundaries', () => {
  it('finds countries for well-known points', () => {
    expect(countryAt({ lat: 48.8566, lng: 2.3522 })).toBe('FR');
    expect(countryAt({ lat: -33.8688, lng: 151.2093 })).toBe('AU');
    expect(countryAt({ lat: 35.6762, lng: 139.6503 })).toBe('JP');
    expect(countryAt({ lat: -1.2921, lng: 36.8219 })).toBe('KE');
    expect(countryAt({ lat: 30, lng: -40 })).toBeNull(); // Atlantic
  });
  it('finds US states', () => {
    expect(stateAt({ lat: 34.05, lng: -118.24 })).toBe('CA');
    expect(stateAt({ lat: 41.88, lng: -87.63 })).toBe('IL');
    expect(stateAt({ lat: 48.85, lng: 2.35 })).toBeNull();
  });
  it('samples points inside regions', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const p = randomPointInRegion({ countries: ['IT'] }, rng)!;
      expect(countryAt(p)).toBe('IT');
    }
    const c = { lat: 51.5, lng: -0.12, radiusKm: 10 };
    for (let i = 0; i < 20; i++) expect(regionContains({ circles: [c] }, randomPointInRegion({ circles: [c] }, rng)!)).toBe(true);
  });
  it('gives small maps a small scale', () => {
    expect(regionScaleKm({ countries: ['NL'] })).toBeLessThan(600);
    expect(regionScaleKm({ circles: [{ lat: 0, lng: 0, radiusKm: 10 }] })).toBeLessThan(40);
  });
});

describe('demo library', () => {
  it('every demo coordinate lies in the country (and state) it claims', () => {
    for (const d of DEMO_LIBRARY) {
      expect(countryAt(d), d.id).toBe(d.cc);
      if (d.state) expect(stateAt(d), d.id).toBe(d.state);
    }
  });
  it('panorama ids are opaque', () => {
    for (const d of DEMO_LIBRARY) expect(demoPanoId(d.id)).not.toContain(d.id.slice(5));
  });
});

describe('distributed picking', () => {
  const mk = (id: string, country: string, lat: number, lng: number): LocRow => ({ id, provider: 'demo', pano_id: id, lat, lng, heading: 0, country, subdivision: null, difficulty: 2, status: 'demo', attribution: '{}', meta: '{}' });
  // 40 locations clustered in one country + 1 each in 4 others.
  const cands = [...Array.from({ length: 40 }, (_, i) => mk(`fr${i}`, 'FR', 46 + i * 0.01, 2)), mk('jp', 'JP', 35, 139), mk('br', 'BR', -10, -50), mk('au', 'AU', -25, 134), mk('us', 'US', 39, -100)];
  it('never repeats and spreads across countries', () => {
    let franceHeavy = 0;
    for (let s = 1; s <= 50; s++) {
      const picks = pickDistributed(cands, 5, { rng: mulberry32(s), scaleKm: 18000 });
      expect(new Set(picks.map((p) => p.id)).size).toBe(5);
      if (picks.filter((p) => p.country === 'FR').length > 1) franceHeavy++;
    }
    expect(franceHeavy).toBe(0); // 5 countries available -> at most one per country
  });
  it('respects exclusions', () => {
    const picks = pickDistributed(cands, 3, { rng: mulberry32(3), scaleKm: 18000, exclude: new Set(['jp', 'br', 'au', 'us']) });
    expect(picks.every((p) => p.country === 'FR')).toBe(true);
    expect(haversineKm(picks[0], picks[1])).toBeGreaterThan(0);
  });
});
