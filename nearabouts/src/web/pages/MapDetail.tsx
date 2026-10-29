import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { flag, fmtInt, formatDistance } from '../lib/format.ts';
import { startGame, shareText } from '../lib/game.ts';
import type { MapSummary } from '../lib/types.ts';
import { Empty, ErrorBox, Loading } from '../components/ui.tsx';
import { RulesForm } from '../components/RulesForm.tsx';
import { DEFAULT_RULES, type GameRules } from '../../shared/rules.ts';
import { scoreFromDistance, WORLD_SCALE_KM } from '../../shared/scoring.ts';
import './content.css';

interface MapDetailData extends MapSummary { highscores: { username: string; score: number }[] }

const GLYPH: Record<string, string> = { world: '🌍', continent: '🗺️', country: '🏳️', city: '🏙️', landmark: '📍', community: '👥' };

export default function MapDetail() {
  const { slug } = useParams();
  const { user, settings, toast } = useApp();
  const nav = useNavigate();
  const [map, setMap] = useState<MapDetailData | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [rules, setRules] = useState<GameRules>({ ...DEFAULT_RULES });
  const [busy, setBusy] = useState<null | 'play' | 'challenge'>(null);
  const [favBusy, setFavBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setMap(null); setError(null);
    api<MapDetailData>(`/api/maps/${slug}`)
      .then((m) => { if (live) setMap(m); })
      .catch((e) => { if (live) setError({ message: errorMessage(e), notFound: e instanceof ApiError && e.status === 404 }); });
    return () => { live = false; };
  }, [slug, tick]);

  if (error) {
    return error.notFound
      ? <Empty icon="🧭" title="Map not found"><p>It may have been removed, or it’s private.</p><Link className="btn primary" to="/maps">Browse maps</Link></Empty>
      : <ErrorBox message={error.message} onRetry={() => setTick((t) => t + 1)} />;
  }
  if (!map) return <Loading label="Loading map…" />;

  const notEnough = map.playable < rules.rounds;

  const play = async () => {
    setBusy('play');
    try { nav(`/play/${await startGame({ mode: 'classic', mapSlug: map.slug, rules })}`); }
    catch (e) { toast(errorMessage(e), 'error'); setBusy(null); }
  };
  const challenge = async () => {
    setBusy('challenge');
    try {
      const r = await api<{ code: string }>('/api/challenges', { body: { mapSlug: map.slug, rules } });
      nav(`/c/${r.code}`);
    } catch (e) { toast(errorMessage(e), 'error'); setBusy(null); }
  };
  const fav = async () => {
    setFavBusy(true);
    try {
      const r = await api<{ favorited: boolean }>(`/api/maps/${map.id}/favorite`, { method: 'POST', body: {} });
      setMap((m) => (m ? { ...m, favorited: r.favorited, favorites: Math.max(0, m.favorites + (r.favorited ? 1 : -1)) } : m));
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setFavBusy(false); }
  };
  const copyLink = async () => {
    const r = await shareText(`Play ${map.name} on Nearabouts`, `${location.origin}/maps/${map.slug}`);
    toast(r === 'failed' ? 'Could not copy the link.' : r === 'copied' ? 'Link copied.' : 'Shared!', r === 'failed' ? 'error' : 'success');
  };

  const examples = [0.01, 0.05, 0.2].map((f) => { const d = map.scaleKm * f; return { d, s: scoreFromDistance(d, map.scaleKm), pct: f * 100 }; });
  const worldEq = (km: number) => scoreFromDistance(km, WORLD_SCALE_KM);

  return (
    <div className="stack-lg">
      <div>
        <div className="row tight small muted" style={{ marginBottom: 8 }}><Link to="/maps">← Maps</Link></div>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div className="row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <span className="glyph" aria-hidden style={{ width: 56, height: 56, fontSize: '1.9rem' }}>{map.countryCode ? flag(map.countryCode) : GLYPH[map.category] ?? '🗺️'}</span>
            <div>
              <h1 style={{ marginBottom: 6 }}>{map.name}</h1>
              <div className="row tight">
                <span className="chip">{map.category}</span>
                {map.visibility !== 'public' && <span className="chip gold">{map.visibility}</span>}
                {map.featured && <span className="chip teal">featured</span>}
                {map.tags.map((t) => <span key={t} className="chip">#{t.trim()}</span>)}
                <span className="small muted">by {map.builtin ? 'Nearabouts' : map.creator ?? 'unknown'}</span>
              </div>
            </div>
          </div>
          <div className="row">
            <button className="btn fav-btn" aria-pressed={map.favorited} disabled={favBusy} onClick={fav}>{map.favorited ? '♥ Favorited' : '♡ Favorite'}</button>
            <button className="btn" onClick={copyLink}>Copy link</button>
            {map.isOwner && !map.builtin && <Link className="btn" to={`/maps/${map.slug}/edit`}>✎ Edit map</Link>}
          </div>
        </div>
        {map.description && <p className="text-2" style={{ marginTop: 14, maxWidth: '70ch' }}>{map.description}</p>}
      </div>

      <div className="card">
        <div className="facts">
          <div className="stat"><span className="v">{fmtInt(map.plays)}</span><span className="k">Plays</span></div>
          <div className="stat"><span className="v">{fmtInt(map.favorites)}</span><span className="k">Favorites</span></div>
          <div className="stat"><span className="v">{fmtInt(map.playable)}</span><span className="k">Playable locations</span></div>
          <div className="stat"><span className="v">{formatDistance(map.scaleKm, settings.units)}</span><span className="k">Scale</span></div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="col" style={{ gap: 14 }}>
          <section className="card" aria-labelledby="play-h">
            <h2 id="play-h">Play classic</h2>
            <p className="text-2">Choose your rules, then start a game on {map.name}.</p>
            <RulesForm value={rules} onChange={setRules} />
            {notEnough && (
              <div className="callout warn" role="status" style={{ marginTop: 14 }}>
                {map.playable === 0
                  ? 'This map has no playable locations yet, so it can’t be played right now.'
                  : `This map only has ${map.playable} playable location${map.playable === 1 ? '' : 's'}, but your rules ask for ${rules.rounds} rounds. Lower the number of rounds to ${map.playable} or fewer.`}
                {map.isOwner && <> <Link to={`/maps/${map.slug}/edit`}>Add more in the editor.</Link></>}
              </div>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn primary lg" disabled={notEnough || !!busy} onClick={play} data-testid="play-classic">{busy === 'play' ? 'Starting…' : '▶ Play classic'}</button>
              <button className="btn" disabled={notEnough || !!busy} onClick={challenge} title="Pick these locations once and share a link so friends play the same ones" data-testid="make-challenge">
                {busy === 'challenge' ? 'Creating…' : '🔗 Create challenge link'}
              </button>
              <Link className="btn" to={`/rooms?map=${map.slug}`}>👥 Play with friends</Link>
            </div>
            {map.playable >= 5 ? null : !notEnough && <p className="hint" style={{ marginTop: 10 }}>Heads up: with fewer than 5 playable locations, locations will repeat often.</p>}
          </section>

          <section className="callout info" aria-labelledby="scale-h">
            <strong id="scale-h" style={{ color: 'var(--text)' }}>How scoring works here</strong>
            <p style={{ margin: '6px 0 0' }}>
              Guesses are judged relative to the size of the map. This map’s scale is <b>{formatDistance(map.scaleKm, settings.units)}</b>
              {map.scaleKm < WORLD_SCALE_KM ? <>, so a close guess is rewarded much more than it would be on the {formatDistance(WORLD_SCALE_KM, settings.units)} world map.</> : <>, the full world scale.</>}
              {' '}Each round is worth up to 5,000 points.
            </p>
            <div className="example-scores" aria-label="Example scores">
              {examples.map((e) => (
                <div key={e.pct}>
                  <div className="v">{fmtInt(e.s)}</div>
                  <div className="k">{formatDistance(e.d, settings.units)} off</div>
                </div>
              ))}
            </div>
            {map.scaleKm < WORLD_SCALE_KM && (
              <p className="hint" style={{ margin: '8px 0 0' }}>
                For comparison, being {formatDistance(examples[1].d, settings.units)} off scores {fmtInt(worldEq(examples[1].d))} on the world map.
              </p>
            )}
          </section>
        </div>

        <section className="card" aria-labelledby="hs-h">
          <h2 id="hs-h">High scores</h2>
          <p className="hint">Best 5-round classic games on this map.</p>
          {map.highscores.length === 0 ? (
            <div className="muted" style={{ padding: '14px 0' }}>No scores yet — be the first.</div>
          ) : (
            <div className="list">
              {map.highscores.map((h, i) => (
                <div key={h.username} className="list-item">
                  <span className={`rank ${i < 3 ? `r${i + 1}` : ''}`}>{i + 1}</span>
                  <Link className="grow" to={`/u/${h.username}`} style={{ fontWeight: 650 }}>{h.username}</Link>
                  <span className="num" style={{ fontWeight: 800 }}>{fmtInt(h.score)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
