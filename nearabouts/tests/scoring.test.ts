import { describe, it, expect } from 'vitest';
import { scoreFromDistance, formatDistance, medalFor, perfectRadiusKm, WORLD_SCALE_KM } from '../src/shared/scoring.ts';
import { haversineKm, destination } from '../src/shared/geo.ts';
import { normalizeRules, allowedActions } from '../src/shared/rules.ts';
import { levelFromXp, xpForLevel } from '../src/shared/levels.ts';
import { multiplierFor, BASE_SETTINGS } from '../src/shared/room.ts';

describe('geographic distance', () => {
  it('matches known great-circle distances', () => {
    expect(haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 51.5074, lng: -0.1278 })).toBeCloseTo(343.5, 0); // Paris–London
    expect(haversineKm({ lat: 40.7128, lng: -74.006 }, { lat: 35.6762, lng: 139.6503 })).toBeCloseTo(10849, -1); // NYC–Tokyo
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(20015, -1); // half the equator
    expect(haversineKm({ lat: 10, lng: 179.9 }, { lat: 10, lng: -179.9 })).toBeLessThan(25); // across the antimeridian
  });
  it('destination is the inverse of distance', () => {
    const p = destination({ lat: 10, lng: 20 }, 45, 500);
    expect(haversineKm({ lat: 10, lng: 20 }, p)).toBeCloseTo(500, 3);
  });
});

describe('scoring', () => {
  it('awards 5000 inside the perfect radius and decays with distance', () => {
    expect(scoreFromDistance(0)).toBe(5000);
    expect(scoreFromDistance(perfectRadiusKm(WORLD_SCALE_KM))).toBe(5000);
    const s = [100, 500, 2000, 5000, 10000].map((d) => scoreFromDistance(d));
    expect(s).toEqual([...s].sort((a, b) => b - a));
    expect(s[0]).toBeGreaterThan(4700);
    expect(s[2]).toBeGreaterThan(1500); expect(s[2]).toBeLessThan(2200);
    expect(s[4]).toBeLessThan(60);
  });
  it('is judged relative to the map size', () => {
    // 50 km off is great on the world map but poor on a 30 km city map.
    expect(scoreFromDistance(50, WORLD_SCALE_KM)).toBeGreaterThan(4800);
    expect(scoreFromDistance(50, 30)).toBeLessThan(10);
    expect(scoreFromDistance(1, 30)).toBeGreaterThan(3500);
  });
  it('rejects nonsense', () => {
    expect(scoreFromDistance(NaN)).toBe(0);
    expect(scoreFromDistance(-5)).toBe(0);
  });
  it('five perfect rounds make 25,000', () => {
    expect(5 * scoreFromDistance(0)).toBe(25000);
  });
  it('formats kilometres and miles', () => {
    expect(formatDistance(1234.4, 'km')).toBe('1,234 km');
    expect(formatDistance(1609.344, 'mi')).toBe('1,000 mi');
    expect(formatDistance(0.25, 'km')).toBe('250 m');
    expect(formatDistance(12.345, 'km')).toBe('12.3 km');
  });
  it('medals', () => {
    expect(medalFor(9999)).toBe('none');
    expect(medalFor(10000)).toBe('bronze');
    expect(medalFor(20000)).toBe('gold');
    expect(medalFor(24000)).toBe('platinum');
  });
});

describe('rules', () => {
  it('normalizes and clamps input', () => {
    expect(normalizeRules({ rounds: 99, timeLimit: 3, movement: 'fly' as any })).toEqual({ movement: 'moving', rounds: 20, timeLimit: 10, difficulty: 'normal' });
    expect(normalizeRules({ timeLimit: 0 }).timeLimit).toBe(0);
    expect(normalizeRules({}).rounds).toBe(5);
  });
  it('movement modes gate actions', () => {
    expect(allowedActions('moving')).toEqual({ move: true, pan: true, zoom: true });
    expect(allowedActions('nomove')).toEqual({ move: false, pan: true, zoom: true });
    expect(allowedActions('nmpz')).toEqual({ move: false, pan: false, zoom: false });
  });
  it('duel multipliers increase in later rounds', () => {
    const m = [1, 2, 3, 4, 5, 6].map((r) => multiplierFor(r, BASE_SETTINGS));
    expect(m).toEqual([1, 1, 1, 1.5, 2, 2.5]);
  });
});

describe('levels', () => {
  it('xp and level are consistent', () => {
    expect(levelFromXp(0).level).toBe(1);
    for (const l of [2, 5, 10, 30]) {
      expect(levelFromXp(xpForLevel(l)).level).toBe(l);
      expect(levelFromXp(xpForLevel(l) - 1).level).toBe(l - 1);
    }
  });
});
