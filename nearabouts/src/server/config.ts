/** Server configuration from environment variables. See .env.example for documentation. */
import { existsSync, readFileSync } from 'node:fs';

// Minimal .env loader (no extra dependency). Real environment variables win.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export type ProviderId = 'demo' | 'mapillary' | 'google';

export const config = {
  port: int(env.PORT, 8787),
  host: env.HOST ?? '0.0.0.0',
  isProd: env.NODE_ENV === 'production',
  dbPath: env.DATABASE_PATH ?? 'data/nearabouts.sqlite',
  /** Public URL of the site, used for share links. Optional; the browser origin is used otherwise. */
  publicUrl: env.PUBLIC_URL ?? '',
  /** Which imagery provider powers live games. Falls back to demo when its credentials are missing. */
  imageryProvider: (env.IMAGERY_PROVIDER ?? 'demo') as ProviderId,
  mapillaryToken: env.MAPILLARY_CLIENT_TOKEN ?? '',
  googleBrowserKey: env.GOOGLE_MAPS_BROWSER_KEY ?? '',
  googleServerKey: env.GOOGLE_MAPS_SERVER_KEY ?? '',
  /** Max imagery-provider lookups per UTC day (cost safeguard). */
  providerDailyBudget: int(env.PROVIDER_DAILY_BUDGET, 2000),
  /** Optional tile server for the guessing map. Empty = built-in vector basemap only. */
  tileUrl: env.MAP_TILE_URL ?? '',
  tileAttribution: env.MAP_TILE_ATTRIBUTION ?? '',
  adminUsernames: (env.ADMIN_USERNAMES ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY === 'true',
  /** Multiplayer timings (ms) — overridable for tests. */
  reconnectGraceMs: int(env.RECONNECT_GRACE_MS, 45_000),
  roomIdleMs: int(env.ROOM_IDLE_MS, 5 * 60_000),
};
