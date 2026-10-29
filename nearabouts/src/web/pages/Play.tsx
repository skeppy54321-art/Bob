import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { GameView } from '../lib/types.ts';
import { useApp } from '../lib/store.tsx';
import { useServerClock } from '../lib/hooks.ts';
import { GameStage } from '../components/GameStage.tsx';
import { ResultMap } from '../components/ResultMap.tsx';
import { ErrorBox, Loading, Medal } from '../components/ui.tsx';
import { formatDistance, fmtInt, modeName, flag, fmtTimeLimit } from '../lib/format.ts';
import { scoreEmoji, shareText, startGame } from '../lib/game.ts';
import { MOVEMENT_LABELS } from '../../shared/rules.ts';
import { levelFromXp } from '../../shared/levels.ts';

const isStreak = (m: string) => m === 'streak_country' || m === 'streak_state';

export default function Play() {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast, refreshUser } = useApp();
  const [g, setG] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const now = useServerClock(g?.serverNow);

  const load = useCallback(async () => {
    try { setG(await api<GameView>(`/api/games/${id}`)); setError(null); } catch (e) { setError(errorMessage(e)); }
  }, [id]);
  useEffect(() => { setG(null); setShowSummary(false); load(); }, [load]);
  useEffect(() => { if (g?.status === 'finished') refreshUser().catch(() => {}); }, [g?.status, refreshUser]);

  if (error) return <div className="main"><ErrorBox message={error} onRetry={load} /><div className="row" style={{ justifyContent: 'center' }}><Link className="btn" to="/">Home</Link></div></div>;
  if (!g) return <div className="main"><Loading label="Loading game…" /></div>;

  const r = g.round;
  const guess = async (p: { lat: number; lng: number }) => {
    try {
      const res = await api<{ accepted: boolean; game: GameView }>(`/api/games/${g.id}/guess`, { body: { round: r!.idx, ...p } });
      if (!res.accepted) toast('That round had already closed.', 'info');
      setG(res.game);
    } catch (e) { toast(errorMessage(e), 'error'); }
  };
  const next = async () => {
    try { setG(await api<GameView>(`/api/games/${g.id}/next`, { method: 'POST' })); } catch (e) { toast(errorMessage(e), 'error'); }
  };
  const panoError = async (msg: string) => {
    try {
      const res = await api<{ replaced: boolean; game: GameView }>(`/api/games/${g.id}/unavailable`, { body: { round: r!.idx } });
      if (res.replaced) { toast('That panorama was unavailable — swapped in a new location.'); setG(res.game); }
      else toast(`${msg} Try reloading the page.`, 'error');
    } catch (e) { toast(errorMessage(e), 'error'); }
  };

  if (g.status === 'finished' && (showSummary || !r || r.status !== 'done')) return <Summary g={g} />;

  if (r && r.status === 'active') {
    const streak = isStreak(g.mode);
    return (
      <GameStage
        pano={r.pano} movement={g.rules.movement} roundKey={`${g.id}:${r.idx}:${r.pano.panoId}`} now={now}
        startedAt={r.startedAt} deadline={r.deadlineAt} onExpire={load}
        onGuess={guess} guessLabel={streak ? (g.mode === 'streak_state' ? 'Guess this state' : 'Guess this country') : 'Guess'}
        mapBounds={(g.map as any)?.bounds ?? null} labels={g.rules.difficulty !== 'hard'} onPanoError={panoError}
        onExit={() => { if (confirm('Leave this game? You can resume it later from your profile.')) nav('/'); }}
        hud={<>
          <div className="kv"><span className="k">{modeName(g.mode)}</span><span className="v">{g.map?.name}{g.countryCode ? ` ${flag(g.countryCode)}` : ''}</span></div>
          {streak
            ? <div className="kv"><span className="k">Streak</span><span className="v" data-testid="streak">{g.streak}</span></div>
            : <div className="kv"><span className="k">Round</span><span className="v" data-testid="round">{r.idx + 1} / {g.roundCount}</span></div>}
          {!streak && <div className="kv"><span className="k">Score</span><span className="v" data-testid="total">{fmtInt(g.totalScore)}</span></div>}
        </>}
      />
    );
  }

  if (r && r.status === 'done' && r.result) return <RoundResultView g={g} onNext={next} onSummary={() => setShowSummary(true)} />;
  return <div className="main"><Loading /></div>;
}

function RoundResultView({ g, onNext, onSummary }: { g: GameView; onNext: () => void; onSummary: () => void }) {
  const { settings } = useApp();
  const res = g.round!.result!;
  const streak = isStreak(g.mode);
  const last = g.status === 'finished';
  const [shown, setShown] = useState(settings.reducedMotion ? res.score : 0);
  useEffect(() => {
    if (settings.reducedMotion || streak) { setShown(res.score); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 900); setShown(Math.round(res.score * (1 - (1 - k) ** 3))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [res.score, settings.reducedMotion, streak]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); last ? onSummary() : onNext(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [last, onNext, onSummary]);
  const answerLabel = streak && g.mode === 'streak_state' ? `${res.answer.subdivisionName}` : `${flag(res.answer.country)} ${res.answer.countryName}`;
  return (
    <div className="result-screen fade-in" data-testid="round-result">
      <div className="result-map">
        <ResultMap pairs={[{ answer: { ...res.answer, label: answerLabel }, guesses: res.guess ? [{ ...res.guess, color: '#2ed3b7', label: 'Your guess' }] : [] }]} />
      </div>
      <div className="result-panel">
        {streak ? (
          <div className="col" style={{ alignItems: 'center', gap: 4 }}>
            <div className="big" style={{ color: res.correct ? 'var(--ok)' : 'var(--danger)' }}>{res.correct ? 'Correct!' : res.timedOut ? 'Out of time' : 'Not quite'}</div>
            <div className="text-2">It was <b>{answerLabel}</b>{res.guessRegionName && !res.correct ? <> — you picked {res.guessRegionName}</> : null}{!res.guess && !res.timedOut ? ' (your pin was in the sea)' : ''}</div>
            <div className="muted">Streak: <b className="num">{g.streak}</b></div>
          </div>
        ) : (
          <div className="col" style={{ alignItems: 'center', gap: 6 }}>
            <div className="big num" data-testid="round-score">{fmtInt(shown)} <span className="muted" style={{ fontSize: '1rem' }}>points</span></div>
            <div className="scorebar"><div style={{ width: `${(shown / 5000) * 100}%` }} /></div>
            <div className="text-2">{res.timedOut ? 'Time ran out — no guess.' : <>Your guess was <b>{formatDistance(res.distanceKm, settings.units)}</b> from the correct location.</>} <span className="muted">{answerLabel}</span></div>
          </div>
        )}
        <button className="btn primary lg" onClick={last ? onSummary : onNext} autoFocus data-testid="next-btn">{last ? 'See results' : streak ? 'Next location' : 'Next round'}</button>
      </div>
    </div>
  );
}

function Summary({ g }: { g: GameView }) {
  const nav = useNavigate();
  const { settings, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const streak = isStreak(g.mode);
  const max = g.roundCount * 5000;
  const fin = g.finish;

  const replay = async () => {
    setBusy(true);
    try {
      const id = await startGame({ mode: g.mode === 'challenge' || g.mode === 'daily' ? 'classic' : g.mode, mapSlug: g.map?.slug, rules: g.rules, countryCode: g.countryCode ?? undefined });
      nav(`/play/${id}`);
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  const challenge = async () => {
    setBusy(true);
    try {
      const { code } = await api<{ code: string }>('/api/challenges', { body: { fromGameId: g.id } });
      const url = `${location.origin}/c/${code}`;
      const r = await shareText(`Can you beat my ${fmtInt(g.totalScore)} on Nearabouts (${g.map?.name})?`, url);
      toast(r === 'copied' ? 'Challenge link copied — send it to a friend!' : r === 'shared' ? 'Shared!' : `Challenge link: ${url}`, 'success');
      nav(`/c/${code}`);
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  const share = async () => {
    const line = streak ? `🔥 ${modeName(g.mode)}: ${g.streak} in a row` : `${g.map?.name} · ${fmtInt(g.totalScore)} / ${fmtInt(max)}\n${g.rounds.map((r) => scoreEmoji(r.score)).join('')}`;
    const head = g.mode === 'daily' ? `Nearabouts Daily ${g.dailyDate}` : `Nearabouts ${modeName(g.mode)}`;
    const url = g.mode === 'challenge' && g.challengeCode ? `${location.origin}/c/${g.challengeCode}` : g.mode === 'daily' ? `${location.origin}/daily` : location.origin;
    const r = await shareText(`${head}\n${line}`, url);
    toast(r === 'copied' ? 'Result copied to clipboard.' : r === 'shared' ? 'Shared!' : 'Could not share on this device.', r === 'failed' ? 'error' : 'success');
  };

  return (
    <div className="main fade-in" data-testid="summary">
      <div className="page-head">
        <div>
          <span className="chip">{modeName(g.mode)} · {g.map?.name}{g.countryCode ? ` ${flag(g.countryCode)}` : ''}</span>
          <h1 style={{ marginTop: 10 }}>{streak ? `${g.streak} in a row` : <span className="num" data-testid="final-score">{fmtInt(g.totalScore)}</span>}{!streak && <span className="muted" style={{ fontSize: '1.1rem' }}> / {fmtInt(max)}</span>}</h1>
          <p>{MOVEMENT_LABELS[g.rules.movement]} · {fmtTimeLimit(g.rules.timeLimit)}{fin?.exhausted ? ' · You played every available location!' : ''}</p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={replay} disabled={busy}>Play again</button>
          {!streak && g.mode !== 'daily' && <button className="btn" onClick={challenge} disabled={busy}>Challenge a friend</button>}
          <button className="btn" onClick={share}>Share result</button>
        </div>
      </div>

      {fin && (fin.xp || fin.unlocked.length || fin.medal) && (
        <div className="row" style={{ marginBottom: 14 }}>
          {fin.xp && <span className="chip teal">+{fin.xp.gained} XP{fin.xp.levelUp ? ` · Level up! Now level ${levelFromXp(fin.xp.xp).level}` : ''}</span>}
          {fin.medal && fin.medal !== 'none' && <span className="chip gold"><Medal medal={fin.medal} /> {fin.medal} medal{fin.newBest ? ' · new personal best' : ''}</span>}
          {fin.unlocked.map((a: any) => <span key={a.key} className="chip accent pop">{a.icon} Achievement: {a.name}</span>)}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative', height: 'min(52vh, 460px)' }}>
        <ResultMap pairs={g.rounds.map((r) => ({ answer: { ...r.answer, label: `Round ${r.idx + 1}: ${r.answer.countryName}` }, guesses: r.guess ? [{ ...r.guess, color: '#2ed3b7', label: `Round ${r.idx + 1} guess` }] : [] }))} />
      </div>

      <div className="card section table-wrap">
        <table className="table">
          <thead><tr><th>#</th><th>Location</th><th>{streak ? 'Your answer' : 'Distance'}</th><th style={{ textAlign: 'right' }}>{streak ? 'Result' : 'Score'}</th></tr></thead>
          <tbody>
            {g.rounds.map((r) => (
              <tr key={r.idx}>
                <td className="rank">{r.idx + 1}</td>
                <td>{flag(r.answer.country)} {g.mode === 'streak_state' ? r.answer.subdivisionName : r.answer.countryName}</td>
                <td className="text-2">{streak ? (r.guessRegionName ?? (r.timedOut ? 'Timed out' : 'Not a country')) : r.timedOut ? 'Timed out' : formatDistance(r.distanceKm, settings.units)}</td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{streak ? (r.correct ? '✅' : '❌') : fmtInt(r.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row section">
        <Link className="btn ghost" to="/">← Home</Link>
        {g.mode === 'daily' && <Link className="btn" to="/daily">Daily leaderboard</Link>}
        {g.mode === 'explorer' && <Link className="btn" to="/explorer">Back to Explorer</Link>}
        {g.mode === 'challenge' && g.challengeCode && <Link className="btn" to={`/c/${g.challengeCode}`}>Challenge standings</Link>}
        {g.map && <Link className="btn ghost" to={`/maps/${g.map.slug}`}>About this map</Link>}
      </div>
    </div>
  );
}
