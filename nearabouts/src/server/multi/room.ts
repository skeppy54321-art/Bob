/**
 * Authoritative multiplayer room.
 *
 * The room owns every rule decision: who is in, when rounds start and end, which guesses count,
 * scores, damage, lives, eliminations and the final result. Clients only send intents (join,
 * ready, guess, chat…) and render the personalised snapshot the room sends back.
 *
 * Timing uses an injectable Clock so tests can drive whole matches instantly.
 */
import { db, now as realNow, uid, json } from '../db.ts';
import { getMap, mapLike, type MapRow } from '../maps.ts';
import { getLocation, pickOne, panoPayload, candidatesFor, revalidate, type LocRow } from '../locations.ts';
import { countryAt, countryName } from '../geo.ts';
import { haversineKm, isValidLatLng } from '../../shared/geo.ts';
import { scoreFromDistance } from '../../shared/scoring.ts';
import { normalizeRules, GUESS_GRACE_MS, MAX_ROOM_PLAYERS } from '../../shared/rules.ts';
import { BASE_SETTINGS, FORMAT_DEFAULTS, FORMAT_INFO, multiplierFor, CHAT_PRESETS, type Format, type RoomSettings } from '../../shared/room.ts';
import { awardXp, checkAchievements } from '../progression.ts';
import { imagery } from '../imagery/index.ts';
import { config } from '../config.ts';

export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export const realClock: Clock = { now: realNow, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as any) };

export interface Transport {
  /** Deliver an event to every socket of one user. */
  send(userId: string, event: string, data: unknown): void;
  /** Users who blocked `userId` or whom `userId` blocked (chat filter). */
  blockedPairs(a: string, b: string): boolean;
}

export const TIMING = {
  startDelayMs: 3000,
  revealMs: 9000,
  lobbyHostGraceMs: 20_000,
  lobbyMemberGraceMs: 60_000,
  maxDuelRounds: 40,
  maxBrRounds: 40,
};

export class RoomError extends Error { constructor(message: string, public code = 'room_error') { super(message); } }

interface Guess { lat: number; lng: number; at: number; distanceKm: number; score: number; country: string | null; correct: boolean | null }

export interface Member {
  id: string; username: string; avatar: unknown; joinedAt: number;
  team: number | null; ready: boolean; connected: boolean; spectator: boolean; left: boolean;
  graceTimer: unknown; chatTimes: number[];
  // match state
  health: number; lives: number; alive: boolean; eliminatedRound: number | null; totalScore: number; forfeited: boolean; continueReady: boolean;
}

interface RoundState {
  idx: number; loc: LocRow; startedAt: number; endsAt: number | null; countdownEndsAt: number | null;
  guesses: Map<string, Guess>; multiplier: number; replacements: number;
}

export interface PlayerRoundResult {
  userId: string; username: string; team: number | null; guess: { lat: number; lng: number } | null; distanceKm: number | null; score: number;
  country: string | null; countryName: string | null; correct: boolean | null; damage: number; healthAfter: number | null;
  livesAfter: number | null; eliminated: boolean; guessedAt: number | null;
}
export interface RoundResult {
  idx: number; number: number; multiplier: number;
  answer: { lat: number; lng: number; country: string | null; countryName: string; provider: string; panoId: string };
  players: PlayerRoundResult[];
  teams: { team: number; score: number; damage: number; healthAfter: number }[] | null;
  note: string | null;
}

export interface FinalResult {
  reason: 'completed' | 'health' | 'elimination' | 'forfeit' | 'round_cap' | 'pool_exhausted';
  placements: { userId: string; username: string; team: number | null; placement: number; outcome: 'win' | 'loss' | 'draw'; totalScore: number; forfeited: boolean }[];
  winnerTeam: number | null;
  matchId: string;
}

type Status = 'lobby' | 'starting' | 'round' | 'reveal' | 'finished';

interface ChatMsg { id: string; userId: string; username: string; text: string; preset: boolean; at: number }

const PROFANITY = /\b(fuck|shit|cunt|bitch|asshole|nigg\w*|fag\w*|retard\w*)\b/gi;

export class Room {
  status: Status = 'lobby';
  settings: RoomSettings = { ...BASE_SETTINGS };
  members = new Map<string, Member>();
  hostId: string;
  kicked = new Set<string>();
  round: RoundState | null = null;
  history: RoundResult[] = [];
  lastResult: RoundResult | null = null;
  final: FinalResult | null = null;
  chat: ChatMsg[] = [];
  startsAt: number | null = null;
  revealEndsAt: number | null = null;
  matchStartedAt = 0;
  usedLocations = new Set<string>();
  error: string | null = null;
  private timer: unknown = null;
  private idleTimer: unknown = null;
  private map: MapRow | null = null;
  private epoch = 0; // invalidates async work from a previous match

  constructor(public code: string, host: { id: string; username: string; avatar: unknown }, private transport: Transport, private clock: Clock = realClock,
    private onEmpty: (room: Room) => void = () => {}) {
    this.hostId = host.id;
    this.addMember(host);
  }

  // ------------------------------------------------------------------ membership
  private newMember(u: { id: string; username: string; avatar: unknown }, spectator: boolean): Member {
    return {
      id: u.id, username: u.username, avatar: u.avatar, joinedAt: this.clock.now(), team: null, ready: false, connected: true,
      spectator, left: false, graceTimer: null, chatTimes: [],
      health: 0, lives: 0, alive: true, eliminatedRound: null, totalScore: 0, forfeited: false, continueReady: false,
    };
  }

  get players(): Member[] { return [...this.members.values()].filter((m) => !m.spectator && !m.left); }
  private active(): Member[] { return this.players.filter((m) => m.alive && !m.forfeited); }

  addMember(u: { id: string; username: string; avatar: unknown }): Member {
    const existing = this.members.get(u.id);
    if (existing && !existing.left) { this.reconnect(u.id); return existing; }
    const running = this.status === 'starting' || this.status === 'round' || this.status === 'reveal';
    if (existing && running) {
      // A forfeited player came back: they can watch, and play again after a rematch.
      existing.connected = true;
      this.touch();
      this.broadcast();
      return existing;
    }
    if (this.kicked.has(u.id)) throw new RoomError('The host removed you from this room.', 'kicked');
    const current = [...this.members.values()].filter((m) => !m.left).length;
    if (current >= MAX_ROOM_PLAYERS) throw new RoomError(`This room is full (${MAX_ROOM_PLAYERS} players).`, 'room_full');
    const inMatch = this.status !== 'lobby' && this.status !== 'finished';
    const m = this.newMember(u, inMatch);
    if (!inMatch) m.team = this.autoTeam();
    this.members.set(u.id, m);
    this.touch();
    this.broadcast();
    return m;
  }

  private teamMode(): boolean { return this.settings.format === 'teamduel' || (this.settings.format === 'party' && this.settings.teams); }
  private autoTeam(): number | null {
    if (!this.teamMode()) return null;
    const counts = [0, 0];
    for (const m of this.members.values()) if (!m.left && !m.spectator && m.team !== null) counts[m.team]++;
    return counts[0] <= counts[1] ? 0 : 1;
  }

  reconnect(userId: string) {
    const m = this.members.get(userId);
    if (!m) return;
    m.connected = true;
    if (m.graceTimer) { this.clock.clearTimeout(m.graceTimer); m.graceTimer = null; }
    this.touch();
    this.broadcast();
  }

  /** A member's last socket closed. Start the grace period. */
  disconnect(userId: string) {
    const m = this.members.get(userId);
    if (!m || m.left) return;
    m.connected = false;
    const inMatch = this.status === 'starting' || this.status === 'round' || this.status === 'reveal';
    const grace = inMatch && !m.spectator ? config.reconnectGraceMs : userId === this.hostId ? TIMING.lobbyHostGraceMs : TIMING.lobbyMemberGraceMs;
    if (m.graceTimer) this.clock.clearTimeout(m.graceTimer);
    m.graceTimer = this.clock.setTimeout(() => { m.graceTimer = null; if (!m.connected) this.leave(userId, 'disconnect'); }, grace);
    this.broadcast();
    // Everyone else might be done guessing now.
    if (this.status === 'round') this.maybeEndRoundEarly();
    if (this.status === 'reveal') this.maybeContinue();
    this.touch();
  }

  /** Leave the room. During a match this forfeits. */
  leave(userId: string, why: 'leave' | 'disconnect' | 'kick' = 'leave') {
    const m = this.members.get(userId);
    if (!m || m.left) return;
    const inMatch = this.status === 'starting' || this.status === 'round' || this.status === 'reveal';
    if (inMatch && !m.spectator) {
      m.forfeited = true;
      m.left = true;
      m.connected = false;
      this.systemMessage(`${m.username} ${why === 'disconnect' ? 'disconnected and forfeited' : 'left the match'}.`);
      this.afterForfeit(m);
    } else {
      this.members.delete(userId);
      if (why !== 'kick') this.systemMessage(`${m.username} left.`);
    }
    if (m.graceTimer) { this.clock.clearTimeout(m.graceTimer); m.graceTimer = null; }
    if (userId === this.hostId) this.transferHost();
    this.touch();
    this.broadcast();
  }

  private transferHost(preferred?: string) {
    const candidates = [...this.members.values()].filter((m) => !m.left && m.connected).sort((a, b) => a.joinedAt - b.joinedAt);
    const next = (preferred && candidates.find((c) => c.id === preferred)) || candidates[0] || [...this.members.values()].find((m) => !m.left);
    if (next && next.id !== this.hostId) {
      this.hostId = next.id;
      this.systemMessage(`${next.username} is now the host.`);
    }
  }

  /** Destroy the room when nobody has been connected for a while. */
  private touch() {
    const anyone = [...this.members.values()].some((m) => m.connected && !m.left);
    if (anyone) { if (this.idleTimer) { this.clock.clearTimeout(this.idleTimer); this.idleTimer = null; } return; }
    if (this.idleTimer) return;
    this.idleTimer = this.clock.setTimeout(() => {
      if ([...this.members.values()].some((m) => m.connected && !m.left)) return;
      if (this.status === 'round' || this.status === 'reveal' || this.status === 'starting') this.persist('abandoned');
      this.destroy();
    }, config.roomIdleMs);
  }

  destroy() {
    this.epoch++;
    if (this.timer) this.clock.clearTimeout(this.timer);
    if (this.idleTimer) this.clock.clearTimeout(this.idleTimer);
    for (const m of this.members.values()) if (m.graceTimer) this.clock.clearTimeout(m.graceTimer);
    this.status = 'finished';
    this.onEmpty(this);
  }

  // ------------------------------------------------------------------ host controls
  private requireHost(userId: string) { if (userId !== this.hostId) throw new RoomError('Only the host can do that.', 'not_host'); }
  private requireLobby() { if (this.status !== 'lobby' && this.status !== 'finished') throw new RoomError('Wait until the current game ends.', 'in_progress'); }

  updateSettings(userId: string, patch: Partial<RoomSettings>) {
    this.requireHost(userId);
    this.requireLobby();
    const s = { ...this.settings };
    if (patch.format && patch.format !== s.format && FORMAT_INFO[patch.format]) {
      Object.assign(s, { format: patch.format }, FORMAT_DEFAULTS[patch.format]);
    }
    if (typeof patch.mapSlug === 'string') {
      const m = getMap(patch.mapSlug);
      if (!m || (m.visibility === 'private' && m.creator_id !== userId)) throw new RoomError('Map not found.');
      s.mapSlug = m.slug;
    }
    const r = normalizeRules({ movement: patch.movement ?? s.movement, difficulty: patch.difficulty ?? s.difficulty, timeLimit: patch.timeLimit ?? s.timeLimit, rounds: patch.rounds ?? s.rounds });
    s.movement = r.movement; s.difficulty = r.difficulty; s.rounds = r.rounds; s.timeLimit = r.timeLimit;
    if (s.format !== 'party' && s.timeLimit === 0) s.timeLimit = FORMAT_DEFAULTS[s.format].timeLimit ?? 120;
    const clampInt = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    if (patch.teams !== undefined) s.teams = !!patch.teams;
    if (patch.startHealth !== undefined) s.startHealth = clampInt(patch.startHealth, 1000, 20000, s.startHealth);
    if (patch.countdownAfterGuess !== undefined) s.countdownAfterGuess = clampInt(patch.countdownAfterGuess, 0, 60, s.countdownAfterGuess);
    if (patch.multiplierFrom !== undefined) s.multiplierFrom = clampInt(patch.multiplierFrom, 1, 20, s.multiplierFrom);
    if (patch.multiplierStep !== undefined) s.multiplierStep = Math.min(2, Math.max(0, Math.round(Number(patch.multiplierStep) * 4) / 4 || 0));
    if (patch.lives !== undefined) s.lives = clampInt(patch.lives, 1, 5, s.lives);
    if (patch.slowestLosesLife !== undefined) s.slowestLosesLife = !!patch.slowestLosesLife;
    if (patch.eliminatePerRound !== undefined) s.eliminatePerRound = clampInt(patch.eliminatePerRound, 1, 3, s.eliminatePerRound);
    const wasTeams = this.teamMode();
    this.settings = s;
    if (this.teamMode() && !wasTeams) { for (const m of this.members.values()) m.team = null; for (const m of this.members.values()) if (!m.left) m.team = this.autoTeam(); }
    if (!this.teamMode()) for (const m of this.members.values()) m.team = null;
    for (const m of this.members.values()) m.ready = false; // rules changed: confirm again
    this.broadcast();
  }

  setTeam(actorId: string, targetId: string, team: number) {
    this.requireLobby();
    if (!this.teamMode()) throw new RoomError('Teams are off.');
    if (actorId !== targetId) this.requireHost(actorId);
    const m = this.members.get(targetId);
    if (!m || (team !== 0 && team !== 1)) throw new RoomError('Invalid team.');
    const size = [...this.members.values()].filter((x) => !x.left && !x.spectator && x.team === team && x.id !== targetId).length;
    if (this.settings.format === 'teamduel' && size >= 5) throw new RoomError('That team is full (5 max).');
    m.team = team;
    m.spectator = false;
    m.ready = false;
    this.broadcast();
  }

  setReady(userId: string, ready: boolean) {
    const m = this.members.get(userId);
    if (!m || this.status !== 'lobby') return;
    m.ready = ready;
    this.broadcast();
  }

  setSpectator(actorId: string, targetId: string, spectator: boolean) {
    this.requireLobby();
    if (actorId !== targetId) this.requireHost(actorId);
    const m = this.members.get(targetId);
    if (!m) return;
    m.spectator = spectator;
    m.team = spectator ? null : this.autoTeam();
    this.broadcast();
  }

  kick(actorId: string, targetId: string) {
    this.requireHost(actorId);
    if (targetId === actorId) throw new RoomError("You can't kick yourself.");
    const m = this.members.get(targetId);
    if (!m) return;
    this.kicked.add(targetId);
    this.systemMessage(`${m.username} was removed by the host.`);
    this.leave(targetId, 'kick');
    this.transport.send(targetId, 'room:kicked', { code: this.code });
  }

  makeHost(actorId: string, targetId: string) {
    this.requireHost(actorId);
    const m = this.members.get(targetId);
    if (!m || m.left) throw new RoomError('Player not found.');
    this.transferHost(targetId);
    this.broadcast();
  }

  /** Check the roster against the format. Returns a human readable problem or null. */
  startProblem(): string | null {
    const info = FORMAT_INFO[this.settings.format];
    const ps = [...this.members.values()].filter((m) => !m.left && !m.spectator && m.connected);
    if (ps.length < info.min) return `${info.name} needs at least ${info.min} player${info.min > 1 ? 's' : ''}.`;
    if (ps.length > info.max) return `${info.name} allows at most ${info.max} players. Move extras to spectators.`;
    if (this.teamMode()) {
      const t0 = ps.filter((m) => m.team === 0).length, t1 = ps.filter((m) => m.team === 1).length;
      if (this.settings.format === 'teamduel' && (!t0 || !t1)) return 'Both teams need at least one player.';
      if (t0 > 5 || t1 > 5) return 'Teams can have at most 5 players.';
    }
    const notReady = ps.filter((m) => m.id !== this.hostId && !m.ready);
    if (notReady.length) return `Waiting for ${notReady.map((m) => m.username).join(', ')} to be ready.`;
    const map = getMap(this.settings.mapSlug);
    if (!map) return 'The selected map no longer exists.';
    const pool = candidatesFor(mapLike(map)).length;
    const need = this.settings.format === 'party' ? this.settings.rounds : 5;
    if (!imagery.live && pool < need) return `This map only has ${pool} playable location${pool === 1 ? '' : 's'} (need ${need}).`;
    return null;
  }

  async start(userId: string) {
    this.requireHost(userId);
    this.requireLobby();
    const problem = this.startProblem();
    if (problem) throw new RoomError(problem, 'cannot_start');
    this.map = getMap(this.settings.mapSlug)!;
    // Disconnected roster members watch instead of playing.
    for (const m of [...this.members.values()]) {
      if (m.left && !m.connected) { this.members.delete(m.id); continue; }
      m.left = false;
      if (!m.connected) m.spectator = true;
      Object.assign(m, {
        health: this.settings.startHealth, lives: this.settings.lives, alive: true, eliminatedRound: null, totalScore: 0,
        forfeited: false, continueReady: false, ready: false,
      });
      if (!this.teamMode()) m.team = null;
    }
    this.history = []; this.lastResult = null; this.final = null; this.usedLocations.clear(); this.error = null;
    this.epoch++;
    this.matchStartedAt = this.clock.now();
    this.status = 'starting';
    this.startsAt = this.clock.now() + TIMING.startDelayMs;
    this.broadcast();
    const epoch = this.epoch;
    const loc = await this.nextLocation();
    if (epoch !== this.epoch) return;
    if (!loc) { this.status = 'lobby'; this.startsAt = null; this.error = 'Could not find a location for this map. Try another map.'; this.broadcast(); return; }
    this.schedule(Math.max(0, (this.startsAt ?? 0) - this.clock.now()), () => this.beginRound(0, loc));
  }

  private async nextLocation(): Promise<LocRow | null> {
    const recent = this.history.slice(-3).map((h) => h.answer);
    return pickOne(mapLike(this.map!), this.usedLocations, this.settings.difficulty, recent);
  }

  private schedule(ms: number, fn: () => void) {
    if (this.timer) this.clock.clearTimeout(this.timer);
    const epoch = this.epoch;
    this.timer = this.clock.setTimeout(() => { this.timer = null; if (epoch === this.epoch) fn(); }, ms);
  }

  // ------------------------------------------------------------------ rounds
  private beginRound(idx: number, loc: LocRow) {
    this.usedLocations.add(loc.id);
    const t = this.clock.now();
    const limit = this.settings.timeLimit;
    this.round = {
      idx, loc, startedAt: t, endsAt: limit > 0 ? t + limit * 1000 : null, countdownEndsAt: null, guesses: new Map(),
      multiplier: this.settings.format === 'duel' || this.settings.format === 'teamduel' ? multiplierFor(idx + 1, this.settings) : 1, replacements: 0,
    };
    for (const m of this.members.values()) m.continueReady = false;
    this.status = 'round';
    this.revealEndsAt = null;
    this.startsAt = null;
    if (this.round.endsAt) this.schedule(this.round.endsAt - t + GUESS_GRACE_MS, () => this.endRound());
    else if (this.timer) { this.clock.clearTimeout(this.timer); this.timer = null; }
    this.broadcast();
  }

  guess(userId: string, p: { lat: number; lng: number; round: number }): { accepted: boolean; reason?: string } {
    const r = this.round;
    const m = this.members.get(userId);
    if (this.status !== 'round' || !r) return { accepted: false, reason: 'no_round' };
    if (p.round !== r.idx) return { accepted: false, reason: 'stale_round' };
    if (!m || m.spectator || m.left || !m.alive || m.forfeited) return { accepted: false, reason: 'not_playing' };
    if (r.guesses.has(userId)) return { accepted: false, reason: 'duplicate' };
    if (!isValidLatLng(p)) return { accepted: false, reason: 'invalid' };
    const t = this.clock.now();
    const deadline = Math.min(r.endsAt ?? Infinity, r.countdownEndsAt ?? Infinity);
    if (t > deadline + GUESS_GRACE_MS) return { accepted: false, reason: 'too_late' };
    const distanceKm = haversineKm(p, r.loc);
    const country = this.settings.format === 'br_countries' ? countryAt(p) : null;
    r.guesses.set(userId, {
      lat: p.lat, lng: p.lng, at: t, distanceKm,
      score: this.settings.format === 'br_countries' ? 0 : scoreFromDistance(distanceKm, this.map!.scale_km),
      country, correct: this.settings.format === 'br_countries' ? !!country && country === r.loc.country : null,
    });
    // First guess starts the countdown for everyone else.
    const cd = this.settings.countdownAfterGuess;
    if (cd > 0 && r.countdownEndsAt === null && ['duel', 'teamduel', 'br_distance'].includes(this.settings.format)) {
      r.countdownEndsAt = Math.min(r.endsAt ?? Infinity, t + cd * 1000);
      this.schedule(r.countdownEndsAt - t + GUESS_GRACE_MS, () => this.endRound());
    }
    this.broadcast();
    this.maybeEndRoundEarly();
    return { accepted: true };
  }

  private maybeEndRoundEarly() {
    const r = this.round;
    if (this.status !== 'round' || !r) return;
    const waiting = this.active().filter((m) => m.connected && !r.guesses.has(m.id));
    if (waiting.length === 0 && r.guesses.size > 0) this.endRound();
  }

  /** A client could not load the panorama. Swap the location for everyone if the provider confirms it is gone. */
  async reportUnavailable(userId: string, roundIdx: number) {
    const r = this.round;
    if (this.status !== 'round' || !r || r.idx !== roundIdx || !this.members.has(userId) || r.replacements >= 2 || r.guesses.size > 0) return;
    const ok = await revalidate(r.loc);
    if (ok || this.round !== r || this.status !== 'round') return;
    const loc = await this.nextLocation();
    if (!loc || this.round !== r) return;
    r.replacements++;
    this.systemMessage('That panorama is no longer available — here is a new one.');
    const reps = r.replacements;
    this.beginRound(r.idx, loc);
    this.round!.replacements = reps;
  }

  private endRound() {
    const r = this.round;
    if (this.status !== 'round' || !r) return;
    if (this.timer) { this.clock.clearTimeout(this.timer); this.timer = null; }
    const fmt = this.settings.format;
    const loc = r.loc;
    const roster = this.players.concat([...this.members.values()].filter((m) => m.forfeited));
    const playing = this.active();
    const res = new Map<string, PlayerRoundResult>();
    for (const m of roster) {
      const g = r.guesses.get(m.id);
      res.set(m.id, {
        userId: m.id, username: m.username, team: m.team, guess: g ? { lat: g.lat, lng: g.lng } : null, distanceKm: g?.distanceKm ?? null,
        score: g?.score ?? 0, country: g?.country ?? null, countryName: g?.country ? countryName(g.country) : null, correct: g ? g.correct : (fmt === 'br_countries' ? false : null),
        damage: 0, healthAfter: null, livesAfter: null, eliminated: false, guessedAt: g?.at ?? null,
      });
    }
    let teams: RoundResult['teams'] = null;
    let note: string | null = null;

    if (fmt === 'party') {
      for (const m of playing) m.totalScore += res.get(m.id)!.score;
    } else if (fmt === 'duel') {
      const [a, b] = playing;
      if (a && b) {
        const sa = res.get(a.id)!.score, sb = res.get(b.id)!.score;
        if (sa !== sb) {
          const loser = sa < sb ? a : b;
          const dmg = Math.round(Math.abs(sa - sb) * r.multiplier);
          loser.health = Math.max(0, loser.health - dmg);
          res.get(loser.id)!.damage = dmg;
        }
      }
      for (const m of playing) { m.totalScore += res.get(m.id)!.score; res.get(m.id)!.healthAfter = m.health; }
    } else if (fmt === 'teamduel') {
      const teamScore = (t: number) => Math.max(0, ...playing.filter((m) => m.team === t).map((m) => res.get(m.id)!.score));
      const s0 = teamScore(0), s1 = teamScore(1);
      const health = [this.teamHealth(0), this.teamHealth(1)];
      const dmg = [0, 0];
      if (s0 !== s1) { const loser = s0 < s1 ? 0 : 1; dmg[loser] = Math.round(Math.abs(s0 - s1) * r.multiplier); }
      for (const t of [0, 1]) {
        const h = Math.max(0, health[t] - dmg[t]);
        for (const m of this.members.values()) if (m.team === t && !m.spectator) m.health = h;
      }
      teams = [0, 1].map((t) => ({ team: t, score: t === 0 ? s0 : s1, damage: dmg[t], healthAfter: this.teamHealth(t) }));
      for (const m of playing) { m.totalScore += res.get(m.id)!.score; res.get(m.id)!.healthAfter = m.health; }
    } else if (fmt === 'br_countries') {
      const losers = playing.filter((m) => !res.get(m.id)!.correct);
      if (this.settings.slowestLosesLife && losers.length === 0 && playing.length > 1) {
        const slowest = [...playing].sort((x, y) => (res.get(y.id)!.guessedAt ?? 0) - (res.get(x.id)!.guessedAt ?? 0))[0];
        losers.push(slowest);
        note = `Everyone was right — ${slowest.username} was slowest and loses a life.`;
      }
      const wouldDie = losers.filter((m) => m.lives <= 1);
      if (wouldDie.length === playing.length && playing.length > 0) {
        note = 'Everyone would have been eliminated — nobody loses a life this round.';
      } else {
        for (const m of losers) {
          m.lives -= 1;
          res.get(m.id)!.damage = 1;
          if (m.lives <= 0) { m.alive = false; m.eliminatedRound = r.idx; res.get(m.id)!.eliminated = true; }
        }
      }
      for (const m of playing) { res.get(m.id)!.livesAfter = m.lives; if (res.get(m.id)!.correct) m.totalScore += 1; }
    } else if (fmt === 'br_distance') {
      const guessed = playing.filter((m) => r.guesses.has(m.id));
      if (guessed.length === 0) note = 'Nobody guessed — nobody is eliminated.';
      else {
        const missed = playing.filter((m) => !r.guesses.has(m.id));
        const ranked = guessed.sort((x, y) => {
          const gx = r.guesses.get(x.id)!, gy = r.guesses.get(y.id)!;
          return gx.distanceKm - gy.distanceKm || gx.at - gy.at;
        });
        let out: Member[] = [...missed];
        const k = Math.min(this.settings.eliminatePerRound, playing.length - 1);
        if (out.length < k) out = out.concat(ranked.slice(ranked.length - (k - out.length)));
        if (out.length >= playing.length) out = out.filter((m) => m !== ranked[0]); // someone always survives
        for (const m of out) { m.alive = false; m.eliminatedRound = r.idx; res.get(m.id)!.eliminated = true; }
      }
      for (const m of playing) m.totalScore += res.get(m.id)!.score;
    }

    const result: RoundResult = {
      idx: r.idx, number: r.idx + 1, multiplier: r.multiplier,
      answer: { lat: loc.lat, lng: loc.lng, country: loc.country, countryName: countryName(loc.country), provider: loc.provider, panoId: loc.pano_id },
      players: [...res.values()], teams, note,
    };
    this.history.push(result);
    this.lastResult = result;
    this.round = null;

    const end = this.endCheck(r.idx);
    if (end) { this.finish(end); return; }
    this.status = 'reveal';
    this.revealEndsAt = this.clock.now() + TIMING.revealMs;
    this.broadcast();
    this.prefetchAndContinue(r.idx + 1);
  }

  private nextLoc: Promise<LocRow | null> | null = null;
  private prefetchAndContinue(nextIdx: number) {
    const epoch = this.epoch;
    this.nextLoc = this.nextLocation();
    this.schedule(TIMING.revealMs, () => this.advance(nextIdx, epoch));
  }

  continueReady(userId: string) {
    const m = this.members.get(userId);
    if (this.status !== 'reveal' || !m) return;
    m.continueReady = true;
    this.broadcast();
    this.maybeContinue();
  }
  private maybeContinue() {
    if (this.status !== 'reveal') return;
    const waiting = this.active().filter((m) => m.connected && !m.continueReady);
    if (waiting.length === 0 && this.lastResult) this.advance(this.lastResult.idx + 1, this.epoch);
  }

  private async advance(nextIdx: number, epoch: number) {
    if (this.status !== 'reveal' || epoch !== this.epoch) return;
    this.status = 'starting';
    this.startsAt = this.clock.now();
    if (this.timer) { this.clock.clearTimeout(this.timer); this.timer = null; }
    const loc = await (this.nextLoc ?? this.nextLocation());
    this.nextLoc = null;
    if (epoch !== this.epoch || this.status !== 'starting') return;
    if (!loc) { this.finish('pool_exhausted'); return; }
    this.beginRound(nextIdx, loc);
  }

  teamHealth(t: number): number {
    const ms = [...this.members.values()].filter((m) => m.team === t && !m.spectator);
    return ms.length ? ms[0].health : 0;
  }

  private endCheck(idx: number): FinalResult['reason'] | null {
    const fmt = this.settings.format;
    const playing = this.active();
    if (fmt === 'party') return idx + 1 >= this.settings.rounds ? 'completed' : null;
    if (fmt === 'duel') {
      if (playing.length < 2) return 'forfeit';
      if (playing.some((m) => m.health <= 0)) return 'health';
      return idx + 1 >= TIMING.maxDuelRounds ? 'round_cap' : null;
    }
    if (fmt === 'teamduel') {
      for (const t of [0, 1]) if (!playing.some((m) => m.team === t)) return 'forfeit';
      if (this.teamHealth(0) <= 0 || this.teamHealth(1) <= 0) return 'health';
      return idx + 1 >= TIMING.maxDuelRounds ? 'round_cap' : null;
    }
    if (playing.length <= 1) return this.players.length + [...this.members.values()].filter((m) => m.forfeited).length > 1 ? 'elimination' : null;
    return idx + 1 >= TIMING.maxBrRounds ? 'round_cap' : null;
  }

  private afterForfeit(m: Member) {
    if (this.status === 'round') this.maybeEndRoundEarly();
    const fmt = this.settings.format;
    const playing = this.active();
    const decided = (fmt === 'duel' && playing.length < 2)
      || (fmt === 'teamduel' && [0, 1].some((t) => !playing.some((x) => x.team === t)))
      || ((fmt === 'br_countries' || fmt === 'br_distance') && playing.length <= 1)
      || playing.length === 0;
    if (decided && (this.status === 'round' || this.status === 'reveal' || this.status === 'starting')) this.finish('forfeit');
    else if (this.status === 'reveal') this.maybeContinue();
    void m;
  }

  // ------------------------------------------------------------------ results
  private finish(reason: FinalResult['reason']) {
    if (this.timer) { this.clock.clearTimeout(this.timer); this.timer = null; }
    this.epoch++;
    this.round = null;
    const fmt = this.settings.format;
    const roster = [...this.members.values()].filter((m) => !m.spectator || m.forfeited);
    const placements: FinalResult['placements'] = [];
    let winnerTeam: number | null = null;
    const push = (m: Member, placement: number, outcome: 'win' | 'loss' | 'draw') =>
      placements.push({ userId: m.id, username: m.username, team: m.team, placement, outcome, totalScore: m.totalScore, forfeited: m.forfeited });

    if (fmt === 'duel' || fmt === 'teamduel') {
      // Side = player (duel) or team (team duel). A side that forfeited entirely loses.
      const sides = fmt === 'duel' ? roster.map((m) => [m]) : [0, 1].map((t) => roster.filter((m) => m.team === t));
      const alive = (side: Member[]) => side.some((m) => !m.forfeited);
      const hp = (side: Member[]) => (alive(side) ? Math.max(...side.map((m) => m.health)) : -1);
      const ranked = [...sides].sort((a, b) => hp(b) - hp(a));
      const draw = ranked.length === 2 && hp(ranked[0]) === hp(ranked[1]);
      ranked.forEach((side, i) => side.forEach((m) => push(m, draw ? 1 : i + 1, draw ? 'draw' : i === 0 ? 'win' : 'loss')));
      if (fmt === 'teamduel' && !draw) winnerTeam = ranked[0][0]?.team ?? null;
    } else if (fmt === 'party') {
      if (this.settings.teams) {
        const teamTotal = (t: number) => {
          let sum = 0;
          for (const h of this.history) {
            const ps = h.players.filter((p) => p.team === t);
            if (ps.length) sum += ps.reduce((a, p) => a + p.score, 0) / ps.length;
          }
          return Math.round(sum);
        };
        const totals = [teamTotal(0), teamTotal(1)];
        const draw = totals[0] === totals[1];
        winnerTeam = draw ? null : totals[0] > totals[1] ? 0 : 1;
        for (const m of roster) {
          const won = winnerTeam === m.team;
          push(m, draw ? 1 : won ? 1 : 2, m.forfeited ? 'loss' : draw ? 'draw' : won ? 'win' : 'loss');
        }
      } else {
        const sorted = [...roster].sort((a, b) => Number(a.forfeited) - Number(b.forfeited) || b.totalScore - a.totalScore);
        let place = 0, last = -1;
        sorted.forEach((m, i) => { if (m.totalScore !== last || m.forfeited) { place = i + 1; last = m.totalScore; } push(m, place, 'loss'); });
        const winners = placements.filter((p) => p.placement === 1 && !p.forfeited);
        for (const p of placements) if (p.placement === 1 && !p.forfeited) p.outcome = winners.length > 1 ? 'draw' : 'win';
      }
    } else {
      // Battle royale: survivors first, then by the round they were eliminated (later is better), forfeits last.
      const key = (m: Member) => (m.forfeited ? -2 : m.alive ? 1e6 : m.eliminatedRound ?? -1);
      const sorted = [...roster].sort((a, b) => key(b) - key(a) || b.totalScore - a.totalScore);
      let place = 0, lastKey = NaN;
      sorted.forEach((m, i) => { if (key(m) !== lastKey) { place = i + 1; lastKey = key(m); } push(m, place, 'loss'); });
      const winners = placements.filter((p) => p.placement === 1 && !p.forfeited);
      for (const p of winners) p.outcome = winners.length > 1 ? 'draw' : 'win';
    }
    const matchId = uid();
    this.final = { reason, placements, winnerTeam, matchId };
    this.status = 'finished';
    for (const m of this.members.values()) m.ready = false;
    this.persist('finished');
    this.broadcast();
  }

  private persist(status: 'finished' | 'abandoned') {
    try {
      const id = this.final?.matchId ?? uid();
      const t = this.clock.now();
      const tx = db.transaction(() => {
        db.prepare('INSERT INTO matches(id, mode, status, room_code, config, result, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, this.settings.format, status, this.code, JSON.stringify(this.settings), JSON.stringify(this.final ?? {}), this.matchStartedAt, t);
        const placements = this.final?.placements ?? this.players.map((m) => ({ userId: m.id, team: m.team, placement: null, outcome: null, totalScore: m.totalScore, forfeited: m.forfeited }));
        for (const p of placements) {
          db.prepare('INSERT OR IGNORE INTO match_players(match_id, user_id, team, placement, outcome, total_score, forfeited) VALUES (?,?,?,?,?,?,?)')
            .run(id, p.userId, p.team, p.placement, p.outcome, p.totalScore, p.forfeited ? 1 : 0);
        }
        for (const h of this.history) {
          const locId = db.prepare('SELECT id FROM locations WHERE provider=? AND pano_id=?').get(h.answer.provider, h.answer.panoId) as any;
          db.prepare('INSERT OR IGNORE INTO match_rounds(match_id, idx, location_id, summary) VALUES (?,?,?,?)').run(id, h.idx, locId?.id ?? '', JSON.stringify(h));
        }
      });
      tx();
      if (status === 'finished' && this.final) {
        for (const p of this.final.placements) {
          const xp = 15 + Math.min(60, this.history.length * 6) + (p.outcome === 'win' ? 50 : p.outcome === 'draw' ? 20 : 0) - (p.forfeited ? 15 : 0);
          awardXp(p.userId, xp);
          checkAchievements(p.userId);
        }
      }
    } catch (err) {
      console.error('[room] failed to persist match', err);
    }
  }

  rematch(userId: string) {
    this.requireHost(userId);
    if (this.status !== 'finished') throw new RoomError('The game is still running.');
    for (const m of [...this.members.values()]) {
      if (m.left && !m.connected) { this.members.delete(m.id); continue; }
      if (m.left) { m.left = false; m.spectator = false; m.team = this.autoTeam(); }
      m.ready = false; m.forfeited = false; m.alive = true; m.totalScore = 0; m.eliminatedRound = null;
      if (m.spectator && m.connected) { m.spectator = false; m.team = this.autoTeam(); }
    }
    this.status = 'lobby';
    this.final = null; this.lastResult = null; this.history = []; this.round = null;
    this.broadcast();
  }

  // ------------------------------------------------------------------ chat
  sendChat(userId: string, input: { text?: string; preset?: number }) {
    const m = this.members.get(userId);
    if (!m) return;
    const t = this.clock.now();
    m.chatTimes = m.chatTimes.filter((x) => t - x < 10_000);
    if (m.chatTimes.length >= 5) throw new RoomError('Slow down a little.', 'rate_limited');
    let text: string, preset = false;
    if (typeof input.preset === 'number' && CHAT_PRESETS[input.preset]) { text = CHAT_PRESETS[input.preset]; preset = true; }
    else {
      text = String(input.text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
      if (!text) return;
      text = text.replace(PROFANITY, (w) => w[0] + '*'.repeat(w.length - 1));
    }
    m.chatTimes.push(t);
    this.chat.push({ id: uid(), userId, username: m.username, text, preset, at: t });
    if (this.chat.length > 60) this.chat.splice(0, this.chat.length - 60);
    this.broadcast();
  }
  private systemMessage(text: string) {
    this.chat.push({ id: uid(), userId: 'system', username: 'Nearabouts', text, preset: false, at: this.clock.now() });
    if (this.chat.length > 60) this.chat.splice(0, this.chat.length - 60);
  }

  // ------------------------------------------------------------------ snapshots
  snapshot(viewerId: string) {
    const r = this.round;
    const viewer = this.members.get(viewerId);
    const map = getMap(this.settings.mapSlug);
    const showGuess = (id: string) => id === viewerId || (viewer?.team != null && this.members.get(id)?.team === viewer.team && this.teamMode());
    return {
      code: this.code, status: this.status, hostId: this.hostId, you: viewerId, settings: this.settings,
      formatInfo: FORMAT_INFO[this.settings.format],
      map: map ? { slug: map.slug, name: map.name, scaleKm: map.scale_km } : null,
      demo: !imagery.live,
      members: [...this.members.values()].filter((m) => !m.left || m.forfeited).map((m) => ({
        id: m.id, username: m.username, avatar: m.avatar, team: m.team, ready: m.ready, connected: m.connected, spectator: m.spectator,
        left: m.left, forfeited: m.forfeited, health: m.health, lives: m.lives, alive: m.alive, eliminatedRound: m.eliminatedRound, totalScore: m.totalScore,
        guessed: !!r?.guesses.has(m.id), continueReady: m.continueReady,
      })),
      teams: this.settings.format === 'teamduel' && this.status !== 'lobby' ? [0, 1].map((t) => ({ team: t, health: this.teamHealth(t) })) : null,
      round: r ? {
        idx: r.idx, number: r.idx + 1, startedAt: r.startedAt, endsAt: r.endsAt, countdownEndsAt: r.countdownEndsAt, multiplier: r.multiplier,
        pano: panoPayload(r.loc),
        guesses: [...r.guesses.entries()].filter(([id]) => showGuess(id)).map(([id, g]) => ({ userId: id, lat: g.lat, lng: g.lng })),
      } : null,
      startsAt: this.startsAt, revealEndsAt: this.revealEndsAt,
      lastResult: this.status === 'reveal' || this.status === 'finished' ? this.lastResult : null,
      history: this.history.map((h) => ({ idx: h.idx, number: h.number, multiplier: h.multiplier, answer: h.answer, players: h.players.map((p) => ({ userId: p.userId, score: p.score, distanceKm: p.distanceKm, correct: p.correct, damage: p.damage, eliminated: p.eliminated })) })),
      final: this.final,
      chat: this.chat.filter((c) => c.userId === 'system' || c.userId === viewerId || !this.transport.blockedPairs(viewerId, c.userId)),
      startProblem: this.status === 'lobby' ? this.startProblem() : null,
      error: this.error,
      serverNow: this.clock.now(),
    };
  }

  broadcast() {
    for (const m of this.members.values()) if (m.connected) this.transport.send(m.id, 'room:state', this.snapshot(m.id));
  }
}
export type RoomSnapshot = ReturnType<Room['snapshot']>;
export const roomHelpers = { json };
