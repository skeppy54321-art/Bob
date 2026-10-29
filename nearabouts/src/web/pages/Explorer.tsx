import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { useApp } from '../lib/store.tsx';
import { flag, fmtInt } from '../lib/format.ts';
import { startGame } from '../lib/game.ts';
import { Empty, ErrorBox, Medal, Switch } from '../components/ui.tsx';
import { MEDAL_THRESHOLDS } from '../../shared/scoring.ts';
import './content.css';

type MedalName = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';
interface Country { code: string; name: string; continent: string; playable: number; best: number; plays: number; medal: MedalName }

const MIN_PLAYABLE = 5;
const MEDALS = ['bronze', 'silver', 'gold', 'platinum'] as const;
const NEXT: Record<MedalName, (typeof MEDALS)[number] | null> = { none: 'bronze', bronze: 'silver', silver: 'gold', gold: 'platinum', platinum: null };

export default function Explorer() {
  const { config, toast } = useApp();
  const nav = useNavigate();
  const { data, error, reload } = useAsync(() => api<{ countries: Country[] }>('/api/explorer'), []);
  const [q, setQ] = useState('');
  const [continent, setContinent] = useState('all');
  const [onlyPlayable, setOnlyPlayable] = useState(!!config?.demo);
  const [busy, setBusy] = useState<string | null>(null);

  const countries = data?.countries ?? [];
  const continents = useMemo(() => [...new Set(countries.map((c) => c.continent).filter(Boolean))].sort(), [countries]);
  const counts = useMemo(() => {
    const c: Record<MedalName, number> = { none: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 };
    for (const k of countries) c[k.medal]++;
    return c;
  }, [countries]);
  const completed = countries.length - counts.none;

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    return countries.filter((c) => (continent === 'all' || c.continent === continent) && (!onlyPlayable || c.playable >= MIN_PLAYABLE) && (!n || c.name.toLowerCase().includes(n) || c.code.toLowerCase() === n));
  }, [countries, q, continent, onlyPlayable]);
  const groups = useMemo(() => {
    const m = new Map<string, Country[]>();
    for (const c of visible) { const k = c.continent || 'Other'; (m.get(k) ?? m.set(k, []).get(k)!).push(c); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const play = async (c: Country) => {
    setBusy(c.code);
    try { nav(`/play/${await startGame({ mode: 'explorer', countryCode: c.code })}`); }
    catch (e) { toast(errorMessage(e), 'error'); setBusy(null); }
  };

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <div>
      <div className="page-head">
        <div><h1>Explorer</h1><p>Play five rounds in a country and earn a medal for your best score there.</p></div>
      </div>

      <section className="card" aria-labelledby="medals-h">
        <h2 id="medals-h" style={{ fontSize: '1.05rem' }}>Medals</h2>
        <p className="text-2 small">Medals are earned on a 5-round game in a single country, out of 25,000 points. Your best game counts.</p>
        <div className="medal-key">
          {MEDALS.map((m) => (
            <div key={m}><Medal medal={m} /><div className="t"><b>{m}</b><span>{fmtInt(MEDAL_THRESHOLDS[m])}+</span></div></div>
          ))}
        </div>
        <hr className="divider" />
        {data ? (
          <div className="row" style={{ gap: 22 }} aria-label="Your progress">
            <div className="stat"><span className="v">{completed}<span className="muted" style={{ fontSize: '1rem' }}> / {countries.length}</span></span><span className="k">Countries completed</span></div>
            {MEDALS.slice().reverse().map((m) => (
              <div key={m} className="row tight" title={`${counts[m]} ${m} medal${counts[m] === 1 ? '' : 's'}`}>
                <Medal medal={m} /><span className="num" style={{ fontWeight: 800, fontSize: '1.15rem' }}>{counts[m]}</span>
              </div>
            ))}
          </div>
        ) : <div className="skeleton" style={{ minHeight: 44 }} />}
      </section>

      <div className="filter-bar" style={{ marginTop: 18 }}>
        <div className="top">
          <label className="search">
            <span className="sr-only">Search countries</span>
            <input className="input" type="search" placeholder="Search countries…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label>
            <span className="sr-only">Continent</span>
            <select className="input" value={continent} onChange={(e) => setContinent(e.target.value)} aria-label="Continent">
              <option value="all">All continents</option>
              {continents.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <Switch checked={onlyPlayable} onChange={setOnlyPlayable} label="Only playable" />
        </div>
        {config?.demo && <div className="callout info">Demo mode has very few playable scenes, so most countries are locked. “Only playable” is on by default.</div>}
      </div>

      {!data ? (
        <div className="xp-grid" aria-busy="true" aria-label="Loading countries">
          {Array.from({ length: 12 }, (_, i) => <div key={i} className="skeleton" style={{ minHeight: 58 }} />)}
        </div>
      ) : visible.length === 0 ? (
        <Empty icon="🧭" title={onlyPlayable && !q && continent === 'all' ? 'No countries are playable yet' : 'No countries match'}>
          {onlyPlayable ? 'Turn off “Only playable” to see every country.' : 'Try another search or continent.'}
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            {onlyPlayable && <button className="btn" onClick={() => setOnlyPlayable(false)}>Show all countries</button>}
            {(q || continent !== 'all') && <button className="btn" onClick={() => { setQ(''); setContinent('all'); }}>Clear filters</button>}
          </div>
        </Empty>
      ) : (
        groups.map(([name, list]) => (
          <section key={name} aria-labelledby={`c-${name}`}>
            <div className="section-title">
              <h2 id={`c-${name}`}>{name}</h2>
              <span className="small muted num">{list.filter((c) => c.medal !== 'none').length}/{list.length} completed</span>
            </div>
            <div className="xp-grid">
              {list.map((c) => {
                const locked = c.playable < MIN_PLAYABLE;
                const next = NEXT[c.medal];
                return (
                  <div key={c.code} className={`xp-row ${locked ? 'locked' : ''}`}>
                    <span className="fl" aria-hidden>{flag(c.code)}</span>
                    <div className="nm">
                      <b title={c.name}>{c.name}</b>
                      <span>
                        {locked ? `Needs ${MIN_PLAYABLE}+ playable locations (${c.playable})`
                          : c.plays ? `Best ${fmtInt(c.best)} · ${c.plays} play${c.plays === 1 ? '' : 's'}${next ? ` · ${fmtInt(MEDAL_THRESHOLDS[next])} for ${next}` : ''}`
                          : `Not played · ${c.playable} locations`}
                      </span>
                    </div>
                    <Medal medal={c.medal} />
                    <button
                      className="btn sm primary" disabled={locked || busy !== null} onClick={() => play(c)}
                      title={locked ? `Not enough playable locations in ${c.name} yet (${c.playable} of ${MIN_PLAYABLE} needed).` : `Play ${c.name}`}
                      aria-label={locked ? `${c.name} is not playable yet` : `Play ${c.name}`}
                    >{busy === c.code ? '…' : 'Play'}</button>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
