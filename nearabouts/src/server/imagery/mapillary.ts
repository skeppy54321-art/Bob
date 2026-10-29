/**
 * Mapillary provider (https://www.mapillary.com/developer). Imagery is contributed by the
 * community and licensed CC BY-SA 4.0; each round shows the photographer's username and a link
 * back to Mapillary. Requires MAPILLARY_CLIENT_TOKEN (free, from the developer dashboard).
 * The same client token is used by MapillaryJS in the browser, so it is public by design.
 *
 * NOTE: written against the Graph API v4 as documented at the time of writing; it could not be
 * exercised from the development sandbox (no network access to graph.mapillary.com).
 */
import type { ImageryProvider, PanoRef } from './provider.ts';
import { circleBBox } from '../../shared/geo.ts';
import { spendBudget } from './budget.ts';

const GRAPH = 'https://graph.mapillary.com';

export function mapillaryProvider(token: string): ImageryProvider {
  async function get(path: string, params: Record<string, string>): Promise<any> {
    if (!spendBudget('mapillary')) throw new Error('Daily imagery lookup budget reached');
    const qs = new URLSearchParams({ access_token: token, ...params });
    const res = await fetch(`${GRAPH}${path}?${qs}`, { signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Mapillary ${res.status}`);
    return res.json();
  }
  const fields = 'id,computed_geometry,geometry,compass_angle,computed_compass_angle,is_pano,creator,captured_at';
  const toRef = (img: any): PanoRef => {
    const g = img.computed_geometry ?? img.geometry;
    const user = img.creator?.username;
    return {
      provider: 'mapillary', panoId: String(img.id), lat: g.coordinates[1], lng: g.coordinates[0],
      heading: Number(img.computed_compass_angle ?? img.compass_angle ?? 0),
      attribution: { text: `Image by ${user ? '@' + user : 'a Mapillary contributor'} on Mapillary`, license: 'CC BY-SA 4.0', url: `https://www.mapillary.com/app/?pKey=${img.id}` },
      meta: { capturedAt: img.captured_at },
    };
  };
  return {
    id: 'mapillary',
    label: 'Mapillary (CC BY-SA)',
    live: true,
    clientConfig: () => ({ accessToken: token }),
    async findNear(lat, lng, radiusM) {
      const b = circleBBox({ lat, lng }, Math.min(radiusM, 5000) / 1000);
      const data = await get('/images', { fields, bbox: b.map((n) => n.toFixed(6)).join(','), is_pano: 'true', limit: '25' });
      const imgs: any[] = data?.data ?? [];
      if (!imgs.length) return null;
      const dist = (i: any) => { const c = (i.computed_geometry ?? i.geometry).coordinates; return (c[1] - lat) ** 2 + ((c[0] - lng) * Math.cos((lat * Math.PI) / 180)) ** 2; };
      imgs.sort((a, b2) => dist(a) - dist(b2));
      return toRef(imgs[0]);
    },
    async validate(panoId) {
      try { return !!(await get(`/${encodeURIComponent(panoId)}`, { fields: 'id' }))?.id; } catch { return true; /* network trouble: don't drop the location */ }
    },
  };
}
