import { describe, it, expect, beforeAll } from 'vitest';
import { Room, TIMING, type Clock, type Transport } from '../src/server/multi/room.ts';
import { config } from '../src/server/config.ts';
import { seedDemoLocations, getLocation } from '../src/server/locations.ts';
import { seedBuiltinMaps } from '../src/server/maps.ts';
import { createUser } from '../src/server/auth.ts';
import { db } from '../src/server/db.ts';

class FakeClock implements Clock {
  t = 1_000_000;
  timers: { at: number; fn: () => void; id: number }[] = [];
  seq = 0;
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) { const id = ++this.seq; this.timers.push({ at: this.t + ms, fn, id }); return id; }
  clearTimeout(h: unknown) { this.timers = this.timers.filter((x) => x.id !== h); }
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      await flush();
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
    await flush();
  }
}
const flush = () => new Promise((r) => setImmediate(r));

function setup() {
  const clock = new FakeClock();
  const sent: { to: string; event: string; data: any }[] = [];
  const transport: Transport = { send: (to, event, data) => sent.push({ to, event, data }), blockedPairs: () => false };
  const mk = (name: string) => { const u = createUser({ username: `${name}_${Math.random().toString(36).slice(2, 7)}` }); return { id: u.id, username: u.username, avatar: {} }; };
  return { clock, sent, transport, mk };
}
const answer = (room: Room) => getLocation(room.round!.loc.id)!;

beforeAll(() => { seedDemoLocations(); seedBuiltinMaps(); config.reconnectGraceMs = 30_000; });

async function startedRoom(format: any, n: number, patch: any = {}) {
  const s = setup();
  const users = Array.from({ length: n }, (_, i) => s.mk(`p${i}`));
  const room = new Room('TEST1', users[0], s.transport, s.clock);
  for (const u of users.slice(1)) room.addMember(u);
  room.updateSettings(users[0].id, { format, ...patch });
  for (const u of users.slice(1)) room.setReady(u.id, true);
  await room.start(users[0].id);
  await s.clock.advance(TIMING.startDelayMs);
  return { ...s, room, users };
}

describe('room lobby', () => {
  it('requires ready players and the right roster size', async () => {
    const s = setup();
    const a = s.mk('a'), b = s.mk('b'), c = s.mk('c');
    const room = new Room('L1', a, s.transport, s.clock);
    room.updateSettings(a.id, { format: 'duel' });
    expect(room.startProblem()).toMatch(/at least 2/);
    room.addMember(b);
    expect(room.startProblem()).toMatch(/Waiting for/);
    room.setReady(b.id, true);
    expect(room.startProblem()).toBeNull();
    room.addMember(c);
    room.setReady(c.id, true);
    expect(room.startProblem()).toMatch(/at most 2/);
    room.setSpectator(a.id, c.id, true);
    expect(room.startProblem()).toBeNull();
    expect(() => room.updateSettings(b.id, { format: 'party' })).toThrow(/host/);
  });
  it('caps rooms at 10 players', () => {
    const s = setup();
    const room = new Room('L2', s.mk('h'), s.transport, s.clock);
    for (let i = 0; i < 9; i++) room.addMember(s.mk(`m${i}`));
    expect(() => room.addMember(s.mk('extra'))).toThrow(/full/);
  });
  it('transfers host when the host leaves or stays disconnected', async () => {
    const s = setup();
    const a = s.mk('a'), b = s.mk('b');
    const room = new Room('L3', a, s.transport, s.clock);
    room.addMember(b);
    room.disconnect(a.id);
    expect(room.hostId).toBe(a.id);
    await s.clock.advance(TIMING.lobbyHostGraceMs + 10);
    expect(room.hostId).toBe(b.id);
    expect(room.members.has(a.id)).toBe(false);
  });
  it('kicked players cannot rejoin', () => {
    const s = setup();
    const a = s.mk('a'), b = s.mk('b');
    const room = new Room('L4', a, s.transport, s.clock);
    room.addMember(b);
    room.kick(a.id, b.id);
    expect(() => room.addMember(b)).toThrow(/removed/);
  });
});

describe('duel', () => {
  it('applies damage from score differences with multipliers until someone hits 0', async () => {
    const { room, users, clock } = await startedRoom('duel', 2, { startHealth: 6000, multiplierFrom: 2, multiplierStep: 1 });
    const [a, b] = users;
    expect(room.status).toBe('round');
    // Round 1: A perfect, B misses entirely (timer) -> B takes 5000 * 1.
    const loc = answer(room);
    expect(room.guess(a.id, { ...loc, round: 0 }).accepted).toBe(true);
    expect(room.guess(a.id, { ...loc, round: 0 }).reason).toBe('duplicate');
    expect(room.round!.countdownEndsAt).toBe(clock.now() + 15_000);
    await clock.advance(16_000 + 1500);
    expect(room.status).toBe('reveal');
    expect(room.members.get(b.id)!.health).toBe(1000);
    expect(room.lastResult!.players.find((p) => p.userId === b.id)!.damage).toBe(5000);
    // Both press continue -> next round starts immediately with multiplier 2.
    room.continueReady(a.id); room.continueReady(b.id);
    await clock.advance(1);
    expect(room.status).toBe('round');
    expect(room.round!.multiplier).toBe(2);
    const loc2 = answer(room);
    room.guess(b.id, { lat: loc2.lat + 5, lng: loc2.lng, round: 1 });
    room.guess(a.id, { ...loc2, round: 1 }); // both guessed -> round ends at once
    await clock.advance(1);
    expect(room.status).toBe('finished');
    expect(room.final!.reason).toBe('health');
    const pa = room.final!.placements.find((p) => p.userId === a.id)!;
    expect(pa.outcome).toBe('win');
    const saved = db.prepare('SELECT * FROM match_players WHERE match_id=? ORDER BY placement').all(room.final!.matchId) as any[];
    expect(saved.map((r) => r.outcome)).toEqual(['win', 'loss']);
  });
  it('no damage when both miss; late guesses rejected', async () => {
    const { room, users, clock } = await startedRoom('duel', 2, { timeLimit: 30 });
    await clock.advance(30_000 + 1600);
    expect(room.status).toBe('reveal');
    expect(room.lastResult!.players.every((p) => p.damage === 0)).toBe(true);
    expect(room.guess(users[0].id, { lat: 0, lng: 0, round: 0 }).accepted).toBe(false);
  });
  it('a disconnect past the grace period forfeits; reconnecting in time does not', async () => {
    const { room, users, clock } = await startedRoom('duel', 2);
    const [a, b] = users;
    room.disconnect(b.id);
    await clock.advance(10_000);
    room.reconnect(b.id);
    await clock.advance(25_000);
    expect(room.members.get(b.id)!.forfeited).toBe(false);
    room.disconnect(b.id);
    await clock.advance(31_000);
    expect(room.status).toBe('finished');
    expect(room.final!.reason).toBe('forfeit');
    expect(room.final!.placements.find((p) => p.userId === a.id)!.outcome).toBe('win');
    expect(room.final!.placements.find((p) => p.userId === b.id)!.forfeited).toBe(true);
  });
});

describe('team duel', () => {
  it('uses the best guess per team and a shared health pool', async () => {
    const { room, users, clock } = await startedRoom('teamduel', 4, { startHealth: 3000 });
    const t0 = users.filter((u) => room.members.get(u.id)!.team === 0), t1 = users.filter((u) => room.members.get(u.id)!.team === 1);
    expect(t0.length).toBe(2); expect(t1.length).toBe(2);
    const loc = answer(room);
    room.guess(t0[0].id, { ...loc, round: 0 });                       // 5000
    room.guess(t0[1].id, { lat: -loc.lat, lng: ((loc.lng + 150 + 540) % 360) - 180, round: 0 });
    room.guess(t1[0].id, { lat: Math.max(-80, Math.min(80, loc.lat + 40)) * (loc.lat > 40 ? -1 : 1), lng: loc.lng, round: 0 });
    room.guess(t1[1].id, { lat: loc.lat > 0 ? -60 : 60, lng: loc.lng, round: 0 });
    await clock.advance(1);
    const teams = room.lastResult!.teams!;
    expect(teams[0].score).toBe(5000);
    expect(teams[1].damage).toBe(5000 - teams[1].score);
    expect(room.members.get(t1[0].id)!.health).toBe(room.members.get(t1[1].id)!.health);
    if (teams[1].healthAfter > 0) expect(room.status).toBe('reveal');
    // A whole team leaving forfeits.
    if (room.status !== 'finished') {
      room.leave(t1[0].id); room.leave(t1[1].id);
      expect(room.status).toBe('finished');
      expect(room.final!.winnerTeam).toBe(0);
    }
  });
});

describe('battle royale', () => {
  it('distance: farthest guess and non-guessers are eliminated until one remains', async () => {
    const { room, users, clock } = await startedRoom('br_distance', 4, { countdownAfterGuess: 0 });
    const [a, b, c, d] = users;
    let loc = answer(room);
    room.guess(a.id, { ...loc, round: 0 });
    room.guess(b.id, { lat: loc.lat + 1, lng: loc.lng, round: 0 });
    room.guess(c.id, { lat: loc.lat + 10, lng: loc.lng, round: 0 });
    room.disconnect(d.id); // d never guesses; round ends because all connected players guessed
    await clock.advance(1);
    expect(room.lastResult!.players.find((p) => p.userId === d.id)!.eliminated).toBe(true);
    expect(room.members.get(c.id)!.alive).toBe(true); // only 1 eliminated per round
    room.reconnect(d.id);
    await clock.advance(TIMING.revealMs + 1);
    loc = answer(room);
    expect(room.guess(d.id, { ...loc, round: 1 }).reason).toBe('not_playing');
    room.guess(a.id, { ...loc, round: 1 });
    room.guess(b.id, { lat: loc.lat + 2, lng: loc.lng, round: 1 });
    room.guess(c.id, { lat: loc.lat + 2, lng: loc.lng, round: 1 }); // tie on distance: later guess (c) goes
    await clock.advance(1);
    expect(room.members.get(c.id)!.alive).toBe(false);
    await clock.advance(TIMING.revealMs + 1);
    loc = answer(room);
    room.guess(b.id, { ...loc, round: 2 });
    room.guess(a.id, { lat: loc.lat + 3, lng: loc.lng, round: 2 });
    await clock.advance(1);
    expect(room.status).toBe('finished');
    const p = room.final!.placements;
    expect(p.find((x) => x.userId === b.id)!.placement).toBe(1);
    expect(p.find((x) => x.userId === a.id)!.placement).toBe(2);
    expect(p.find((x) => x.userId === d.id)!.placement).toBe(4);
  });
  it('countries: wrong answers cost lives; nobody dies if everyone would', async () => {
    const { room, users, clock } = await startedRoom('br_countries', 2, { lives: 1, timeLimit: 20 });
    const [a, b] = users;
    let loc = answer(room);
    room.guess(a.id, { lat: 0, lng: -30, round: 0 }); // ocean: wrong
    room.guess(b.id, { lat: 0, lng: -31, round: 0 });
    await clock.advance(1);
    expect(room.lastResult!.note).toMatch(/nobody loses/);
    expect(room.members.get(a.id)!.lives).toBe(1);
    await clock.advance(TIMING.revealMs + 1);
    loc = answer(room);
    room.guess(a.id, { ...loc, round: 1 });
    await clock.advance(20_000 + 1600); // b times out
    expect(room.status).toBe('finished');
    expect(room.final!.placements.find((x) => x.userId === a.id)!.outcome).toBe('win');
  });
});

describe('party', () => {
  it('plays a fixed number of rounds, scores averages per team, and supports rematch', async () => {
    const { room, users, clock } = await startedRoom('party', 3, { rounds: 2, teams: true, timeLimit: 0 });
    for (let r = 0; r < 2; r++) {
      const loc = answer(room);
      for (const u of users) room.guess(u.id, { ...loc, round: r });
      await clock.advance(1);
      if (r === 0) { expect(room.status).toBe('reveal'); await clock.advance(TIMING.revealMs + 1); }
    }
    expect(room.status).toBe('finished');
    expect(room.final!.placements.every((p) => p.outcome === 'draw')).toBe(true); // all perfect -> equal team averages
    room.rematch(users[0].id);
    expect(room.status).toBe('lobby');
    expect(room.members.size).toBe(3);
  });
  it('untimed rounds wait only for connected players', async () => {
    const { room, users, clock } = await startedRoom('party', 2, { rounds: 1, timeLimit: 0 });
    room.disconnect(users[1].id);
    room.guess(users[0].id, { ...answer(room), round: 0 });
    await clock.advance(1);
    expect(room.status).toBe('finished');
  });
});
