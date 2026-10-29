import { useEffect, useRef } from 'react';
import { createMap, pinIcon, flagIcon, L } from '../lib/leaflet.ts';
import { useApp } from '../lib/store.tsx';

export interface ResultPin { lat: number; lng: number; color: string; label: string }
export interface ResultPair { answer: { lat: number; lng: number; label?: string }; guesses: ResultPin[] }

/** Shows answers, guesses and the lines between them; frames everything. */
export function ResultMap({ pairs, animate = true }: { pairs: ResultPair[]; animate?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const { config, settings, updateSettings } = useApp();
  useEffect(() => {
    if (!el.current) return;
    const m = createMap(el.current, { config, mapStyle: settings.mapStyle, onStyleChange: (mapStyle) => updateSettings({ mapStyle }) });
    const pts: L.LatLngExpression[] = [];
    for (const p of pairs) {
      const a: [number, number] = [p.answer.lat, p.answer.lng];
      pts.push(a);
      for (const g of p.guesses) {
        // Draw the shorter way around the globe.
        let lng = g.lng;
        if (lng - a[1] > 180) lng -= 360; else if (a[1] - lng > 180) lng += 360;
        L.polyline([a, [g.lat, lng]], { color: g.color, weight: 2.5, dashArray: '6 7', opacity: 0.9 }).addTo(m);
        L.marker([g.lat, lng], { icon: pinIcon(g.color, g.label), interactive: true }).bindTooltip(g.label).addTo(m);
        pts.push([g.lat, lng]);
      }
      L.marker(a, { icon: flagIcon(), zIndexOffset: 1000 }).bindTooltip(p.answer.label ?? 'Correct location').addTo(m);
    }
    const reduce = settings.reducedMotion || !animate;
    if (pts.length === 1) m.setView(pts[0], 5, { animate: false });
    else if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(0.25), { animate: !reduce, maxZoom: 15 });
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pairs)]);
  return <div ref={el} style={{ position: 'absolute', inset: 0 }} data-testid="result-map" />;
}
