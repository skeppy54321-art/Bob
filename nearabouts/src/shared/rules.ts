/** Game rules shared by the server (authoritative) and the client (UI gating). */
export type Movement = 'moving' | 'nomove' | 'nmpz';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface GameRules {
  movement: Movement;
  /** seconds per round; 0 = untimed */
  timeLimit: number;
  rounds: number;
  difficulty: Difficulty;
}

export const DEFAULT_RULES: GameRules = { movement: 'moving', timeLimit: 0, rounds: 5, difficulty: 'normal' };
export const MOVEMENT_LABELS: Record<Movement, string> = { moving: 'Moving', nomove: 'No Move', nmpz: 'No Move, Pan, Zoom' };
export const MOVEMENT_HELP: Record<Movement, string> = {
  moving: 'Look around, zoom and travel along roads.',
  nomove: 'Look around and zoom, but you cannot travel.',
  nmpz: 'A single fixed view: no travel, no panning, no zooming.',
};
export const TIME_PRESETS = [0, 30, 60, 90, 120, 180, 300];
export const MAX_ROUNDS = 20;
export const MIN_TIME = 10;
export const MAX_TIME = 600;

export interface AllowedActions { move: boolean; pan: boolean; zoom: boolean }
export function allowedActions(movement: Movement): AllowedActions {
  return { move: movement === 'moving', pan: movement !== 'nmpz', zoom: movement !== 'nmpz' };
}

export function normalizeRules(input: Partial<GameRules> | undefined, base: GameRules = DEFAULT_RULES): GameRules {
  const r = { ...base, ...(input ?? {}) };
  const movement: Movement = (['moving', 'nomove', 'nmpz'] as const).includes(r.movement as Movement) ? r.movement : base.movement;
  const difficulty: Difficulty = (['easy', 'normal', 'hard'] as const).includes(r.difficulty as Difficulty) ? r.difficulty : base.difficulty;
  let timeLimit = Math.round(Number(r.timeLimit));
  if (!Number.isFinite(timeLimit) || timeLimit < 0) timeLimit = base.timeLimit;
  if (timeLimit > 0) timeLimit = Math.min(MAX_TIME, Math.max(MIN_TIME, timeLimit));
  let rounds = Math.round(Number(r.rounds));
  if (!Number.isFinite(rounds)) rounds = base.rounds;
  rounds = Math.min(MAX_ROUNDS, Math.max(1, rounds));
  return { movement, timeLimit, rounds, difficulty };
}

/** Server tolerance for network latency when a guess arrives right at the deadline. */
/** Private rooms hold at most this many players. */
export const MAX_ROOM_PLAYERS = 10;

export const GUESS_GRACE_MS = 1500;

export type GameMode =
  | 'classic' | 'quick' | 'daily' | 'streak_country' | 'streak_state' | 'explorer' | 'challenge'
  | 'duel' | 'teamduel' | 'br_countries' | 'br_distance' | 'party';

export interface ModeInfo { id: GameMode; name: string; blurb: string; solo: boolean }
export const MODES: ModeInfo[] = [
  { id: 'classic', name: 'Classic', blurb: 'Five rounds on any map. Closest guesses score the most.', solo: true },
  { id: 'quick', name: 'Quick play', blurb: 'A fast 3-round world game, 60 seconds a round.', solo: true },
  { id: 'daily', name: 'Daily challenge', blurb: 'Same five places for everyone today. Build a streak.', solo: true },
  { id: 'streak_country', name: 'Country streak', blurb: 'Name the country. Keep going until you miss.', solo: true },
  { id: 'streak_state', name: 'US state streak', blurb: 'Name the US state. One wrong guess ends the run.', solo: true },
  { id: 'explorer', name: 'Explorer', blurb: 'Earn medals country by country.', solo: true },
  { id: 'challenge', name: 'Challenge a friend', blurb: 'Share a link so friends play your exact locations.', solo: true },
  { id: 'duel', name: 'Duels (1v1)', blurb: 'Same places, health bars, damage from score gaps.', solo: false },
  { id: 'teamduel', name: 'Team duels (2v2)', blurb: 'Two teams, one shared health pool each.', solo: false },
  { id: 'br_countries', name: 'Battle Royale: Countries', blurb: 'Name the country before time runs out or lose a life.', solo: false },
  { id: 'br_distance', name: 'Battle Royale: Distance', blurb: 'The farthest guess is eliminated each round.', solo: false },
  { id: 'party', name: 'Party classic', blurb: 'Everyone plays the same rounds; highest total wins. Optional teams.', solo: false },
];
