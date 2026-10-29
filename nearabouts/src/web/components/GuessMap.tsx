import { useEffect, useRef } from 'react';
import { createMap, pinIcon, L } from '../lib/leaflet.ts';
import { useApp } from '../lib/store.tsx';

export interface GuessPoint { lat: number; lng: number }
interface Props {
  value: GuessPoint | null;
  onChange: (p: GuessPoint) => void;
  disabled?: boolean;
  /** [south, west, north, east] to frame initially */
  bounds?: [number, number, number, number] | null;
  others?: { lat: number; lng: number; color: string; label: string }[];
  labels?: boolean;
  resizeKey?: unknown;
}

export function GuessMap({ value, onChange, disabled, bounds, others, labels, resizeKey }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const othersLayer = useRef<L.LayerGroup | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const dis = useRef(disabled);
  dis.current = disabled;
  const { config, settings } = useApp();

  useEffect(() => {
    if (!el.current) return;
    const m = createMap(el.current, { config, mapStyle: settings.mapStyle, labels });
    map.current = m;
    othersLayer.current = L.layerGroup().addTo(m);
    m.getContainer().classList.add('crosshair');
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (dis.current) return;
      const ll = e.latlng.wrap();
      cb.current({ lat: ll.lat, lng: ll.lng });
    });
    if (bounds) m.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { animate: false });
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { map.current?.invalidateSize(); }, [resizeKey]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) { marker.current?.remove(); marker.current = null; return; }
    if (!marker.current) {
      marker.current = L.marker([value.lat, value.lng], { icon: pinIcon('#2ed3b7', 'Your guess'), draggable: !disabled, keyboard: false }).addTo(m);
      marker.current.on('dragend', () => { const ll = marker.current!.getLatLng().wrap(); cb.current({ lat: ll.lat, lng: ll.lng }); });
    } else marker.current.setLatLng([value.lat, value.lng]);
    if (marker.current.dragging) disabled ? marker.current.dragging.disable() : marker.current.dragging.enable();
  }, [value, disabled]);

  useEffect(() => {
    const g = othersLayer.current;
    if (!g) return;
    g.clearLayers();
    for (const o of others ?? []) L.marker([o.lat, o.lng], { icon: pinIcon(o.color, o.label), interactive: false }).bindTooltip(o.label, { permanent: false }).addTo(g);
  }, [others]);

  return <div ref={el} style={{ position: 'absolute', inset: 0 }} data-testid="guess-map" aria-label="Guess map. Click to place your guess." />;
}
