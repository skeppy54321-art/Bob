/**
 * Provider-agnostic panorama viewer. Picks an adapter from `pano.provider`:
 *  - demo:      our WebGL viewer + procedural scene (supports travelling along the road)
 *  - mapillary: MapillaryJS (loaded on demand)
 * Movement rules (Moving / No Move / NMPZ) are enforced by each adapter.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PanoPayload, Movement } from '../lib/types.ts';
import { allowedActions } from '../../shared/rules.ts';
import { EquirectViewer, FOV_DEFAULT } from '../pano/equirect.ts';
import { renderDemoScene, MAX_STEPS, type DemoScene } from '../pano/demoScene.ts';
import { useApp } from '../lib/store.tsx';

export interface PanoHandle {
  look(dYaw: number, dPitch: number): void;
  zoom(factor: number): void;
  faceNorth(): void;
  reset(): void;
  move(dir: 1 | -1): void;
}

interface Props {
  pano: PanoPayload;
  movement: Movement;
  onHeading?: (deg: number) => void;
  onError?: (message: string) => void;
}

export const PanoViewer = forwardRef<PanoHandle, Props>(function PanoViewer({ pano, movement, onHeading, onError }, ref) {
  if (pano.provider === 'mapillary') return <MapillaryPano ref={ref} pano={pano} movement={movement} onHeading={onHeading} onError={onError} />;
  if (pano.provider === 'demo') return <DemoPano ref={ref} pano={pano} movement={movement} onHeading={onHeading} onError={onError} />;
  return <div className="pano-loading">Unsupported imagery provider “{pano.provider}”.</div>;
});

// ------------------------------------------------------------------ demo
const DemoPano = forwardRef<PanoHandle, Props>(function DemoPano({ pano, movement, onHeading, onError }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<EquirectViewer | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [heading, setHeading] = useState(pano.heading);
  const allowed = allowedActions(movement);
  const scene = (pano as any).scene as DemoScene;
  const cache = useRef(new Map<number, HTMLCanvasElement>());

  useEffect(() => {
    if (!box.current) return;
    try {
      viewer.current = new EquirectViewer(box.current, {
        pan: allowed.pan, zoom: allowed.zoom,
        onView: (v) => { setHeading(v.yaw); onHeading?.(v.yaw); },
      });
      viewer.current.setView({ yaw: pano.heading, pitch: 0, fov: FOV_DEFAULT });
    } catch (e) {
      onError?.((e as Error).message);
    }
    return () => { viewer.current?.destroy(); viewer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pano.panoId]);

  useEffect(() => { cache.current.clear(); setStep(0); }, [pano.panoId]);
  useEffect(() => { viewer.current?.setLocks(allowed.pan, allowed.zoom); }, [allowed.pan, allowed.zoom]);

  useEffect(() => {
    let cancelled = false;
    setLoading(!cache.current.has(step));
    // Let the loading state paint before the (synchronous) scene render.
    const h = setTimeout(() => {
      if (cancelled || !viewer.current) return;
      let c = cache.current.get(step);
      if (!c) { c = renderDemoScene(scene, step); cache.current.set(step, c); }
      viewer.current.setSource(c);
      setLoading(false);
    }, 16);
    return () => { cancelled = true; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pano.panoId]);

  const move = (dir: 1 | -1) => {
    if (!allowed.move) return;
    // Travel in whichever road direction is closer to where the player is looking.
    const facingForward = Math.cos(((heading - 0) * Math.PI) / 180) >= 0;
    const delta = (facingForward ? 1 : -1) * dir;
    setStep((s) => Math.max(-MAX_STEPS, Math.min(MAX_STEPS, s + delta)));
  };

  useImperativeHandle(ref, () => ({
    look: (dy, dp) => viewer.current?.look(dy, dp),
    zoom: (f) => viewer.current?.zoomBy(f),
    faceNorth: () => { if (allowed.pan) viewer.current?.setView({ yaw: 0 }); },
    reset: () => { setStep(0); viewer.current?.setView({ yaw: pano.heading, pitch: 0, fov: FOV_DEFAULT }); },
    move,
  }));

  const rel = (deg: number) => ((deg - heading) % 360 + 540) % 360 - 180;
  return (
    <div className={`pano ${allowed.pan ? '' : 'locked'}`} ref={box} data-testid="pano" data-step={step} data-heading={Math.round(heading)}>
      {loading && <div className="pano-loading"><div className="spinner" /><span>Loading scene…</span></div>}
      {allowed.move && (
        <div className="move-arrows">
          {[0, 180].map((roadDir) => {
            const r = rel(roadDir);
            const forwardish = Math.abs(r) <= 90;
            const target = roadDir === 0 ? step + 1 : step - 1;
            return (
              <button key={roadDir} className="move-arrow" style={{ transform: `rotate(${r}deg)` }} disabled={Math.abs(target) > MAX_STEPS}
                aria-label={forwardish ? 'Move forward along the road' : 'Move back along the road'}
                onClick={() => setStep((s) => Math.max(-MAX_STEPS, Math.min(MAX_STEPS, roadDir === 0 ? s + 1 : s - 1)))}>
                ▲
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

// ------------------------------------------------------------------ mapillary
const MapillaryPano = forwardRef<PanoHandle, Props>(function MapillaryPano({ pano, movement, onHeading, onError }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<any>(null);
  const { config } = useApp();
  const [loading, setLoading] = useState(true);
  const allowed = allowedActions(movement);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const [{ Viewer }] = await Promise.all([import('mapillary-js'), import('mapillary-js/dist/mapillary.css')]);
        if (disposed || !box.current) return;
        const v = new Viewer({
          accessToken: config?.provider.client.accessToken,
          container: box.current,
          imageId: pano.panoId,
          component: {
            cover: false, attribution: true, bearing: false, cache: true, image: true, marker: false, popup: false, slider: false, spatial: false, tag: false,
            direction: allowed.move, sequence: allowed.move ? { visible: true } as any : false,
            zoom: allowed.zoom,
            keyboard: allowed.move ? true : allowed.pan ? { keyPlay: false, keySequenceNavigation: false, keySpatialNavigation: false, keyZoom: allowed.zoom } : false,
            pointer: allowed.pan ? { dragPan: true, scrollZoom: allowed.zoom, touchZoom: allowed.zoom, earthControl: false } : false,
          },
        } as any);
        viewer.current = v;
        v.on('bearing', (e: any) => onHeading?.(e.bearing));
        v.on('image', () => setLoading(false));
        v.moveTo(pano.panoId).then(() => setLoading(false)).catch(() => onError?.('This panorama could not be loaded.'));
      } catch (e) {
        onError?.(`Mapillary viewer failed to start: ${(e as Error).message}`);
      }
    })();
    return () => { disposed = true; try { viewer.current?.remove(); } catch { /* ignore */ } viewer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pano.panoId, movement]);

  useImperativeHandle(ref, () => ({
    look: (dy) => { if (!allowed.pan || !viewer.current) return; viewer.current.getCenter().then((c: number[]) => viewer.current?.setCenter([((c[0] + dy / 360) % 1 + 1) % 1, c[1]])); },
    zoom: (f) => { if (!allowed.zoom || !viewer.current) return; viewer.current.getZoom().then((z: number) => viewer.current?.setZoom(Math.max(0, Math.min(3, z + (f < 1 ? 0.5 : -0.5))))); },
    faceNorth: () => {},
    reset: () => { viewer.current?.moveTo(pano.panoId).catch(() => {}); },
    move: () => {},
  }));

  return (
    <div className="pano" ref={box} data-testid="pano" style={!allowed.pan ? { pointerEvents: 'none' } : undefined}>
      {loading && <div className="pano-loading"><div className="spinner" /><span>Loading imagery…</span></div>}
    </div>
  );
});
