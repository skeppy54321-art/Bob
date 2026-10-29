import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { createMap, pinIcon, L } from '../lib/leaflet.ts';
import type { MapSummary, PanoPayload } from '../lib/types.ts';
import { Empty, ErrorBox, Loading, Modal, Segmented, Spinner } from '../components/ui.tsx';
import { PanoViewer } from '../components/PanoViewer.tsx';
import './content.css';

interface Loc { id: string; lat: number; lng: number; heading: number; country: string | null; countryName: string | null; playable: boolean; provider?: string; status?: string }
interface Nearest { found: boolean; lat: number; lng: number; heading: number; pano: PanoPayload; message?: string }
type Preview =
  | { kind: 'loading' }
  | { kind: 'none'; message: string }
  | { kind: 'new'; lat: number; lng: number; heading: number; pano: PanoPayload }
  | { kind: 'saved'; loc: Loc; pano: PanoPayload };

const MIN_PUBLIC = 5;
const norm = (h: number) => ((Math.round(h) % 360) + 360) % 360;
const coord = (n: number) => n.toFixed(4);

type Loaded = { map: MapSummary & { description: string }; locations: Loc[] };

export default function Editor() {
  const { slug } = useParams();
  const { user } = useApp();
  const [data, setData] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<{ title: string; text: string; retry?: boolean } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null); setProblem(null);
    if (user?.guest) { setProblem({ title: 'Sign up to edit maps', text: 'Custom maps belong to an account.' }); return; }
    (async () => {
      try {
        const map = await api<Loaded['map']>(`/api/maps/${slug}`);
        if (!map.isOwner || map.builtin) {
          if (live) setProblem({ title: 'You can only edit your own maps', text: map.builtin ? 'Built-in maps can’t be changed.' : 'This map belongs to someone else.' });
          return;
        }
        const { locations } = await api<{ locations: Loc[] }>(`/api/maps/${map.id}/locations`);
        if (live) setData({ map, locations });
      } catch (e) {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setProblem({ title: 'Map not found', text: 'It may have been deleted.' });
        else setProblem({ title: errorMessage(e), text: '', retry: true });
      }
    })();
    return () => { live = false; };
  }, [slug, tick, user?.guest]);

  if (problem) {
    if (problem.retry) return <ErrorBox message={problem.title} onRetry={() => setTick((t) => t + 1)} />;
    return (
      <Empty icon="🔒" title={problem.title}>
        {problem.text}
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          {user?.guest && <Link className="btn primary" to="/signup">Sign up</Link>}
          <Link className="btn" to="/maps">Back to maps</Link>
        </div>
      </Empty>
    );
  }
  if (!data) return <Loading label="Loading editor…" />;
  return <EditorBody key={data.map.id} initial={data} />;
}

function EditorBody({ initial }: { initial: Loaded }) {
  const { config, settings, toast } = useApp();
  const nav = useNavigate();
  const [map, setMap] = useState(initial.map);
  const [locations, setLocations] = useState<Loc[]>(initial.locations);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [heading, setHeading] = useState(0);
  const [adding, setAdding] = useState(false);
  const [savingDir, setSavingDir] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [demoCount, setDemoCount] = useState(0);
  const [coords, setCoords] = useState('');
  const [form, setForm] = useState({ name: initial.map.name, description: initial.map.description ?? '', tags: initial.map.tags.join(', '), visibility: initial.map.visibility });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const el = useRef<HTMLDivElement>(null);
  const lmap = useRef<L.Map | null>(null);
  const savedLayer = useRef<L.LayerGroup | null>(null);
  const candidate = useRef<L.Marker | null>(null);
  const lookupSeq = useRef(0);
  const lookupRef = useRef<(lat: number, lng: number) => void>(() => {});
  const pickRef = useRef<(l: Loc) => void>(() => {});

  const playable = locations.filter((l) => l.playable).length;

  // ---- lookups
  const lookup = useCallback(async (lat: number, lng: number) => {
    const id = ++lookupSeq.current;
    setPreview({ kind: 'loading' });
    try {
      const r = await api<Nearest>(`/api/imagery/nearest?lat=${lat}&lng=${lng}`);
      if (id !== lookupSeq.current) return;
      if (!r.found) { setPreview({ kind: 'none', message: r.message ?? 'No imagery found there.' }); return; }
      setHeading(r.heading);
      setPreview({ kind: 'new', lat: r.lat, lng: r.lng, heading: r.heading, pano: r.pano });
    } catch (e) {
      if (id === lookupSeq.current) setPreview({ kind: 'none', message: errorMessage(e) });
    }
  }, []);
  lookupRef.current = lookup;

  const pickSaved = useCallback(async (loc: Loc) => {
    const id = ++lookupSeq.current;
    lmap.current?.setView([loc.lat, loc.lng], Math.max(lmap.current.getZoom(), 5));
    setPreview({ kind: 'loading' });
    try {
      const r = await api<{ pano: PanoPayload }>(`/api/pano/${loc.id}`);
      if (id !== lookupSeq.current) return;
      setHeading(loc.heading);
      setPreview({ kind: 'saved', loc, pano: { ...r.pano, heading: loc.heading } });
    } catch (e) {
      if (id === lookupSeq.current) setPreview({ kind: 'none', message: errorMessage(e) });
    }
  }, []);
  pickRef.current = pickSaved;

  // ---- leaflet setup (once)
  useEffect(() => {
    if (!el.current) return;
    const m = createMap(el.current, { config, mapStyle: settings.mapStyle });
    lmap.current = m;
    savedLayer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => { const ll = e.latlng.wrap(); lookupRef.current(ll.lat, ll.lng); });
    if (initial.locations.length) {
      m.fitBounds(L.latLngBounds(initial.locations.map((l) => [l.lat, l.lng] as [number, number])).pad(0.3), { animate: false, maxZoom: 8 });
    }
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); lmap.current = null; savedLayer.current = null; candidate.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saved locations as gold pins.
  useEffect(() => {
    const layer = savedLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const l of locations) {
      const mk = L.marker([l.lat, l.lng], { icon: pinIcon('#f5c451', `Saved location in ${l.countryName ?? 'unknown country'}`), keyboard: false, title: l.countryName ?? 'Saved location' });
      mk.on('click', () => pickRef.current(l));
      mk.addTo(layer);
    }
  }, [locations]);

  // The candidate (not yet saved) location as a teal pin.
  useEffect(() => {
    const m = lmap.current;
    if (!m) return;
    candidate.current?.remove();
    candidate.current = null;
    if (preview?.kind === 'new') candidate.current = L.marker([preview.lat, preview.lng], { icon: pinIcon('#2ed3b7', 'Candidate location'), keyboard: false, zIndexOffset: 500 }).addTo(m);
  }, [preview]);

  // Demo mode: show where the illustrative scenes are.
  useEffect(() => {
    const m = lmap.current;
    if (!config?.demo || !m) return;
    let live = true;
    const layer = L.layerGroup().addTo(m);
    api<{ points: { id: string; lat: number; lng: number }[] }>('/api/imagery/demo-points').then((r) => {
      if (!live) return;
      setDemoCount(r.points.length);
      for (const p of r.points) {
        L.circleMarker([p.lat, p.lng], { radius: 6, color: '#2ed3b7', weight: 2, fillColor: '#2ed3b7', fillOpacity: 0.55, bubblingMouseEvents: false })
          .on('click', () => lookupRef.current(p.lat, p.lng)).addTo(layer);
      }
    }).catch(() => {});
    return () => { live = false; layer.remove(); };
  }, [config?.demo]);

  // ---- actions
  const refreshMap = async (prevVisibility: string) => {
    try {
      const fresh = await api<Loaded['map']>(`/api/maps/${map.slug}`);
      setMap(fresh);
      if (fresh.visibility !== prevVisibility) {
        setForm((f) => ({ ...f, visibility: fresh.visibility }));
        toast(`This map is now ${fresh.visibility}: public maps need at least ${MIN_PUBLIC} playable locations.`, 'info');
      }
    } catch { /* non-critical */ }
  };

  const add = async () => {
    if (preview?.kind !== 'new') return;
    setAdding(true);
    try {
      const r = await api<{ location: Loc }>(`/api/maps/${map.id}/locations`, { body: { lat: preview.lat, lng: preview.lng, heading: norm(heading) } });
      setLocations((ls) => (ls.some((l) => l.id === r.location.id) ? ls.map((l) => (l.id === r.location.id ? r.location : l)) : [...ls, r.location]));
      toast('Location added.', 'success');
      setPreview(null);
      refreshMap(map.visibility);
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setAdding(false); }
  };

  const saveDirection = async () => {
    if (preview?.kind !== 'saved') return;
    const loc = preview.loc, h = norm(heading);
    setSavingDir(true);
    try {
      await api(`/api/maps/${map.id}/locations/${loc.id}`, { method: 'PATCH', body: { heading: h } });
      setLocations((ls) => ls.map((l) => (l.id === loc.id ? { ...l, heading: h } : l)));
      setPreview({ ...preview, loc: { ...loc, heading: h } });
      toast('Starting direction saved.', 'success');
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setSavingDir(false); }
  };

  const remove = async (loc: Loc) => {
    setRemoving(loc.id);
    try {
      await api(`/api/maps/${map.id}/locations/${loc.id}`, { method: 'DELETE' });
      setLocations((ls) => ls.filter((l) => l.id !== loc.id));
      setPreview((p) => (p?.kind === 'saved' && p.loc.id === loc.id ? null : p));
      toast('Location removed.', 'success');
      refreshMap(map.visibility);
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setRemoving(null); }
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 3) { toast('Map names need 3+ characters.', 'error'); return; }
    setSaving(true);
    try {
      const fresh = await api<MapSummary>(`/api/maps/${map.id}`, { method: 'PATCH', body: { name: form.name.trim(), description: form.description.trim(), tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean).join(','), visibility: form.visibility } });
      setMap((m) => ({ ...m, ...fresh, description: form.description.trim() }));
      setForm((f) => ({ ...f, name: fresh.name, visibility: fresh.visibility, tags: fresh.tags.join(', ') }));
      toast('Map settings saved.', 'success');
    } catch (err) { toast(errorMessage(err), 'error'); }
    finally { setSaving(false); }
  };

  const deleteMap = async () => {
    setDeleting(true);
    try { await api(`/api/maps/${map.id}`, { method: 'DELETE' }); toast('Map deleted.', 'success'); nav('/maps'); }
    catch (e) { toast(errorMessage(e), 'error'); setDeleting(false); }
  };

  const goCoords = (e: FormEvent) => {
    e.preventDefault();
    const m = coords.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) { toast('Enter coordinates like “48.8584, 2.2945”.', 'error'); return; }
    const lat = Number(m[1]), lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) { toast('Latitude must be within ±90 and longitude within ±180.', 'error'); return; }
    lmap.current?.setView([lat, lng], Math.max(lmap.current.getZoom(), 6));
    lookup(lat, lng);
  };

  const needMore = Math.max(0, MIN_PUBLIC - playable);
  const dirty = form.name !== map.name || form.description !== (map.description ?? '') || form.tags !== map.tags.join(', ') || form.visibility !== map.visibility;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/maps">Maps</Link> / <Link to={`/maps/${map.slug}`}>{map.name}</Link> / Edit</div>
          <h1 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)' }}>Edit “{map.name}”</h1>
        </div>
        <div className="row">
          <span className="chip">{locations.length} location{locations.length === 1 ? '' : 's'}</span>
          <span className={`chip ${map.visibility === 'public' ? 'teal' : 'gold'}`}>{map.visibility}</span>
          <Link className="btn" to={`/maps/${map.slug}`}>View map page</Link>
        </div>
      </div>

      <div className="editor">
        <div className="map-pane">
          <div ref={el} style={{ position: 'absolute', inset: 0 }} role="application" aria-label="Map. Click to look for imagery near a point." />
        </div>

        <div className="side">
          <section className="card" aria-labelledby="add-h">
            <h3 id="add-h">Add a location</h3>
            {config?.demo ? (
              <div className="callout info" style={{ marginBottom: 10 }}>
                <span className="demo-dot" aria-hidden /> Demo mode: only the illustrative demo scenes can be added — click near a teal dot{demoCount ? ` (${demoCount} available)` : ''}.
              </div>
            ) : (
              <p className="small text-2">Click the map to find street-level imagery nearby, preview it, then add it to your map.</p>
            )}

            {!preview && <div className="callout" role="status">Click the map to look for imagery near that point.</div>}
            {preview?.kind === 'loading' && <div className="row" role="status"><Spinner small /><span className="text-2">Looking for imagery…</span></div>}
            {preview?.kind === 'none' && <div className="callout warn" role="alert">{preview.message}</div>}
            {(preview?.kind === 'new' || preview?.kind === 'saved') && (
              <div className="col">
                <div className="preview" aria-label="Location preview">
                  <PanoViewer key={preview.pano.panoId} pano={preview.pano} movement="nomove" onHeading={setHeading} onError={(m) => toast(m, 'error')} />
                </div>
                <div className="small text-2">
                  {preview.kind === 'saved' ? <b>Saved: {preview.loc.countryName ?? 'Unknown country'}</b> : <b>New location</b>}
                  {' '}<span className="mono muted">{coord(preview.kind === 'new' ? preview.lat : preview.loc.lat)}, {coord(preview.kind === 'new' ? preview.lng : preview.loc.lng)}</span>
                </div>
                <div className="small text-2" aria-live="polite">Starting direction: <b className="num">{norm(heading)}°</b> <span className="hint">— drag the view to change it</span></div>
                <div className="row">
                  {preview.kind === 'new' ? (
                    <button className="btn primary" onClick={add} disabled={adding} data-testid="add-location">{adding ? 'Adding…' : '＋ Add location'}</button>
                  ) : (
                    <button className="btn teal" onClick={saveDirection} disabled={savingDir || norm(heading) === norm(preview.loc.heading)}>{savingDir ? 'Saving…' : 'Save direction'}</button>
                  )}
                  <button className="btn ghost" onClick={() => setPreview(null)}>Close</button>
                </div>
              </div>
            )}

            <form className="row tight" onSubmit={goCoords} style={{ marginTop: 12, flexWrap: 'nowrap' }}>
              <label className="grow">
                <span className="sr-only">Find imagery at coordinates (latitude, longitude)</span>
                <input className="input" style={{ minHeight: 36 }} value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="lat, lng — e.g. 48.8584, 2.2945" inputMode="decimal" />
              </label>
              <button className="btn sm" type="submit" disabled={!coords.trim()}>Find</button>
            </form>
          </section>

          <section className="card" aria-labelledby="locs-h">
            <div className="row between">
              <h3 id="locs-h" style={{ margin: 0 }}>Locations ({locations.length})</h3>
              <span className="small muted"><span className="pin-dot" aria-hidden /> saved</span>
            </div>
            <p className={`small ${needMore ? '' : 'muted'}`} style={{ margin: '6px 0 8px', color: needMore ? 'var(--warn)' : undefined }}>
              {needMore
                ? `Maps need at least ${MIN_PUBLIC} playable locations to be public — add ${needMore} more.`
                : `Maps need at least ${MIN_PUBLIC} playable locations to be public. You’re set (${playable} playable).`}
            </p>
            {locations.length === 0 ? (
              <div className="muted small" style={{ padding: '10px 0' }}>No locations yet. Click the map to add your first.</div>
            ) : (
              <div className="loc-list">
                {locations.map((l) => (
                  <div key={l.id} className={`loc-item ${preview?.kind === 'saved' && preview.loc.id === l.id ? 'sel' : ''}`}>
                    <div className="meta">
                      <b>{l.countryName ?? 'Unknown country'}{!l.playable && ' · not playable'}</b>
                      <span>{coord(l.lat)}, {coord(l.lng)} · {norm(l.heading)}°</span>
                    </div>
                    <button className="btn sm" onClick={() => pickSaved(l)} aria-label={`Preview location in ${l.countryName ?? 'unknown country'} at ${coord(l.lat)}, ${coord(l.lng)}`}>Preview</button>
                    <button className="btn sm danger" onClick={() => remove(l)} disabled={removing === l.id} aria-label={`Remove location in ${l.countryName ?? 'unknown country'} at ${coord(l.lat)}, ${coord(l.lng)}`}>{removing === l.id ? '…' : 'Remove'}</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <form className="card col" onSubmit={saveSettings} aria-labelledby="set-h" style={{ gap: 12 }}>
            <h3 id="set-h" style={{ margin: 0 }}>Map settings</h3>
            <label className="field">Name
              <input className="input" value={form.name} maxLength={60} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">Description
              <textarea className="input" value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="field">Tags <span className="hint">comma separated</span>
              <input className="input" value={form.tags} maxLength={120} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="beaches, europe, scenic" />
            </label>
            <div className="col" style={{ gap: 6 }}>
              <span className="small text-2" style={{ fontWeight: 650 }}>Visibility</span>
              <Segmented label="Visibility" value={form.visibility} onChange={(visibility) => setForm({ ...form, visibility })}
                options={[{ value: 'private', label: 'Private', title: 'Only you' }, { value: 'unlisted', label: 'Unlisted', title: 'Anyone with the link' }, { value: 'public', label: 'Public', title: 'Listed in the map browser' }]} />
              <span className="hint">{form.visibility === 'private' ? 'Only you can see and play this map.' : form.visibility === 'unlisted' ? 'Anyone with the link can play; it isn’t listed in the browser.' : `Listed for everyone. Needs ${MIN_PUBLIC}+ playable locations.`}</span>
            </div>
            <button className="btn primary" type="submit" disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save settings'}</button>
          </form>

          <section className="card" aria-labelledby="danger-h">
            <h3 id="danger-h">Danger zone</h3>
            <p className="small text-2">Deleting a map removes it for everyone. Past games stay in players’ history.</p>
            <button className="btn danger" onClick={() => setConfirmDelete(true)}>Delete map…</button>
          </section>
        </div>
      </div>

      {confirmDelete && (
        <Modal title="Delete this map?" onClose={() => !deleting && setConfirmDelete(false)}>
          <p className="text-2">“{map.name}” and its {locations.length} location{locations.length === 1 ? '' : 's'} will be removed. This can’t be undone.</p>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
            <button className="btn danger" onClick={deleteMap} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete map'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
