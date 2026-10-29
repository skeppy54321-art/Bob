import type { ImageryProvider, PanoRef } from './provider.ts';
import { DEMO_LIBRARY, demoSun, demoPanoId } from './demoLibrary.ts';
import { hashString } from '../../shared/geo.ts';
import { haversineKm } from '../../shared/geo.ts';

/** Look up by library id or by opaque panorama id. */
export function demoRef(id: string): PanoRef | null {
  const d = DEMO_LIBRARY.find((x) => x.id === id || demoPanoId(x.id) === id);
  if (!d) return null;
  return {
    provider: 'demo', panoId: demoPanoId(d.id), lat: d.lat, lng: d.lng, heading: 0,
    attribution: { text: 'Demo scene drawn by Nearabouts (illustrative, not a photograph)' },
    meta: { biome: d.biome, line: d.line, side: d.side, sun: demoSun(d.lat), seed: hashString(d.id) },
  };
}

export const demoProvider: ImageryProvider = {
  id: 'demo',
  label: 'Demo scenes (illustrative)',
  live: false,
  clientConfig: () => ({}),
  async findNear(lat, lng, radiusM) {
    let best: { id: string; d: number } | null = null;
    for (const x of DEMO_LIBRARY) {
      const d = haversineKm({ lat, lng }, x) * 1000;
      if (d <= radiusM && (!best || d < best.d)) best = { id: x.id, d };
    }
    return best ? demoRef(best.id) : null;
  },
  async validate(panoId) {
    return DEMO_LIBRARY.some((x) => demoPanoId(x.id) === panoId);
  },
};
