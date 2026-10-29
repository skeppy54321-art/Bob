import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { flag, fmtInt } from '../lib/format.ts';
import type { MapSummary } from '../lib/types.ts';
import { Empty, ErrorBox, Modal, Segmented } from '../components/ui.tsx';
import './content.css';

const CATEGORIES = ['all', 'world', 'continent', 'country', 'city', 'landmark', 'community'] as const;
const CATEGORY_LABEL: Record<string, string> = { all: 'All', world: 'World', continent: 'Continents', country: 'Countries', city: 'Cities', landmark: 'Landmarks', community: 'Community' };
const CATEGORY_GLYPH: Record<string, string> = { world: '🌍', continent: '🗺️', country: '🏳️', city: '🏙️', landmark: '📍', community: '👥' };
const SORTS = [
  { value: 'popular', label: 'Popular' }, { value: 'new', label: 'Newest' },
  { value: 'name', label: 'Name' }, { value: 'favorites', label: 'Most favorited' },
];
const PAGE = 24;

type Filter = 'all' | 'mine' | 'favorites';

export default function Maps() {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState('popular');
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const seq = useRef(0);
  const count = useRef(0);
  count.current = maps?.length ?? 0;

  // Debounce the search box.
  useEffect(() => {
    const h = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);

  const load = useCallback(async (offset: number) => {
    const id = ++seq.current;
    if (offset === 0) setLoading(true); else setLoadingMore(true);
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort, category, filter });
      if (dq) p.set('q', dq);
      const r = await api<{ maps: MapSummary[]; hasMore: boolean }>(`/api/maps?${p}`);
      if (id !== seq.current) return;
      setMaps((cur) => (offset === 0 ? r.maps : [...(cur ?? []), ...r.maps.filter((m) => !(cur ?? []).some((c) => c.id === m.id))]));
      setHasMore(r.hasMore);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      if (offset === 0) { setError(errorMessage(e)); setMaps(null); } else toast(errorMessage(e), 'error');
    } finally {
      if (id === seq.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [dq, category, filter, sort, toast]);

  useEffect(() => { load(0); }, [load]);

  const toggleFav = async (m: MapSummary) => {
    try {
      const r = await api<{ favorited: boolean }>(`/api/maps/${m.id}/favorite`, { method: 'POST', body: {} });
      setMaps((cur) => {
        if (!cur) return cur;
        if (filter === 'favorites' && !r.favorited) return cur.filter((x) => x.id !== m.id);
        return cur.map((x) => (x.id === m.id ? { ...x, favorited: r.favorited, favorites: Math.max(0, x.favorites + (r.favorited ? 1 : -1)) } : x));
      });
    } catch (e) { toast(errorMessage(e), 'error'); }
  };

  const filtersActive = !!dq || category !== 'all' || filter !== 'all';
  const reset = () => { setQ(''); setDq(''); setCategory('all'); setFilter('all'); };

  return (
    <div>
      <div className="page-head">
        <div><h1>Maps</h1><p>Pick a place to play. Scores are judged against each map’s own size.</p></div>
        <button className="btn primary" onClick={() => setCreating(true)} data-testid="create-map">＋ Create a map</button>
      </div>

      <div className="filter-bar">
        <div className="top">
          <label className="search">
            <span className="sr-only">Search maps</span>
            <input className="input" type="search" placeholder="Search maps by name, description or tag…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <Segmented<Filter> label="Show" value={filter} onChange={setFilter}
            options={[{ value: 'all', label: 'All' }, { value: 'mine', label: 'My maps' }, { value: 'favorites', label: 'Favorites' }]} />
          <label>
            <span className="sr-only">Sort by</span>
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
              {SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
            </select>
          </label>
        </div>
        <div className="chip-row" role="group" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>{CATEGORY_LABEL[c]}</button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorBox message={error} onRetry={() => load(0)} />
      ) : maps === null ? (
        <div className="grid auto" aria-busy="true" aria-label="Loading maps">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton card-sk" />)}
        </div>
      ) : maps.length === 0 ? (
        <Empty icon={filter === 'favorites' ? '♡' : '🗺️'} title={filter === 'mine' ? 'You have no maps yet' : filter === 'favorites' ? 'No favorites yet' : 'No maps match'}>
          {filter === 'mine' ? 'Create your own map from any places you like.' : filter === 'favorites' ? 'Tap the heart on a map to keep it here.' : 'Try a different search or category.'}
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            {filtersActive && <button className="btn" onClick={reset}>Clear filters</button>}
            {filter === 'mine' && <button className="btn primary" onClick={() => setCreating(true)}>Create a map</button>}
          </div>
        </Empty>
      ) : (
        <>
          <div className="grid auto" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 160ms' }} aria-busy={loading}>
            {maps.map((m) => <MapCard key={m.id} m={m} onFav={() => toggleFav(m)} />)}
          </div>
          {hasMore && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
              <button className="btn" disabled={loadingMore} onClick={() => load(count.current)}>{loadingMore ? 'Loading…' : 'Load more'}</button>
            </div>
          )}
        </>
      )}

      {creating && (user?.guest
        ? (
          <Modal title="Create a map" onClose={() => setCreating(false)}>
            <p className="text-2">Custom maps belong to an account. Sign up (it’s free, and your guest games carry over) to build and share your own maps.</p>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setCreating(false)}>Not now</button>
              <Link className="btn primary" to="/signup">Sign up</Link>
            </div>
          </Modal>
        )
        : <CreateMap onClose={() => setCreating(false)} onCreated={(slug) => nav(`/maps/${slug}/edit`)} />)}
    </div>
  );
}

function MapCard({ m, onFav }: { m: MapSummary; onFav: () => void }) {
  const low = m.playable < 5;
  return (
    <article className={`card hover map-card ${low ? 'muted-card' : ''}`}>
      <div className="head">
        <span className="glyph" aria-hidden>{m.countryCode ? flag(m.countryCode) : CATEGORY_GLYPH[m.category] ?? '🗺️'}</span>
        <div className="grow">
          <h3><Link to={`/maps/${m.slug}`}>{m.name}</Link></h3>
          <div className="by">by {m.builtin ? 'Nearabouts' : m.creator ?? 'unknown'}</div>
        </div>
      </div>
      <button
        type="button" className="btn icon sm fav fav-btn" aria-pressed={m.favorited}
        aria-label={m.favorited ? `Remove ${m.name} from favorites` : `Add ${m.name} to favorites`}
        title={m.favorited ? 'Remove from favorites' : 'Add to favorites'} onClick={onFav}
      >{m.favorited ? '♥' : '♡'}</button>
      <div className="row tight">
        <span className="chip">{m.category}</span>
        {m.visibility !== 'public' && <span className="chip gold">{m.visibility}</span>}
        {m.featured && <span className="chip teal">featured</span>}
      </div>
      <p className="desc">{m.description || 'No description.'}</p>
      {low && <div className="low">Not enough playable locations</div>}
      <div className="stats">
        <span title="Plays">▶ {fmtInt(m.plays)}</span>
        <span title="Favorites">♥ {fmtInt(m.favorites)}</span>
        <span title="Playable locations">📍 {fmtInt(m.playable)}</span>
      </div>
    </article>
  );
}

function CreateMap({ onClose, onCreated }: { onClose: () => void; onCreated: (slug: string) => void }) {
  const { toast } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 3) { setErr('Give your map a name (3+ characters).'); return; }
    setBusy(true); setErr(null);
    try {
      const m = await api<MapSummary>('/api/maps', { body: { name: name.trim(), description: description.trim(), visibility: 'private' } });
      toast('Map created. Add some locations!', 'success');
      onCreated(m.slug);
    } catch (e2) { setErr(errorMessage(e2)); setBusy(false); }
  };
  return (
    <Modal title="Create a map" onClose={onClose}>
      <form className="col" onSubmit={submit} style={{ gap: 14 }}>
        <label className="field">Name
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coastal towns of Portugal" required />
        </label>
        <label className="field">Description <span className="hint">(optional)</span>
          <textarea className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="What is this map about?" />
        </label>
        <p className="hint" style={{ margin: 0 }}>New maps start private. Add at least 5 locations, then publish from the editor.</p>
        {err && <div className="error-text" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create and open editor'}</button>
        </div>
      </form>
    </Modal>
  );
}
