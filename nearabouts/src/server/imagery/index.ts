import { config } from '../config.ts';
import { demoProvider } from './demo.ts';
import { mapillaryProvider } from './mapillary.ts';
import type { ImageryProvider } from './provider.ts';

function choose(): { provider: ImageryProvider; warning?: string } {
  if (config.imageryProvider === 'mapillary') {
    if (config.mapillaryToken) return { provider: mapillaryProvider(config.mapillaryToken) };
    return { provider: demoProvider, warning: 'IMAGERY_PROVIDER=mapillary but MAPILLARY_CLIENT_TOKEN is empty — running in DEMO mode.' };
  }
  return { provider: demoProvider };
}
const chosen = choose();
if (chosen.warning) console.warn(chosen.warning);

/** The provider used for new games. */
export const imagery: ImageryProvider = chosen.provider;
export const providers: Record<string, ImageryProvider> = { demo: demoProvider, [imagery.id]: imagery };
export type { ImageryProvider, PanoRef } from './provider.ts';
