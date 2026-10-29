/** Multiplayer room settings and defaults (shared by server and lobby UI). */
import type { Movement, Difficulty } from './rules.ts';
import { MAX_ROOM_PLAYERS } from './rules.ts';

export type Format = 'party' | 'duel' | 'teamduel' | 'br_countries' | 'br_distance';

export interface RoomSettings {
  format: Format;
  mapSlug: string;
  movement: Movement;
  difficulty: Difficulty;
  /** Seconds per round. 0 (untimed) is only allowed for party games. */
  timeLimit: number;
  /** Party: number of rounds. */
  rounds: number;
  /** Party: score as two teams. */
  teams: boolean;
  /** Duels / team duels: starting health. */
  startHealth: number;
  /** Duels, team duels, BR distance: once the first guess lands, everyone else has this many seconds (0 = off). */
  countdownAfterGuess: number;
  /** Duels / team duels: damage multiplier grows by `multiplierStep` each round from round `multiplierFrom`. */
  multiplierFrom: number;
  multiplierStep: number;
  /** BR countries: lives per player. */
  lives: number;
  /** BR countries: when everyone is right, the slowest correct player loses a life. */
  slowestLosesLife: boolean;
  /** BR distance: players eliminated per round. */
  eliminatePerRound: number;
}

export const FORMAT_INFO: Record<Format, { name: string; min: number; max: number; summary: string; rules: string[] }> = {
  party: {
    name: 'Party classic', min: 1, max: MAX_ROOM_PLAYERS,
    summary: 'Everyone plays the same rounds. Highest total wins.',
    rules: [
      'Each round scores up to 5,000 points by distance.',
      'With teams on, a team’s round score is the average of its members’ scores (a missed guess counts as 0), so uneven teams stay fair.',
      'Ties share the same place.',
    ],
  },
  duel: {
    name: 'Duel (1v1)', min: 2, max: 2,
    summary: 'Both players start with health. The worse guess takes damage.',
    rules: [
      'Damage = (better score − worse score) × round multiplier.',
      'After the first guess, the other player has a short countdown.',
      'A missed guess scores 0. If both miss, nobody takes damage.',
      'First to 0 health loses. After 40 rounds the higher health wins; equal health is a draw.',
      'Leaving or staying disconnected past the grace period forfeits.',
    ],
  },
  teamduel: {
    name: 'Team duel', min: 2, max: MAX_ROOM_PLAYERS,
    summary: 'Two teams (up to 5 each) share one health pool per team.',
    rules: [
      'A team’s round score is its best (closest) guess.',
      'Damage = (better team score − worse team score) × round multiplier, taken from the shared pool.',
      'Countdown starts after the first guess from anyone.',
      'A team whose players all leave forfeits.',
    ],
  },
  br_countries: {
    name: 'Battle Royale: Countries', min: 2, max: MAX_ROOM_PLAYERS,
    summary: 'Click inside the right country before the timer ends.',
    rules: [
      'A wrong or missing answer costs one life. Zero lives = eliminated.',
      'If everyone left would be eliminated in the same round, nobody loses a life that round.',
      'Optional: when everyone is right, the slowest correct player loses a life.',
      'Last player standing wins; after 40 rounds, survivors share the win.',
    ],
  },
  br_distance: {
    name: 'Battle Royale: Distance', min: 2, max: MAX_ROOM_PLAYERS,
    summary: 'The farthest guesses are eliminated each round.',
    rules: [
      'Each round the farthest guess(es) are eliminated (missed guesses count as farthest).',
      'Equal distances: the later guess is eliminated.',
      'If nobody guesses, nobody is eliminated.',
      'Last player standing wins.',
    ],
  },
};

export const FORMAT_DEFAULTS: Record<Format, Partial<RoomSettings>> = {
  party: { timeLimit: 120, rounds: 5 },
  duel: { timeLimit: 120, countdownAfterGuess: 15 },
  teamduel: { timeLimit: 120, countdownAfterGuess: 15 },
  br_countries: { timeLimit: 30, countdownAfterGuess: 0 },
  br_distance: { timeLimit: 60, countdownAfterGuess: 20 },
};

export const BASE_SETTINGS: RoomSettings = {
  format: 'party', mapSlug: 'world', movement: 'moving', difficulty: 'normal', timeLimit: 120, rounds: 5, teams: false,
  startHealth: 6000, countdownAfterGuess: 15, multiplierFrom: 4, multiplierStep: 0.5, lives: 3, slowestLosesLife: false, eliminatePerRound: 1,
};

export function multiplierFor(roundNumber: number, s: Pick<RoomSettings, 'multiplierFrom' | 'multiplierStep'>): number {
  if (roundNumber < s.multiplierFrom) return 1;
  return Math.min(6, 1 + s.multiplierStep * (roundNumber - s.multiplierFrom + 1));
}

export const CHAT_PRESETS = ['Good luck!', 'gg', 'Nice guess!', 'So close!', 'Where even is this?', 'Wow!', 'Oops', 'Rematch?'];
