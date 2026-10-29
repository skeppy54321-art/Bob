// Response shapes shared with the server (type-only imports are erased from the bundle).
export type { GameView } from '../../server/games.ts';
export type { RoomSnapshot, RoundResult, FinalResult } from '../../server/multi/room.ts';
export type { PanoPayload } from '../../server/locations.ts';
export type { RoomSettings, Format } from '../../shared/room.ts';
export type { GameRules, Movement, Difficulty, GameMode } from '../../shared/rules.ts';

export interface AvatarConfig { shape?: number; hue?: number; accent?: number; face?: number; pattern?: number }
export interface PublicUser { id: string; username: string; avatar: AvatarConfig; guest: boolean; xp: number }
export interface Me extends PublicUser {
  email: string | null; bio: string; admin: boolean; createdAt: number;
  settings: { units?: 'km' | 'mi'; reducedMotion?: boolean; mapStyle?: string };
  level: { level: number; current: number; next: number; progress: number };
}
export interface AppConfig {
  provider: { id: string; label: string; live: boolean; client: Record<string, any> };
  demo: boolean;
  tiles: { url: string; attribution: string } | null;
  modes: { id: string; name: string; blurb: string; solo: boolean }[];
  maxRoomPlayers: number;
}
export interface MapSummary {
  id: string; slug: string; name: string; description: string; category: string; kind: string; creator: string | null; builtin: boolean;
  featured: boolean; visibility: string; plays: number; favorites: number; favorited: boolean; scaleKm: number; playable: number;
  tags: string[]; countryCode: string | null; updatedAt: number; isOwner: boolean;
}
