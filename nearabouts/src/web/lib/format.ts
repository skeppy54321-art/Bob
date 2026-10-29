import { formatDistance as fd, type Units } from '../../shared/scoring.ts';
export const formatDistance = (km: number | null | undefined, units: Units) => (km === null || km === undefined ? '—' : fd(km, units));
export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'));
export function timeAgo(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
export function flag(cc: string | null | undefined): string {
  if (!cc || cc.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
export const MODE_NAMES: Record<string, string> = {
  classic: 'Classic', quick: 'Quick play', daily: 'Daily challenge', streak_country: 'Country streak', streak_state: 'US state streak',
  explorer: 'Explorer', challenge: 'Challenge', duel: 'Duel', teamduel: 'Team duel', br_countries: 'BR: Countries', br_distance: 'BR: Distance', party: 'Party classic',
};
export const modeName = (m: string) => MODE_NAMES[m] ?? m;
export const fmtTimeLimit = (s: number) => (s === 0 ? 'No time limit' : s < 60 ? `${s}s` : s % 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s / 60} min`);
