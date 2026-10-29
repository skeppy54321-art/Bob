/** XP, levels and achievements. */
import { db, now } from './db.ts';
import { levelFromXp } from '../shared/levels.ts';

export interface AchievementDef { key: string; name: string; description: string; icon: string }
export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'first_game', name: 'First Steps', description: 'Finish your first game.', icon: '👣' },
  { key: 'perfect_round', name: 'Bullseye', description: 'Score a perfect 5,000 in a round.', icon: '🎯' },
  { key: 'score_20k', name: 'Sharp Eye', description: 'Score 20,000+ in a 5-round game.', icon: '🦅' },
  { key: 'score_24k', name: 'Cartographer', description: 'Score 24,000+ in a 5-round game.', icon: '🗺️' },
  { key: 'daily_1', name: 'Morning Ritual', description: 'Complete a daily challenge.', icon: '☀️' },
  { key: 'daily_streak_7', name: 'Habit Formed', description: 'Complete the daily challenge 7 days in a row.', icon: '📅' },
  { key: 'streak_5', name: 'On a Roll', description: 'Reach a country streak of 5.', icon: '🔥' },
  { key: 'streak_15', name: 'Unstoppable', description: 'Reach a country streak of 15.', icon: '☄️' },
  { key: 'state_streak_5', name: 'Road Tripper', description: 'Reach a US state streak of 5.', icon: '🚗' },
  { key: 'explorer_gold', name: 'Golden Explorer', description: 'Earn a gold medal in Explorer.', icon: '🥇' },
  { key: 'explorer_5', name: 'Passport Stamps', description: 'Earn Explorer medals in 5 countries.', icon: '🛂' },
  { key: 'globetrotter', name: 'Globetrotter', description: 'Play rounds located in 25 different countries.', icon: '🌍' },
  { key: 'duel_win', name: 'Duelist', description: 'Win a duel.', icon: '⚔️' },
  { key: 'team_win', name: 'Better Together', description: 'Win a team duel.', icon: '🤝' },
  { key: 'br_win', name: 'Last One Standing', description: 'Win a Battle Royale.', icon: '👑' },
  { key: 'party_win', name: 'Life of the Party', description: 'Win a party classic game.', icon: '🎉' },
  { key: 'friend', name: 'Travel Buddy', description: 'Add a friend.', icon: '🫂' },
  { key: 'map_maker', name: 'Map Maker', description: 'Publish a map with at least 5 locations.', icon: '📍' },
  { key: 'games_50', name: 'Seasoned Traveller', description: 'Finish 50 games.', icon: '🧳' },
  { key: 'level_10', name: 'Frequent Flyer', description: 'Reach level 10.', icon: '✈️' },
];

const one = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as any) ?? {};

function check(userId: string, key: string): boolean {
  switch (key) {
    case 'first_game': return one("SELECT COUNT(*) n FROM games WHERE user_id=? AND status='finished'", userId).n > 0 || one('SELECT COUNT(*) n FROM match_players WHERE user_id=?', userId).n > 0;
    case 'perfect_round': return one("SELECT COUNT(*) n FROM game_rounds r JOIN games g ON g.id=r.game_id WHERE g.user_id=? AND r.score>=5000", userId).n > 0;
    case 'score_20k': return one("SELECT MAX(total_score) m FROM games WHERE user_id=? AND status='finished' AND round_count=5 AND mode IN ('classic','daily','explorer','challenge')", userId).m >= 20000;
    case 'score_24k': return one("SELECT MAX(total_score) m FROM games WHERE user_id=? AND status='finished' AND round_count=5 AND mode IN ('classic','daily','explorer','challenge')", userId).m >= 24000;
    case 'daily_1': return one("SELECT COUNT(*) n FROM games WHERE user_id=? AND mode='daily' AND status='finished'", userId).n > 0;
    case 'daily_streak_7': return dailyStreak(userId).best >= 7;
    case 'streak_5': return one("SELECT MAX(total_score) m FROM games WHERE user_id=? AND mode='streak_country'", userId).m >= 5;
    case 'streak_15': return one("SELECT MAX(total_score) m FROM games WHERE user_id=? AND mode='streak_country'", userId).m >= 15;
    case 'state_streak_5': return one("SELECT MAX(total_score) m FROM games WHERE user_id=? AND mode='streak_state'", userId).m >= 5;
    case 'explorer_gold': return one("SELECT COUNT(*) n FROM explorer_progress WHERE user_id=? AND medal IN ('gold','platinum')", userId).n > 0;
    case 'explorer_5': return one("SELECT COUNT(*) n FROM explorer_progress WHERE user_id=? AND medal!='none'", userId).n >= 5;
    case 'globetrotter': return one("SELECT COUNT(DISTINCT l.country) n FROM game_rounds r JOIN games g ON g.id=r.game_id JOIN locations l ON l.id=r.location_id WHERE g.user_id=? AND r.status='done'", userId).n >= 25;
    case 'duel_win': return one("SELECT COUNT(*) n FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.user_id=? AND m.mode='duel' AND p.outcome='win'", userId).n > 0;
    case 'team_win': return one("SELECT COUNT(*) n FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.user_id=? AND m.mode='teamduel' AND p.outcome='win'", userId).n > 0;
    case 'br_win': return one("SELECT COUNT(*) n FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.user_id=? AND m.mode LIKE 'br_%' AND p.outcome='win'", userId).n > 0;
    case 'party_win': return one("SELECT COUNT(*) n FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.user_id=? AND m.mode='party' AND p.outcome='win'", userId).n > 0;
    case 'friend': return one("SELECT COUNT(*) n FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted'", userId, userId).n > 0;
    case 'map_maker': return one("SELECT COUNT(*) n FROM maps m WHERE m.creator_id=? AND m.visibility='public' AND (SELECT COUNT(*) FROM map_locations ml WHERE ml.map_id=m.id)>=5", userId).n > 0;
    case 'games_50': return one("SELECT COUNT(*) n FROM games WHERE user_id=? AND status='finished'", userId).n + one('SELECT COUNT(*) n FROM match_players WHERE user_id=?', userId).n >= 50;
    case 'level_10': return levelFromXp(one('SELECT xp FROM users WHERE id=?', userId).xp ?? 0).level >= 10;
  }
  return false;
}

/** Evaluate every locked achievement for the user; returns the ones unlocked just now. */
export function checkAchievements(userId: string): AchievementDef[] {
  const have = new Set((db.prepare('SELECT key FROM achievements WHERE user_id=?').all(userId) as any[]).map((r) => r.key));
  const unlocked: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.key)) continue;
    if (check(userId, a.key)) {
      db.prepare('INSERT OR IGNORE INTO achievements(user_id, key, unlocked_at) VALUES (?,?,?)').run(userId, a.key, now());
      unlocked.push(a);
    }
  }
  return unlocked;
}

export function awardXp(userId: string, amount: number): { xp: number; gained: number; levelUp: boolean; level: number } {
  const before = one('SELECT xp FROM users WHERE id=?', userId).xp ?? 0;
  const gained = Math.max(0, Math.round(amount));
  db.prepare('UPDATE users SET xp = xp + ? WHERE id=?').run(gained, userId);
  const l0 = levelFromXp(before).level, l1 = levelFromXp(before + gained).level;
  return { xp: before + gained, gained, levelUp: l1 > l0, level: l1 };
}

/** Daily streak: consecutive UTC days with a finished daily; "current" counts if today or yesterday was played. */
export function dailyStreak(userId: string): { current: number; best: number } {
  const days = (db.prepare("SELECT daily_date d FROM games WHERE user_id=? AND mode='daily' AND status='finished' ORDER BY daily_date").all(userId) as any[]).map((r) => r.d as string);
  const toNum = (d: string) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
  let best = 0, run = 0, prev = -10;
  for (const d of days) { const n = toNum(d); run = n === prev + 1 ? run + 1 : 1; prev = n; best = Math.max(best, run); }
  const today = Math.floor(Date.now() / 86400000);
  const current = days.length && today - prev <= 1 ? run : 0;
  return { current, best };
}
