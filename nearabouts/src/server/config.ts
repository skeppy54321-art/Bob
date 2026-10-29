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
/** Reads <PREFIX>_TILE_URL / _TILE_ATTRIBUTION / _MAX_ZOOM with defaults; "none" disables the layer. */
function tileLayer(prefix: string, url: string, attribution: string, maxZoom: number) {
  const u = env[`${prefix}_TILE_URL`] || url; // empty = use the default
  if (u === 'none') return null;
  return { url: u, attribution: env[`${prefix}_TILE_ATTRIBUTION`] || attribution, maxZoom: int(env[`${prefix}_MAX_ZOOM`], maxZoom) };
}

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
  /**
   * Guess-map layers. Each can be overridden; set a URL to "none" to turn that layer off.
   * Defaults are free services meant for non-commercial use (see README → "Guess map").
   */
  tiles: {
    satellite: tileLayer('SATELLITE', 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
      'Sentinel-2 cloudless — <a href="https://s2maps.eu">s2maps.eu</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)', 15),
    streets: tileLayer('STREET', env.MAP_TILE_URL || 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      env.MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>', 19),
    labels: tileLayer('LABELS', 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>', 19),
  },
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY === 'true',
  /** Multiplayer timings (ms) — overridable for tests. */
  reconnectGraceMs: int(env.RECONNECT_GRACE_MS, 45_000),
  roomIdleMs: int(env.ROOM_IDLE_MS, 5 * 60_000),
};
