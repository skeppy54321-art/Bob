/** XP -> level. Cumulative XP needed to reach level L is 100 * (L-1)^1.6. */
export function xpForLevel(level: number): number {
  return Math.round(100 * Math.max(0, level - 1) ** 1.6);
}
export function levelFromXp(xp: number): { level: number; current: number; next: number; progress: number } {
  let level = Math.floor(Math.pow(Math.max(0, xp) / 100, 1 / 1.6)) + 1;
  while (xpForLevel(level + 1) <= xp) level++;
  while (level > 1 && xpForLevel(level) > xp) level--;
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, current: xp - cur, next: next - cur, progress: (xp - cur) / (next - cur) };
}
