/** REST API. All responses are JSON; errors are { error, code }. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db, now, uid, json } from './db.ts';
import { config } from './config.ts';
import { HttpError, ensureUser, currentUser, requireAccount, getUserByName, validateUsername, publicUser, type UserRow } from './auth.ts';
import { createGame, submitGuess, nextRound, gameView, reportUnavailable, dailyInfo, explorerInfo, createChallenge, challengeInfo, recentGames } from './games.ts';
import { getMap, mapSummary, invalidateCounts, mapLike, type MapRow } from './maps.ts';
import { imagery } from './imagery/index.ts';
import { upsertVerified, panoPayload, candidatesFor } from './locations.ts';
import { countryName, regionContains } from './geo.ts';
import { ACHIEVEMENTS, dailyStreak, checkAchievements } from './progression.ts';
import { levelFromXp } from '../shared/levels.ts';
import { MODES, MAX_ROOM_PLAYERS } from '../shared/rules.ts';
import { listFriends, requestFriend, acceptFriend, removeFriend, block, unblock, listBlocks, friendIds, friendStatus } from './social.ts';
import { isOnline } from './presence.ts';
import { isValidLatLng } from '../shared/geo.ts';

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function me(req: FastifyRequest) {
  const u = currentUser(req);
  if (!u) return null;
  return { ...publicUser(u), bio: u.bio, admin: !!u.is_admin, settings: json(u.settings, {}), level: levelFromXp(u.xp), createdAt: u.created_at };
}

export function registerRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, time: now() }));

  app.get('/api/config', async () => ({
    provider: { id: imagery.id, label: imagery.label, live: imagery.live, client: imagery.clientConfig() },
    demo: !imagery.live,
    tiles: config.tiles,
    modes: MODES, maxRoomPlayers: MAX_ROOM_PLAYERS,
  }));

  // ------------------------------------------------------------ auth
  app.get('/api/me', async (req, reply) => { ensureUser(req, reply); return { user: me(req) }; });

  app.patch('/api/me', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = ensureUser(req, reply);
    const b = (req.body ?? {}) as any;
    if (b.avatar && typeof b.avatar === 'object') {
      const a = b.avatar, n = (v: any, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
      db.prepare('UPDATE users SET avatar=? WHERE id=?').run(JSON.stringify({ shape: n(a.shape, 5), hue: n(a.hue, 359), accent: n(a.accent, 359), face: n(a.face, 5), pattern: n(a.pattern, 4) }), u.id);
    }
    if (typeof b.bio === 'string') db.prepare('UPDATE users SET bio=? WHERE id=?').run(str(b.bio, 160), u.id);
    if (b.settings && typeof b.settings === 'object') {
      const s = { ...json<any>(u.settings, {}) };
      if (b.settings.units === 'km' || b.settings.units === 'mi') s.units = b.settings.units;
      if (typeof b.settings.reducedMotion === 'boolean') s.reducedMotion = b.settings.reducedMotion;
      if (typeof b.settings.mapStyle === 'string') s.mapStyle = str(b.settings.mapStyle, 20);
      db.prepare('UPDATE users SET settings=? WHERE id=?').run(JSON.stringify(s), u.id);
    }
    if (b.username !== undefined) {
      const name = str(b.username, 20);
      const bad = validateUsername(name);
      if (bad) throw new HttpError(400, bad);
      const taken = getUserByName(name);
      if (taken && taken.id !== u.id) throw new HttpError(409, 'Someone already uses that name — try another.');
      // Picking a name is all it takes to "join": is_guest=0 means "has chosen a name".
      db.prepare('UPDATE users SET username=?, is_guest=0 WHERE id=?').run(name, u.id);
    }
    req.user = db.prepare('SELECT * FROM users WHERE id=?').get(u.id) as UserRow;
    return { user: me(req) };
  });

  // ------------------------------------------------------------ games
  app.post('/api/games', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = ensureUser(req, reply);
    const b = (req.body ?? {}) as any;
    return createGame(u, { mode: b.mode, mapSlug: b.mapSlug, rules: b.rules, countryCode: b.countryCode, challengeCode: b.challengeCode });
  });
  app.get('/api/games/:id', async (req, reply) => gameView((req.params as any).id, ensureUser(req, reply).id));
  app.post('/api/games/:id/guess', async (req, reply) => {
    const b = (req.body ?? {}) as any;
    return submitGuess((req.params as any).id, ensureUser(req, reply), { round: Number(b.round), lat: Number(b.lat), lng: Number(b.lng) });
  });
  app.post('/api/games/:id/next', async (req, reply) => nextRound((req.params as any).id, ensureUser(req, reply)));
  app.post('/api/games/:id/unavailable', async (req, reply) => reportUnavailable((req.params as any).id, ensureUser(req, reply), Number(((req.body ?? {}) as any).round)));
  app.get('/api/games', async (req, reply) => ({ games: recentGames(ensureUser(req, reply).id, 30) }));

  app.get('/api/daily', async (req, reply) => dailyInfo(ensureUser(req, reply)));
  app.get('/api/explorer', async (req, reply) => ({ countries: explorerInfo(ensureUser(req, reply)) }));

  app.post('/api/challenges', async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const code = await createChallenge(ensureUser(req, reply), { mapSlug: b.mapSlug, rules: b.rules, fromGameId: b.fromGameId });
    return { code };
  });
  app.get('/api/challenges/:code', async (req, reply) => challengeInfo((req.params as any).code, ensureUser(req, reply)));

  // ------------------------------------------------------------ maps
  app.get('/api/maps', async (req, reply) => {
    const u = ensureUser(req, reply);
    const q = req.query as any;
    const where: string[] = ["m.status='active'"];
    const args: unknown[] = [];
    if (q.filter === 'mine') { where.push('m.creator_id=?'); args.push(u.id); }
    else if (q.filter === 'favorites') { where.push('EXISTS (SELECT 1 FROM map_favorites f WHERE f.map_id=m.id AND f.user_id=?)'); args.push(u.id); }
    else { where.push("(m.visibility='public' OR m.creator_id=?)"); args.push(u.id); }
    if (q.category && q.category !== 'all') { where.push('m.category=?'); args.push(String(q.category)); }
    if (q.q) { where.push('(m.name LIKE ? OR m.description LIKE ? OR m.tags LIKE ?)'); const like = `%${str(q.q, 60)}%`; args.push(like, like, like); }
    const sort = ({ new: 'm.created_at DESC', name: 'm.name COLLATE NOCASE', favorites: 'favs DESC, m.plays DESC' } as any)[q.sort] ?? 'm.featured DESC, m.plays DESC, m.name COLLATE NOCASE';
    const limit = Math.min(60, Math.max(1, Number(q.limit) || 30)), offset = Math.max(0, Number(q.offset) || 0);
    const rows = db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM map_favorites f WHERE f.map_id=m.id) favs FROM maps m WHERE ${where.join(' AND ')}
      ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...args, limit + 1, offset) as MapRow[];
    return { maps: rows.slice(0, limit).map((m) => mapSummary(m, u.id, !!u.is_admin)), hasMore: rows.length > limit };
  });

  app.get('/api/maps/:slug', async (req, reply) => {
    const u = ensureUser(req, reply);
    const m = getMap((req.params as any).slug);
    if (!m || (m.visibility === 'private' && m.creator_id !== u.id && !u.is_admin)) throw new HttpError(404, 'Map not found.');
    const best = db.prepare(`SELECT u.username, MAX(g.total_score) score FROM games g JOIN users u ON u.id=g.user_id
      WHERE g.map_id=? AND g.status='finished' AND g.mode='classic' AND g.round_count=5 AND u.is_guest=0 GROUP BY g.user_id ORDER BY score DESC LIMIT 10`).all(m.id);
    return { ...mapSummary(m, u.id, !!u.is_admin), description: m.description, highscores: best };
  });

  const ownedMap = (id: string, u: UserRow) => {
    const m = getMap(id);
    if (!m || (m.creator_id !== u.id && !u.is_admin)) throw new HttpError(404, 'Map not found.');
    if (m.builtin) throw new HttpError(403, 'Built-in maps cannot be edited.');
    return m;
  };
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'map';

  app.post('/api/maps', async (req) => {
    const u = requireAccount(req);
    const b = (req.body ?? {}) as any;
    const name = str(b.name, 60);
    if (name.length < 3) throw new HttpError(400, 'Give your map a name (3+ characters).');
    const count = (db.prepare('SELECT COUNT(*) n FROM maps WHERE creator_id=? AND status=?').get(u.id, 'active') as any).n;
    if (count >= 50) throw new HttpError(429, 'You can have at most 50 maps.');
    let slug = `${slugify(name)}-${uid().slice(0, 5)}`;
    const id = uid();
    const vis = ['public', 'unlisted', 'private'].includes(b.visibility) ? b.visibility : 'private';
    db.prepare(`INSERT INTO maps(id, slug, name, description, creator_id, category, kind, region, scale_km, visibility, builtin, featured, status, plays, tags, created_at, updated_at)
      VALUES (?,?,?,?,?,'community','explicit','{}',?,?,0,0,'active',0,?,?,?)`).run(id, slug, name, str(b.description, 500), u.id, 18000, vis, str(b.tags, 120), now(), now());
    return mapSummary(getMap(id)!, u.id, !!u.is_admin);
  });

  app.patch('/api/maps/:id', async (req) => {
    const u = requireAccount(req);
    const m = ownedMap((req.params as any).id, u);
    const b = (req.body ?? {}) as any;
    const name = b.name !== undefined ? str(b.name, 60) : m.name;
    if (name.length < 3) throw new HttpError(400, 'Map names need 3+ characters.');
    const vis = ['public', 'unlisted', 'private'].includes(b.visibility) ? b.visibility : m.visibility;
    if (vis === 'public' && candidatesFor(mapLike(m)).length < 5) throw new HttpError(400, 'Add at least 5 playable locations before publishing.');
    db.prepare('UPDATE maps SET name=?, description=?, visibility=?, tags=?, updated_at=? WHERE id=?')
      .run(name, b.description !== undefined ? str(b.description, 500) : m.description, vis, b.tags !== undefined ? str(b.tags, 120) : m.tags, now(), m.id);
    checkAchievements(u.id);
    return mapSummary(getMap(m.id)!, u.id, !!u.is_admin);
  });

  app.delete('/api/maps/:id', async (req) => {
    const u = requireAccount(req);
    const m = ownedMap((req.params as any).id, u);
    db.prepare("UPDATE maps SET status='removed', updated_at=? WHERE id=?").run(now(), m.id);
    return { ok: true };
  });

  app.post('/api/maps/:id/favorite', async (req, reply) => {
    const u = ensureUser(req, reply);
    const m = getMap((req.params as any).id);
    if (!m) throw new HttpError(404, 'Map not found.');
    const had = db.prepare('DELETE FROM map_favorites WHERE user_id=? AND map_id=?').run(u.id, m.id).changes;
    if (!had) db.prepare('INSERT INTO map_favorites(user_id, map_id, created_at) VALUES (?,?,?)').run(u.id, m.id, now());
    return { favorited: !had };
  });

  app.get('/api/maps/:id/locations', async (req) => {
    const u = requireAccount(req);
    const m = ownedMap((req.params as any).id, u);
    const rows = db.prepare(`SELECT l.id, l.lat, l.lng, l.provider, l.pano_id, l.status, l.country, COALESCE(ml.heading, l.heading) heading
      FROM map_locations ml JOIN locations l ON l.id=ml.location_id WHERE ml.map_id=? ORDER BY ml.position`).all(m.id) as any[];
    return { locations: rows.map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, heading: r.heading, provider: r.provider, status: r.status, country: r.country, countryName: countryName(r.country), playable: r.provider === imagery.id && (r.status === 'verified' || r.status === 'demo') })) };
  });

  // Editor: find real imagery near a clicked point (validates coverage before anything is saved).
  app.get('/api/imagery/nearest', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (req) => {
    requireAccount(req);
    const q = req.query as any;
    const p = { lat: Number(q.lat), lng: Number(q.lng) };
    if (!isValidLatLng(p)) throw new HttpError(400, 'Invalid coordinates.');
    const radius = Math.min(5000, Math.max(50, Number(q.radius) || 300));
    const ref = await imagery.findNear(p.lat, p.lng, imagery.live ? radius : Math.max(radius, 200_000));
    if (!ref) return { found: false, message: imagery.live ? `No imagery within ${radius} m.` : 'Demo mode: click near one of the demo markers.' };
    return { found: true, lat: ref.lat, lng: ref.lng, heading: ref.heading, pano: { provider: ref.provider, panoId: ref.panoId, heading: ref.heading, attribution: ref.attribution, demo: !imagery.live, ...(imagery.live ? {} : { scene: ref.meta }) } };
  });

  // Demo mode helper for the editor: where the illustrative scenes are.
  app.get('/api/imagery/demo-points', async () => {
    if (imagery.live) return { points: [] };
    return { points: (db.prepare("SELECT id, lat, lng FROM locations WHERE provider='demo' AND status='demo'").all() as any[]) };
  });

  app.post('/api/maps/:id/locations', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const u = requireAccount(req);
    const m = ownedMap((req.params as any).id, u);
    const b = (req.body ?? {}) as any;
    const p = { lat: Number(b.lat), lng: Number(b.lng) };
    if (!isValidLatLng(p)) throw new HttpError(400, 'Invalid coordinates.');
    const n = (db.prepare('SELECT COUNT(*) n FROM map_locations WHERE map_id=?').get(m.id) as any).n;
    if (n >= 2000) throw new HttpError(400, 'Maps can hold up to 2,000 locations.');
    // Never trust a client-supplied panorama: ask the provider for imagery at this point.
    const ref = await imagery.findNear(p.lat, p.lng, imagery.live ? 100 : 1000);
    if (!ref) throw new HttpError(422, 'No playable imagery at that spot.');
    const loc = imagery.live ? upsertVerified(ref, `map:${m.id}`) : (db.prepare("SELECT * FROM locations WHERE provider='demo' AND pano_id=?").get(ref.panoId) as any);
    const heading = Number.isFinite(Number(b.heading)) ? ((Number(b.heading) % 360) + 360) % 360 : null;
    db.prepare('INSERT INTO map_locations(map_id, location_id, heading, position, added_at) VALUES (?,?,?,?,?) ON CONFLICT(map_id, location_id) DO UPDATE SET heading=excluded.heading')
      .run(m.id, loc.id, heading, n, now());
    // Explicit maps are scored on their own extent.
    const pts = db.prepare('SELECT l.lat, l.lng FROM map_locations ml JOIN locations l ON l.id=ml.location_id WHERE ml.map_id=?').all(m.id) as any[];
    const { regionScaleKm } = await import('./geo.ts');
    const scale = pts.length > 1 ? regionScaleKm({ circles: pts.map((x) => ({ lat: x.lat, lng: x.lng, radiusKm: 0.5 })) }) : 18000;
    db.prepare('UPDATE maps SET scale_km=?, updated_at=? WHERE id=?').run(scale, now(), m.id);
    invalidateCounts();
    return { location: { id: loc.id, lat: loc.lat, lng: loc.lng, heading: heading ?? loc.heading, country: loc.country, countryName: countryName(loc.country), playable: true } };
  });

  app.patch('/api/maps/:id/locations/:locId', async (req) => {
    const u = requireAccount(req);
    const m = ownedMap((req.params as any).id, u);
    const h = Number(((req.body ?? {}) as any).heading);
    if (!Number.isFinite(h)) throw new HttpError(400, 'Invalid heading.');
    db.prepare('UPDATE map_locations SET heading=? WHERE map_id=? AND location_id=?').run(((h % 360) + 360) % 360, m.id, (req.params as any).locId);
    return { ok: true };
  });

  app.delete('/api/maps/:id/locations/:locId', async (req) => {
    const u = requireAccount(req);
    const m = ownedMap((req.params as any).id, u);
    db.prepare('DELETE FROM map_locations WHERE map_id=? AND location_id=?').run(m.id, (req.params as any).locId);
    if (m.visibility === 'public' && candidatesFor(mapLike(m)).length < 5) db.prepare("UPDATE maps SET visibility='unlisted' WHERE id=?").run(m.id);
    invalidateCounts();
    return { ok: true };
  });

  app.get('/api/pano/:locId', async (req) => {
    // Used by the map editor to preview a saved location (owner only via map check is overkill: demo/verified imagery only).
    requireAccount(req);
    const l = db.prepare('SELECT * FROM locations WHERE id=?').get((req.params as any).locId) as any;
    if (!l) throw new HttpError(404, 'Location not found.');
    return { pano: panoPayload(l) };
  });

  // ------------------------------------------------------------ social
  app.get('/api/friends', async (req) => listFriends(requireAccount(req)));
  app.post('/api/friends/request', async (req) => ({ status: requestFriend(requireAccount(req), str((req.body as any)?.username, 40)) }));
  app.post('/api/friends/respond', async (req) => { const b = req.body as any; acceptFriend(requireAccount(req), str(b?.username, 40), !!b?.accept); return { ok: true }; });
  app.delete('/api/friends/:username', async (req) => { removeFriend(requireAccount(req), (req.params as any).username); return { ok: true }; });
  app.get('/api/blocks', async (req, reply) => ({ blocked: listBlocks(ensureUser(req, reply)) }));
  app.post('/api/blocks', async (req, reply) => { block(ensureUser(req, reply), str((req.body as any)?.username, 40)); return { ok: true }; });
  app.delete('/api/blocks/:username', async (req, reply) => { unblock(ensureUser(req, reply), (req.params as any).username); return { ok: true }; });
  app.get('/api/users/search', async (req) => {
    const q = str((req.query as any).q, 20);
    if (q.length < 2) return { users: [] };
    return { users: (db.prepare("SELECT id, username, avatar, is_guest, xp FROM users WHERE is_guest=0 AND username LIKE ? ORDER BY length(username) LIMIT 10").all(`${q}%`) as any[]).map(publicUser) };
  });

  // ------------------------------------------------------------ profiles & stats
  app.get('/api/users/:username', async (req, reply) => {
    const viewer = ensureUser(req, reply);
    const u = getUserByName((req.params as any).username);
    if (!u) throw new HttpError(404, 'Player not found.');
    return profile(u, viewer);
  });

  // ------------------------------------------------------------ leaderboards
  app.get('/api/leaderboards/:board', async (req, reply) => {
    const viewer = ensureUser(req, reply);
    const scope = (req.query as any).scope === 'friends' ? 'friends' : 'global';
    const ids = scope === 'friends' ? [viewer.id, ...friendIds(viewer.id)] : null;
    const idFilter = ids ? `AND u.id IN (${ids.map(() => '?').join(',')})` : '';
    const a = ids ?? [];
    const board = (req.params as any).board;
    let rows: any[];
    switch (board) {
      case 'xp': rows = db.prepare(`SELECT u.username, u.avatar, u.id uid, u.xp value FROM users u WHERE u.is_guest=0 ${idFilter} ORDER BY u.xp DESC LIMIT 50`).all(...a); break;
      case 'classic': rows = db.prepare(`SELECT u.username, u.avatar, u.id uid, MAX(g.total_score) value FROM games g JOIN users u ON u.id=g.user_id JOIN maps m ON m.id=g.map_id
        WHERE g.status='finished' AND g.mode IN ('classic','challenge') AND g.round_count=5 AND m.slug='world' AND u.is_guest=0 ${idFilter} GROUP BY u.id ORDER BY value DESC LIMIT 50`).all(...a); break;
      case 'streak': rows = db.prepare(`SELECT u.username, u.avatar, u.id uid, MAX(g.total_score) value FROM games g JOIN users u ON u.id=g.user_id
        WHERE g.status='finished' AND g.mode='streak_country' AND u.is_guest=0 ${idFilter} GROUP BY u.id ORDER BY value DESC LIMIT 50`).all(...a); break;
      case 'daily': rows = db.prepare(`SELECT u.username, u.avatar, u.id uid, g.total_score value FROM games g JOIN users u ON u.id=g.user_id
        WHERE g.daily_date=? AND g.status='finished' AND u.is_guest=0 ${idFilter} ORDER BY value DESC LIMIT 50`).all(new Date().toISOString().slice(0, 10), ...a); break;
      case 'wins': rows = db.prepare(`SELECT u.username, u.avatar, u.id uid, COUNT(*) value FROM match_players p JOIN users u ON u.id=p.user_id
        WHERE p.outcome='win' AND u.is_guest=0 ${idFilter} GROUP BY u.id ORDER BY value DESC LIMIT 50`).all(...a); break;
      default: throw new HttpError(404, 'Unknown leaderboard.');
    }
    return { board, scope, entries: rows.map((r, i) => ({ rank: i + 1, username: r.username, avatar: json(r.avatar, {}), value: r.value, isYou: r.uid === viewer.id, level: board === 'xp' ? levelFromXp(r.value).level : undefined })) };
  });
}

export function profile(u: UserRow, viewer: UserRow) {
  const one = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as any) ?? {};
  const solo = one(`SELECT COUNT(*) games, MAX(CASE WHEN round_count=5 AND mode IN ('classic','daily','explorer','challenge') THEN total_score END) best5 FROM games WHERE user_id=? AND status='finished' AND mode NOT LIKE 'streak%'`, u.id);
  const rounds = one(`SELECT COUNT(*) n, AVG(r.score) avg, SUM(CASE WHEN r.score>=5000 THEN 1 ELSE 0 END) perfect, SUM(r.distance_km) dist, AVG(r.distance_km) avgDist
    FROM game_rounds r JOIN games g ON g.id=r.game_id WHERE g.user_id=? AND r.status='done' AND g.mode NOT LIKE 'streak%'`, u.id);
  const countriesSeen = one(`SELECT COUNT(DISTINCT l.country) n FROM game_rounds r JOIN games g ON g.id=r.game_id JOIN locations l ON l.id=r.location_id WHERE g.user_id=? AND r.status='done'`, u.id).n;
  const streaks = one(`SELECT MAX(CASE WHEN mode='streak_country' THEN total_score END) country, MAX(CASE WHEN mode='streak_state' THEN total_score END) state FROM games WHERE user_id=? AND status='finished'`, u.id);
  const mp = db.prepare(`SELECT m.mode, COUNT(*) played, SUM(CASE WHEN p.outcome='win' THEN 1 ELSE 0 END) wins FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.user_id=? GROUP BY m.mode`).all(u.id);
  const medals = db.prepare(`SELECT medal, COUNT(*) n FROM explorer_progress WHERE user_id=? AND medal!='none' GROUP BY medal`).all(u.id);
  const byMode = db.prepare(`SELECT mode, COUNT(*) n, AVG(total_score) avg, MAX(total_score) best FROM games WHERE user_id=? AND status='finished' GROUP BY mode`).all(u.id);
  const unlocked = new Map((db.prepare('SELECT key, unlocked_at FROM achievements WHERE user_id=?').all(u.id) as any[]).map((r) => [r.key, r.unlocked_at]));
  const matches = (db.prepare(`SELECT m.id, m.mode, m.started_at, m.ended_at, m.room_code, p.outcome, p.placement, p.total_score, p.forfeited,
      (SELECT COUNT(*) FROM match_players x WHERE x.match_id=m.id) players
    FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.user_id=? ORDER BY m.started_at DESC LIMIT 20`).all(u.id) as any[])
    .map((r) => ({ id: r.id, mode: r.mode, startedAt: r.started_at, endedAt: r.ended_at, outcome: r.outcome, placement: r.placement, score: r.total_score, forfeited: !!r.forfeited, players: r.players }));
  const isSelf = viewer.id === u.id;
  return {
    user: { ...publicUser(u), bio: u.bio, createdAt: u.created_at, level: levelFromXp(u.xp), online: isOnline(u.id) },
    isSelf, friendStatus: isSelf ? 'self' : friendStatus(viewer.id, u.id),
    stats: {
      gamesFinished: solo.games ?? 0, bestFiveRound: solo.best5 ?? 0, roundsPlayed: rounds.n ?? 0, avgRoundScore: Math.round(rounds.avg ?? 0),
      perfectRounds: rounds.perfect ?? 0, totalDistanceKm: Math.round(rounds.dist ?? 0), avgDistanceKm: Math.round(rounds.avgDist ?? 0),
      countriesSeen, bestCountryStreak: streaks.country ?? 0, bestStateStreak: streaks.state ?? 0, daily: dailyStreak(u.id),
      multiplayer: mp, medals, byMode,
    },
    achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: unlocked.get(a.key) ?? null })),
    recentGames: isSelf ? recentGames(u.id, 15) : recentGames(u.id, 15).filter((g) => g.status === 'finished'),
    recentMatches: matches,
  };
}
