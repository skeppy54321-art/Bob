/**
 * Imagery provider abstraction. A provider knows how to (1) find real, playable imagery near a
 * coordinate and (2) re-check that a stored panorama still exists. The browser has a matching
 * viewer adapter per provider (src/web/pano/*). Add a provider by implementing this interface and
 * registering it in imagery/index.ts.
 */
export interface Attribution { text: string; url?: string; license?: string }

export interface PanoRef {
  provider: string;
  panoId: string;
  lat: number;
  lng: number;
  heading: number;
  attribution: Attribution;
  meta?: Record<string, unknown>;
}

export interface ImageryProvider {
  id: string;
  label: string;
  /** true = real street-level imagery from a third party. false = illustrative demo scenes. */
  live: boolean;
  /** Values the browser needs (never secrets). */
  clientConfig(): Record<string, unknown>;
  /** Find verified imagery within radiusM of the point, or null. */
  findNear(lat: number, lng: number, radiusM: number): Promise<PanoRef | null>;
  /** Confirm the panorama is still available. */
  validate(panoId: string): Promise<boolean>;
}
