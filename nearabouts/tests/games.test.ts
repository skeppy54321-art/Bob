import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { testApp } from './helpers.ts';
import { db } from '../src/server/db.ts';

let T: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { T = await testApp(); });
afterEach(() => vi.useRealTimers());

const answerOf = (locId: string) => db.prepare('SELECT * FROM locations WHERE id=(SELECT location_id FROM game_rounds WHERE game_id=? AND idx=?)').get(locId, 0) as any;

describe('classic game', () => {
  it('plays five rounds, scores on the server and never leaks future answers', async () => {
    const c = await T.client();
    const { body: g } = await c.call('POST', '/api/games', { mode: 'classic', mapSlug: 'world' });
    expect(g.roundCount).toBe(5);
    expect(g.round.pano.provider).toBe('demo');
    const rounds = db.prepare('SELECT l.* FROM game_rounds r JOIN locations l ON l.id=r.location_id WHERE r.game_id=? ORDER BY idx').all(g.id) as any[];
    expect(new Set(rounds.map((r) => r.id)).size).toBe(5); // no repeats
    const text = JSON.stringify(g);
    expect(text).not.toMatch(/"(lat|lng|country)":/); // no coordinates or country before guessing
    for (const r of rounds) expect(text).not.toContain(r.id); // library ids include the country code
    let total = 0;
    for (let i = 0; i < 5; i++) {
      const loc = rounds[i];
      const { body } = await c.call('POST', `/api/games/${g.id}/guess`, { round: i, lat: loc.lat, lng: loc.lng });
      expect(body.accepted).toBe(true);
      expect(body.game.round.result.score).toBe(5000);
      total += 5000;
      if (i < 4) {
        const dup = await c.call('POST', `/api/games/${g.id}/guess`, { round: i, lat: 0, lng: 0 });
        expect(dup.body.accepted).toBe(false); // duplicate submission ignored
        expect(dup.body.game.totalScore).toBe(total);
        const n = await c.call('POST', `/api/games/${g.id}/next`);
        expect(n.body.currentRound).toBe(i + 1);
        expect(n.body.round.result).toBeNull();
      }
    }
    const end = await c.call('GET', `/api/games/${g.id}`);
    expect(end.body.status).toBe('finished');
    expect(end.body.totalScore).toBe(25000);
    expect(end.body.finish.xp.gained).toBeGreaterThan(0);
    expect(end.body.finish.unlocked.map((a: any) => a.key)).toContain('perfect_round');
  });

  it('times out rounds on the server', async () => {
    const c = await T.client();
    const { body: g } = await c.call('POST', '/api/games', { mode: 'classic', mapSlug: 'world', rules: { timeLimit: 30, rounds: 2 } });
    expect(g.round.deadlineAt - g.round.startedAt).toBe(30_000);
    vi.useFakeTimers({ now: Date.now() + 35_000, toFake: ['Date'] });
    const late = await c.call('POST', `/api/games/${g.id}/guess`, { round: 0, lat: 1, lng: 1 });
    expect(late.body.accepted).toBe(false);
    expect(late.body.game.round.result.timedOut).toBe(true);
    expect(late.body.game.round.result.score).toBe(0);
  });

  it("other players can't read your game", async () => {
    const a = await T.client(), b = await T.client();
    const { body: g } = await a.call('POST', '/api/games', { mode: 'quick' });
    expect((await b.call('GET', `/api/games/${g.id}`)).status).toBe(404);
    expect((await b.call('POST', `/api/games/${g.id}/guess`, { round: 0, lat: 0, lng: 0 })).status).toBe(404);
  });

  it('rejects maps without enough playable locations', async () => {
    const c = await T.client();
    const r = await c.call('POST', '/api/games', { mode: 'classic', mapSlug: 'country-nl' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('not_enough_locations');
  });
});

describe('daily challenge', () => {
  it('gives everyone the same locations and rules, once per day', async () => {
    const a = await T.client(), b = await T.client();
    const ga = (await a.call('POST', '/api/games', { mode: 'daily' })).body;
    const gb = (await b.call('POST', '/api/games', { mode: 'daily' })).body;
    const ids = (id: string) => (db.prepare('SELECT location_id FROM game_rounds WHERE game_id=? ORDER BY idx').all(id) as any[]).map((r) => r.location_id);
    expect(ids(ga.id)).toEqual(ids(gb.id));
    expect(ga.rules).toEqual(gb.rules);
    const again = (await a.call('POST', '/api/games', { mode: 'daily' })).body;
    expect(again.id).toBe(ga.id);
  });
});

describe('streaks', () => {
  it('continues on a correct country and ends on a wrong one', async () => {
    const c = await T.client();
    const { body: g } = await c.call('POST', '/api/games', { mode: 'streak_country' });
    const loc = answerOf(g.id);
    const r1 = (await c.call('POST', `/api/games/${g.id}/guess`, { round: 0, lat: loc.lat, lng: loc.lng })).body.game;
    expect(r1.round.result.correct).toBe(true);
    expect(r1.status).toBe('active');
    const n = (await c.call('POST', `/api/games/${g.id}/next`)).body;
    expect(n.currentRound).toBe(1);
    const r2 = (await c.call('POST', `/api/games/${g.id}/guess`, { round: 1, lat: 0, lng: -30 })).body.game; // Atlantic
    expect(r2.round.result.correct).toBe(false);
    expect(r2.status).toBe('finished');
    expect(r2.totalScore).toBe(1);
  });
  it('US state streak checks the state', async () => {
    const c = await T.client();
    const { body: g } = await c.call('POST', '/api/games', { mode: 'streak_state' });
    const loc = answerOf(g.id);
    expect(loc.country).toBe('US');
    const r = (await c.call('POST', `/api/games/${g.id}/guess`, { round: 0, lat: loc.lat, lng: loc.lng })).body.game;
    expect(r.round.result.correct).toBe(true);
    expect(r.round.result.guessRegion).toBe(loc.subdivision);
  });
});

describe('challenges', () => {
  it('replays identical locations and settings for friends', async () => {
    const a = await T.client(), b = await T.client();
    const { body: code } = await a.call('POST', '/api/challenges', { mapSlug: 'world', rules: { rounds: 3, movement: 'nmpz', timeLimit: 60 } });
    const ga = (await a.call('POST', '/api/games', { mode: 'challenge', challengeCode: code.code })).body;
    const gb = (await b.call('POST', '/api/games', { mode: 'challenge', challengeCode: code.code.toLowerCase() })).body;
    expect(ga.rules).toEqual({ movement: 'nmpz', rounds: 3, timeLimit: 60, difficulty: 'normal' });
    expect(gb.rules).toEqual(ga.rules);
    const ids = (id: string) => (db.prepare('SELECT location_id FROM game_rounds WHERE game_id=? ORDER BY idx').all(id) as any[]).map((r) => r.location_id);
    expect(ids(ga.id)).toEqual(ids(gb.id));
  });
});

describe('accounts', () => {
  it('upgrades a guest in place and supports login/logout', async () => {
    const c = await T.client();
    expect(c.me.guest).toBe(true);
    await c.call('POST', '/api/games', { mode: 'quick' });
    const reg = await c.call('POST', '/api/auth/register', { username: 'tester_1', password: 'correct horse', email: 't@example.com' });
    expect(reg.status).toBe(200);
    expect(reg.body.user.id).toBe(c.me.id); // same account, history kept
    expect(reg.body.user.guest).toBe(false);
    expect((await c.call('GET', '/api/games')).body.games.length).toBe(1);
    expect((await c.call('POST', '/api/auth/register', { username: 'tester_1', password: 'whatever12' })).status).toBe(409);
    await c.call('POST', '/api/auth/logout');
    const d = await T.client();
    expect((await d.call('POST', '/api/auth/login', { username: 'tester_1', password: 'wrong pass' })).status).toBe(401);
    const ok = await d.call('POST', '/api/auth/login', { username: 'TESTER_1', password: 'correct horse' });
    expect(ok.body.user.username).toBe('tester_1');
    const stored = db.prepare('SELECT pass_hash FROM users WHERE username=?').get('tester_1') as any;
    expect(stored.pass_hash).toMatch(/^scrypt\$/);
    expect(stored.pass_hash).not.toContain('correct horse');
  });
  it('rejects bad usernames and short passwords', async () => {
    const c = await T.client();
    expect((await c.call('POST', '/api/auth/register', { username: 'a', password: 'longenough' })).status).toBe(400);
    expect((await c.call('POST', '/api/auth/register', { username: 'okname', password: 'short' })).status).toBe(400);
    expect((await c.call('POST', '/api/auth/register', { username: 'GuestX', password: 'longenough' })).status).toBe(400);
  });
  it('guests cannot create maps or friends', async () => {
    const c = await T.client();
    expect((await c.call('POST', '/api/maps', { name: 'My map' })).status).toBe(403);
    expect((await c.call('GET', '/api/friends')).status).toBe(403);
  });
});

describe('maps and editor', () => {
  it('creates a map, validates locations against imagery, and publishes at 5+', async () => {
    const c = await T.client();
    await c.call('POST', '/api/auth/register', { username: 'mapper', password: 'longenough' });
    const m = (await c.call('POST', '/api/maps', { name: 'Big cities', visibility: 'private' })).body;
    expect((await c.call('PATCH', `/api/maps/${m.id}`, { visibility: 'public' })).status).toBe(400);
    const water = await c.call('POST', `/api/maps/${m.id}/locations`, { lat: 0, lng: -30 });
    expect(water.status).toBe(422);
    const pts = (db.prepare("SELECT lat, lng FROM locations WHERE provider='demo' LIMIT 6").all() as any[]);
    for (const p of pts) expect((await c.call('POST', `/api/maps/${m.id}/locations`, { lat: p.lat + 0.001, lng: p.lng, heading: 90 })).status).toBe(200);
    const pub = await c.call('PATCH', `/api/maps/${m.id}`, { visibility: 'public' });
    expect(pub.status).toBe(200);
    expect(pub.body.playable).toBe(6);
    const game = await c.call('POST', '/api/games', { mode: 'classic', mapSlug: m.slug });
    expect(game.status).toBe(200);
    expect(game.body.round.pano.heading).toBe(90); // custom starting direction
    const other = await T.client();
    expect((await other.call('PATCH', `/api/maps/${m.id}`, { name: 'hijack' })).status).toBe(403);
  });
});
