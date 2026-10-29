/**
 * Solo-style games: classic, quick, daily, country / US-state streaks, explorer, challenges.
 * The server is authoritative: answers live only here, timers are checked against server time,
 * scores are computed here, and a round's answer is revealed only after it is closed.
 */
import { db, now, uid, json, shortCode } from './db.ts';
import { HttpError, type UserRow } from './auth.ts';
import { getMap, mapLike, invalidateCounts, type MapRow } from './maps.ts';
import { getLocation, pickLocations, pickOne, panoPayload, revalidate, candidatesFor, NotEnoughLocationsError, type LocRow } from './locations.ts';
import { countryAt, stateAt, countryName, stateName, countryByCode } from './geo.ts';
import { haversineKm, isValidLatLng, hashString, mulberry32 } from '../shared/geo.ts';
import { scoreFromDistance, medalFor, betterMedal, type Medal } from '../shared/scoring.ts';
import { normalizeRules, GUESS_GRACE_MS, type GameRules, type GameMode } from '../shared/rules.ts';
import { awardXp, checkAchievements, dailyStreak } from './progression.ts';
import { imagery } from './imagery/index.ts';
import { pickDistributed } from './locations.ts';

interface GameRow {
  id: string; user_id: string; mode: GameMode; map_id: string | null; rules: string; status: string; total_score: number;
  round_count: number; current_round: number; daily_date: string | null; challenge_code: string | null; country_code: string | null;
  scale_km: number; meta: string; created_at: number; finished_at: number | null;
}
interface RoundRow {
  game_id: string; idx: number; location_id: string; heading: number | null; status: 'pending' | 'active' | 'done'; started_at: number | null; deadline_at: number | null;
  guess_lat: number | null; guess_lng: number | null; guessed_at: number | null; distance_km: number | null; score: number | null;
  guess_region: string | null; correct: number | null;
}

const isStreak = (m: string) => m === 'streak_country' || m === 'streak_state';
export const DAILY_RULES: GameRules = { movement: 'moving', timeLimit: 180, rounds: 5, difficulty: 'normal' };
const QUICK_RULES: GameRules = { movement: 'moving', timeLimit: 60, rounds: 3, difficulty: 'easy' };
export const todayUTC = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

const getGame = (id: string) => db.prepare('SELECT * FROM games WHERE id=?').get(id) as GameRow | undefined;
const getRounds = (id: string) => db.prepare('SELECT * FROM game_rounds WHERE game_id=? ORDER BY idx').all(id) as RoundRow[];

function mustMap(slug: string): MapRow {
  const m = getMap(slug);
  if (!m) throw new HttpError(404, 'Map not found.', 'map_not_found');
  return m;
}

function insertGame(user: UserRow, mode: GameMode, map: MapRow, rules: GameRules, roundCount: number, extra: Partial<GameRow> = {}): string {
  const id = uid();
  db.prepare(`INSERT INTO games(id, user_id, mode, map_id, rules, status, total_score, round_count, current_round, daily_date, challenge_code, country_code, scale_km, meta, created_at)
    VALUES (?,?,?,?,?,'active',0,?,0,?,?,?,?,?,?)`).run(id, user.id, mode, map.id, JSON.stringify(rules), roundCount,
    extra.daily_date ?? null, extra.challenge_code ?? null, extra.country_code ?? null, map.scale_km, extra.meta ?? '{}', now());
  db.prepare('UPDATE maps SET plays = plays + 1 WHERE id=?').run(map.id);
  return id;
}
function insertRounds(gameId: string, locs: { id: string; heading?: number }[], startIdx = 0) {
  const ins = db.prepare("INSERT INTO game_rounds(game_id, idx, location_id, heading, status) VALUES (?,?,?,?,'pending')");
  locs.forEach((l, i) => ins.run(gameId, startIdx + i, l.id, l.heading ?? null));
}
function startRound(game: GameRow, idx: number) {
  const rules = json<GameRules>(game.rules, normalizeRules({}));
  const t = now();
  db.prepare("UPDATE game_rounds SET status='active', started_at=?, deadline_at=? WHERE game_id=? AND idx=?")
    .run(t, rules.timeLimit > 0 ? t + rules.timeLimit * 1000 : null, game.id, idx);
  db.prepare('UPDATE games SET current_round=? WHERE id=?').run(idx, game.id);
}

// ---------------------------------------------------------------- daily
export async function getOrCreateDaily(date = todayUTC()): Promise<{ date: string; map: MapRow; locationIds: string[]; rules: GameRules }> {
  const row = db.prepare('SELECT * FROM daily_challenges WHERE date=?').get(date) as any;
  const world = mustMap('world');
  if (row) return { date, map: getMap(row.map_id) ?? world, locationIds: JSON.parse(row.location_ids), rules: JSON.parse(row.rules) };
  // Deterministic selection: candidates sorted by id + RNG seeded from the date.
  const cands = candidatesFor(mapLike(world)).sort((a, b) => a.id.localeCompare(b.id));
  if (cands.length < DAILY_RULES.rounds) {
    await pickLocations(mapLike(world), DAILY_RULES.rounds).catch(() => null); // grows the pool with a live provider
  }
  const pool = candidatesFor(mapLike(world)).sort((a, b) => a.id.localeCompare(b.id));
  if (pool.length < DAILY_RULES.rounds) throw new NotEnoughLocationsError(pool.length, DAILY_RULES.rounds);
  const picked = pickDistributed(pool, DAILY_RULES.rounds, { rng: mulberry32(hashString(`daily:${date}`)), scaleKm: world.scale_km });
  const ids = picked.map((l) => l.id);
  db.prepare('INSERT OR IGNORE INTO daily_challenges(date, map_id, location_ids, rules, created_at) VALUES (?,?,?,?,?)').run(date, world.id, JSON.stringify(ids), JSON.stringify(DAILY_RULES), now());
  // Another request may have won the race; always return what is stored.
  const stored = db.prepare('SELECT * FROM daily_challenges WHERE date=?').get(date) as any;
  return { date, map: world, locationIds: JSON.parse(stored.location_ids), rules: JSON.parse(stored.rules) };
}

// ---------------------------------------------------------------- challenges
export async function createChallenge(user: UserRow, input: { mapSlug?: string; rules?: Partial<GameRules>; fromGameId?: string }): Promise<string> {
  let mapId: string, rules: GameRules, locIds: string[];
  if (input.fromGameId) {
    const g = getGame(input.fromGameId);
    if (!g || g.user_id !== user.id) throw new HttpError(404, 'Game not found.');
    if (isStreak(g.mode)) throw new HttpError(400, 'Streak games cannot be turned into challenges.');
    if (g.status !== 'finished') throw new HttpError(400, 'Finish the game first.');
    mapId = g.map_id!; rules = json(g.rules, normalizeRules({}));
    locIds = getRounds(g.id).map((r) => r.location_id);
  } else {
    const m = mustMap(input.mapSlug ?? 'world');
    rules = normalizeRules(input.rules);
    mapId = m.id;
    locIds = (await pickLocations(mapLike(m), rules.rounds, { difficulty: rules.difficulty })).map((l) => l.id);
  }
  let code = shortCode(7);
  while (db.prepare('SELECT 1 FROM challenges WHERE code=?').get(code)) code = shortCode(7);
  db.prepare('INSERT INTO challenges(code, creator_id, map_id, rules, location_ids, created_at) VALUES (?,?,?,?,?,?)')
    .run(code, user.id, mapId, JSON.stringify(rules), JSON.stringify(locIds), now());
  return code;
}

export function challengeInfo(code: string, viewer?: UserRow | null) {
  const c = db.prepare('SELECT * FROM challenges WHERE code=?').get(code.toUpperCase()) as any;
  if (!c) throw new HttpError(404, 'Challenge not found.', 'challenge_not_found');
  const map = getMap(c.map_id);
  const creator = c.creator_id ? (db.prepare('SELECT username, avatar FROM users WHERE id=?').get(c.creator_id) as any) : null;
  const results = (db.prepare(`SELECT g.id, g.total_score, g.finished_at, g.status, u.username, u.avatar, u.id uid FROM games g JOIN users u ON u.id=g.user_id
    WHERE g.challenge_code=? AND g.status='finished' ORDER BY g.total_score DESC, g.finished_at ASC LIMIT 100`).all(c.code) as any[])
    .map((r, i) => ({ rank: i + 1, gameId: r.id, username: r.username, avatar: json(r.avatar, {}), score: r.total_score, finishedAt: r.finished_at, isYou: viewer?.id === r.uid }));
  const mine = viewer ? (db.prepare('SELECT id, status FROM games WHERE challenge_code=? AND user_id=?').get(c.code, viewer.id) as any) : null;
  return {
    code: c.code, rules: json(c.rules, {}), map: map ? { slug: map.slug, name: map.name } : null,
    creator: creator ? { username: creator.username, avatar: json(creator.avatar, {}) } : null,
    rounds: JSON.parse(c.location_ids).length, results, myGame: mine ? { id: mine.id, status: mine.status } : null, createdAt: c.created_at,
  };
}

// ---------------------------------------------------------------- create
export interface CreateGameInput { mode: GameMode; mapSlug?: string; rules?: Partial<GameRules>; countryCode?: string; challengeCode?: string }

export async function createGame(user: UserRow, input: CreateGameInput) {
  const mode = input.mode;
  let gameId: string;
  switch (mode) {
    case 'classic':
    case 'quick': {
      const map = mustMap(mode === 'quick' ? 'world' : input.mapSlug ?? 'world');
      const rules = mode === 'quick' ? QUICK_RULES : normalizeRules(input.rules);
      const locs = await pickLocations(mapLike(map), rules.rounds, { difficulty: rules.difficulty });
      gameId = insertGame(user, mode, map, rules, rules.rounds);
      insertRounds(gameId, locs);
      break;
    }
    case 'daily': {
      const d = await getOrCreateDaily();
      const existing = db.prepare('SELECT id FROM games WHERE user_id=? AND daily_date=?').get(user.id, d.date) as any;
      if (existing) return gameView(existing.id, user.id);
      gameId = insertGame(user, 'daily', d.map, d.rules, d.locationIds.length, { daily_date: d.date });
      insertRounds(gameId, d.locationIds.map((id) => ({ id })));
      break;
    }
    case 'challenge': {
      const code = (input.challengeCode ?? '').toUpperCase();
      const c = db.prepare('SELECT * FROM challenges WHERE code=?').get(code) as any;
      if (!c) throw new HttpError(404, 'Challenge not found.', 'challenge_not_found');
      const existing = db.prepare('SELECT id FROM games WHERE user_id=? AND challenge_code=?').get(user.id, code) as any;
      if (existing) return gameView(existing.id, user.id);
      const map = getMap(c.map_id) ?? mustMap('world');
      const ids: string[] = JSON.parse(c.location_ids);
      gameId = insertGame(user, 'challenge', map, json(c.rules, normalizeRules({})), ids.length, { challenge_code: code });
      insertRounds(gameId, ids.map((id) => ({ id })));
      break;
    }
    case 'explorer': {
      const cc = (input.countryCode ?? '').toUpperCase();
      if (!countryByCode.has(cc)) throw new HttpError(400, 'Unknown country.');
      const map = mustMap(`country-${cc.toLowerCase()}`);
      const rules = normalizeRules({ ...input.rules, rounds: 5 });
      const locs = await pickLocations(mapLike(map), 5, { difficulty: rules.difficulty });
      gameId = insertGame(user, 'explorer', map, rules, 5, { country_code: cc });
      insertRounds(gameId, locs);
      break;
    }
    case 'streak_country':
    case 'streak_state': {
      const map = mustMap(mode === 'streak_state' ? 'us-states' : input.mapSlug ?? 'world');
      const rules = normalizeRules({ ...input.rules, rounds: 1 });
      const first = await pickOne(mapLike(map), new Set(), rules.difficulty);
      if (!first) throw new NotEnoughLocationsError(0, 1);
      gameId = insertGame(user, mode, map, rules, 0);
      insertRounds(gameId, [first]);
      break;
    }
    default:
      throw new HttpError(400, 'That mode is played in a multiplayer room.');
  }
  startRound(getGame(gameId)!, 0);
  invalidateCounts();
  return gameView(gameId, user.id);
}

// ---------------------------------------------------------------- play
function closeRound(game: GameRow, r: RoundRow, guess: { lat: number; lng: number } | null) {
  const loc = getLocation(r.location_id)!;
  const t = now();
  let distance: number | null = null, score = 0, region: string | null = null, correct: number | null = null;
  if (guess) {
    distance = haversineKm(guess, loc);
    if (isStreak(game.mode)) {
      region = game.mode === 'streak_state' ? stateAt(guess) : countryAt(guess);
      const truth = game.mode === 'streak_state' ? loc.subdivision : loc.country;
      correct = region && truth && region === truth ? 1 : 0;
      score = correct;
    } else {
      score = scoreFromDistance(distance, game.scale_km);
    }
  } else if (isStreak(game.mode)) correct = 0;
  db.prepare(`UPDATE game_rounds SET status='done', guess_lat=?, guess_lng=?, guessed_at=?, distance_km=?, score=?, guess_region=?, correct=? WHERE game_id=? AND idx=?`)
    .run(guess?.lat ?? null, guess?.lng ?? null, guess ? t : null, distance, score, region, correct, game.id, r.idx);
  db.prepare('UPDATE games SET total_score = total_score + ? WHERE id=?').run(score, game.id);
  const isLast = isStreak(game.mode) ? !correct : r.idx >= game.round_count - 1;
  if (isLast) finishGame(game.id);
}

/** Close the active round as "missed" when its deadline (plus latency grace) has passed. */
function resolveExpired(game: GameRow) {
  if (game.status !== 'active') return;
  const r = db.prepare("SELECT * FROM game_rounds WHERE game_id=? AND status='active'").get(game.id) as RoundRow | undefined;
  if (r?.deadline_at && now() > r.deadline_at + GUESS_GRACE_MS) closeRound(game, r, null);
}

function ownedGame(id: string, userId: string): GameRow {
  const g = getGame(id);
  if (!g || g.user_id !== userId) throw new HttpError(404, 'Game not found.', 'game_not_found');
  return g;
}

export function submitGuess(gameId: string, user: UserRow, body: { round: number; lat: number; lng: number }) {
  const tx = db.transaction(() => {
    const g = ownedGame(gameId, user.id);
    resolveExpired(g);
    const r = db.prepare('SELECT * FROM game_rounds WHERE game_id=? AND idx=?').get(g.id, body.round) as RoundRow | undefined;
    if (!r) throw new HttpError(400, 'No such round.');
    // Duplicate or late submissions are not errors: the client just gets the authoritative state.
    if (r.status !== 'active') return { accepted: false };
    if (!isValidLatLng(body)) throw new HttpError(400, 'Invalid coordinates.');
    closeRound(getGame(g.id)!, r, { lat: body.lat, lng: body.lng });
    return { accepted: true };
  });
  const res = tx();
  return { ...res, game: gameView(gameId, user.id) };
}

export async function nextRound(gameId: string, user: UserRow) {
  const g = ownedGame(gameId, user.id);
  resolveExpired(g);
  const fresh = getGame(gameId)!;
  if (fresh.status !== 'active') return gameView(gameId, user.id);
  const rounds = getRounds(gameId);
  const cur = rounds.find((r) => r.idx === fresh.current_round)!;
  if (cur.status !== 'done') return gameView(gameId, user.id); // nothing to advance
  const nextIdx = cur.idx + 1;
  if (isStreak(fresh.mode) && !rounds.find((r) => r.idx === nextIdx)) {
    const map = getMap(fresh.map_id!)!;
    const used = new Set(rounds.map((r) => r.location_id));
    const recent = rounds.map((r) => getLocation(r.location_id)!).filter(Boolean);
    const loc = await pickOne(mapLike(map), used, json<GameRules>(fresh.rules, normalizeRules({})).difficulty, recent);
    // A concurrent request may already have inserted the next round.
    if (getRounds(gameId).find((r) => r.idx === nextIdx)) return gameView(gameId, user.id);
    if (!loc) { finishGame(gameId, { exhausted: true }); return gameView(gameId, user.id); }
    insertRounds(gameId, [loc], nextIdx);
  }
  const target = db.prepare('SELECT * FROM game_rounds WHERE game_id=? AND idx=?').get(gameId, nextIdx) as RoundRow | undefined;
  if (target?.status === 'pending') startRound(fresh, nextIdx);
  return gameView(gameId, user.id);
}

/** The browser could not load the panorama: re-check it and swap in a replacement if it is gone. */
export async function reportUnavailable(gameId: string, user: UserRow, roundIdx: number) {
  const g = ownedGame(gameId, user.id);
  const r = db.prepare('SELECT * FROM game_rounds WHERE game_id=? AND idx=?').get(gameId, roundIdx) as RoundRow | undefined;
  if (!r || r.status !== 'active') return { replaced: false, game: gameView(gameId, user.id) };
  const meta = json<any>(g.meta, {});
  if ((meta.replacements ?? 0) >= 3) throw new HttpError(409, 'Too many unavailable panoramas in this game.');
  const loc = getLocation(r.location_id)!;
  const ok = await revalidate(loc);
  if (ok) return { replaced: false, game: gameView(gameId, user.id) };
  const used = new Set(getRounds(gameId).map((x) => x.location_id));
  const rep = await pickOne(mapLike(getMap(g.map_id!)!), used, json<GameRules>(g.rules, normalizeRules({})).difficulty);
  if (!rep) throw new HttpError(503, 'No replacement location is available right now.');
  db.prepare('UPDATE game_rounds SET location_id=?, heading=? WHERE game_id=? AND idx=?').run(rep.id, rep.heading ?? null, gameId, roundIdx);
  db.prepare('UPDATE games SET meta=? WHERE id=?').run(JSON.stringify({ ...meta, replacements: (meta.replacements ?? 0) + 1 }), gameId);
  startRound(g, roundIdx); // fresh timer for the new panorama
  return { replaced: true, game: gameView(gameId, user.id) };
}

function finishGame(gameId: string, extra: Record<string, unknown> = {}) {
  const g = getGame(gameId)!;
  if (g.status !== 'active') return;
  const t = now();
  const meta = { ...json<any>(g.meta, {}), ...extra };
  // Streak "score" = number of correct answers in a row.
  if (isStreak(g.mode)) {
    const streak = (db.prepare("SELECT COUNT(*) n FROM game_rounds WHERE game_id=? AND correct=1").get(gameId) as any).n;
    db.prepare('UPDATE games SET total_score=? WHERE id=?').run(streak, gameId);
  }
  db.prepare("UPDATE games SET status='finished', finished_at=?, meta=? WHERE id=?").run(t, JSON.stringify(meta), gameId);
  const fin = getGame(gameId)!;
  let medal: Medal | null = null, newBest = false;
  if (fin.mode === 'explorer' && fin.country_code) {
    medal = medalFor(fin.total_score);
    const prev = db.prepare('SELECT * FROM explorer_progress WHERE user_id=? AND country_code=?').get(g.user_id, fin.country_code) as any;
    newBest = !prev || fin.total_score > prev.best_score;
    db.prepare(`INSERT INTO explorer_progress(user_id, country_code, best_score, plays, medal, updated_at) VALUES (?,?,?,1,?,?)
      ON CONFLICT(user_id, country_code) DO UPDATE SET best_score=MAX(best_score, excluded.best_score), plays=plays+1, medal=?, updated_at=excluded.updated_at`)
      .run(g.user_id, fin.country_code, fin.total_score, medal, t, betterMedal(medal, (prev?.medal ?? 'none') as Medal));
  }
  const xp = isStreak(fin.mode) ? 10 + fin.total_score * 8 : 10 + Math.floor(fin.total_score / 250) + (fin.mode === 'daily' ? 40 : 0);
  const xpRes = awardXp(g.user_id, xp);
  const unlocked = checkAchievements(g.user_id);
  db.prepare('UPDATE games SET meta=? WHERE id=?').run(JSON.stringify({ ...meta, xp: xpRes, unlocked, medal, newBest }), gameId);
}

// ---------------------------------------------------------------- views
export function gameView(gameId: string, viewerId: string) {
  let g = ownedGame(gameId, viewerId);
  resolveExpired(g);
  g = getGame(gameId)!;
  const rounds = getRounds(gameId);
  const map = g.map_id ? getMap(g.map_id) : undefined;
  const rules = json<GameRules>(g.rules, normalizeRules({}));
  const meta = json<any>(g.meta, {});
  const doneRound = (r: RoundRow) => {
    const loc = getLocation(r.location_id)!;
    const streakMode = g.mode === 'streak_state' ? 'state' : 'country';
    return {
      idx: r.idx, status: 'done' as const, score: r.score ?? 0, distanceKm: r.distance_km, timedOut: r.guessed_at === null,
      guess: r.guess_lat !== null ? { lat: r.guess_lat, lng: r.guess_lng! } : null,
      answer: {
        lat: loc.lat, lng: loc.lng, country: loc.country, countryName: countryName(loc.country),
        subdivision: loc.subdivision, subdivisionName: loc.subdivision ? stateName(loc.subdivision) : null,
        panoId: loc.pano_id, provider: loc.provider,
      },
      correct: r.correct === null ? null : !!r.correct,
      guessRegion: r.guess_region, guessRegionName: r.guess_region ? (streakMode === 'state' ? stateName(r.guess_region) : countryName(r.guess_region)) : null,
    };
  };
  const cur = rounds.find((r) => r.idx === g.current_round);
  const current = cur && cur.status !== 'pending' ? {
    idx: cur.idx, status: cur.status, startedAt: cur.started_at, deadlineAt: cur.deadline_at,
    pano: (() => { const l = getLocation(cur.location_id)!; return panoPayload(cur.heading != null ? { ...l, heading: cur.heading } : l); })(),
    result: cur.status === 'done' ? doneRound(cur) : null,
  } : null;
  return {
    id: g.id, mode: g.mode, status: g.status, rules, roundCount: g.round_count, currentRound: g.current_round,
    totalScore: g.total_score, scaleKm: g.scale_km, serverNow: now(), demo: !imagery.live,
    map: map ? { slug: map.slug, name: map.name } : null,
    dailyDate: g.daily_date, challengeCode: g.challenge_code, countryCode: g.country_code, countryName: g.country_code ? countryName(g.country_code) : null,
    streak: isStreak(g.mode) ? rounds.filter((r) => r.correct === 1).length : null,
    round: current,
    rounds: rounds.filter((r) => r.status === 'done').map(doneRound),
    finish: g.status === 'finished' ? { xp: meta.xp ?? null, unlocked: meta.unlocked ?? [], medal: meta.medal ?? null, newBest: !!meta.newBest, exhausted: !!meta.exhausted } : null,
    createdAt: g.created_at, finishedAt: g.finished_at,
  };
}
export type GameView = ReturnType<typeof gameView>;

export function dailyInfo(viewer: UserRow | null, date = todayUTC()) {
  const mine = viewer ? (db.prepare('SELECT id, status, total_score FROM games WHERE user_id=? AND daily_date=?').get(viewer.id, date) as any) : null;
  const board = (db.prepare(`SELECT g.total_score score, g.finished_at, u.username, u.avatar, u.id uid FROM games g JOIN users u ON u.id=g.user_id
    WHERE g.daily_date=? AND g.status='finished' AND u.is_guest=0 ORDER BY g.total_score DESC, (g.finished_at - g.created_at) ASC LIMIT 50`).all(date) as any[])
    .map((r, i) => ({ rank: i + 1, username: r.username, avatar: json(r.avatar, {}), score: r.score, isYou: viewer?.id === r.uid }));
  const players = (db.prepare("SELECT COUNT(*) n FROM games WHERE daily_date=? AND status='finished'").get(date) as any).n;
  const next = new Date(date + 'T00:00:00Z').getTime() + 86400000;
  return { date, rules: DAILY_RULES, players, leaderboard: board, mine: mine ? { gameId: mine.id, status: mine.status, score: mine.total_score } : null,
    streak: viewer ? dailyStreak(viewer.id) : { current: 0, best: 0 }, nextAt: next, serverNow: now() };
}

export function explorerInfo(viewer: UserRow | null) {
  const progress = new Map<string, any>();
  if (viewer) for (const p of db.prepare('SELECT * FROM explorer_progress WHERE user_id=?').all(viewer.id) as any[]) progress.set(p.country_code, p);
  const maps = db.prepare("SELECT * FROM maps WHERE category='country' AND builtin=1 AND slug LIKE 'country-%' AND status='active'").all() as MapRow[];
  return maps.map((m) => {
    const cc = m.slug.slice(8).toUpperCase();
    const meta = countryByCode.get(cc);
    const p = progress.get(cc);
    return { code: cc, name: m.name, continent: meta?.continent ?? '', playable: candidatesFor(mapLike(m)).length, best: p?.best_score ?? 0, plays: p?.plays ?? 0, medal: (p?.medal ?? 'none') as Medal };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function recentGames(userId: string, limit = 20) {
  return (db.prepare(`SELECT g.id, g.mode, g.status, g.total_score, g.round_count, g.created_at, g.finished_at, m.name map_name, m.slug map_slug
    FROM games g LEFT JOIN maps m ON m.id=g.map_id WHERE g.user_id=? ORDER BY g.created_at DESC LIMIT ?`).all(userId, limit) as any[])
    .map((r) => ({ id: r.id, mode: r.mode, status: r.status, score: r.total_score, rounds: r.round_count, map: r.map_name, mapSlug: r.map_slug, createdAt: r.created_at, finishedAt: r.finished_at }));
}
