import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { fmtInt, fmtTimeLimit, timeAgo } from '../lib/format.ts';
import { shareText, startGame } from '../lib/game.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Empty, ErrorBox, Loading } from '../components/ui.tsx';
import { MOVEMENT_LABELS, type GameRules } from '../../shared/rules.ts';
import type { AvatarConfig } from '../lib/types.ts';
import './content.css';

interface ChallengeData {
  code: string; rules: GameRules; map: { slug: string; name: string } | null;
  creator: { username: string; avatar: AvatarConfig } | null; rounds: number;
  results: { rank: number; gameId: string; username: string; avatar: AvatarConfig; score: number; finishedAt: number; isYou: boolean }[];
  myGame: { id: string; status: string } | null; createdAt: number;
}

export default function Challenge() {
  const { code = '' } = useParams();
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [c, setC] = useState<ChallengeData | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setC(null); setError(null);
    api<ChallengeData>(`/api/challenges/${encodeURIComponent(code)}`)
      .then((r) => { if (live) setC(r); })
      .catch((e) => { if (live) setError({ message: errorMessage(e), notFound: e instanceof ApiError && (e.status === 404 || e.code === 'challenge_not_found') }); });
    return () => { live = false; };
  }, [code, tick]);

  if (error) {
    return error.notFound
      ? (
        <Empty icon="🔗" title="Challenge not found">
          <p>That link doesn’t match any challenge. Check the code — it may have been mistyped.</p>
          <div className="row" style={{ justifyContent: 'center' }}><Link className="btn primary" to="/play">Choose a mode</Link><Link className="btn" to="/maps">Browse maps</Link></div>
        </Empty>
      )
      : <ErrorBox message={error.message} onRetry={() => setTick((t) => t + 1)} />;
  }
  if (!c) return <Loading label="Loading challenge…" />;

  const mine = c.results.find((r) => r.isYou);
  const active = c.myGame?.status === 'active';
  const done = !!c.myGame && !active;
  const isCreator = !!user && c.creator?.username === user.username;
  const url = `${location.origin}/c/${c.code}`;

  const play = async () => {
    setBusy(true);
    try { nav(`/play/${await startGame({ mode: 'challenge', challengeCode: c.code })}`); }
    catch (e) { toast(errorMessage(e), 'error'); setBusy(false); }
  };
  const copy = async () => {
    const who = c.creator && !isCreator ? `${c.creator.username}'s` : 'my';
    const r = await shareText(`Can you beat ${who} Nearabouts challenge${c.map ? ` on ${c.map.name}` : ''}?`, url);
    if (r === 'failed') toast('Could not copy automatically — copy the link from the box.', 'error');
    else toast(r === 'copied' ? 'Challenge link copied.' : 'Shared!', 'success');
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <div className="small muted">Challenge <span className="code-pill">{c.code}</span> · created {timeAgo(c.createdAt)}</div>
          <h1>{isCreator ? 'Your challenge' : c.creator ? `${c.creator.username} challenged you` : 'You’ve been challenged'}</h1>
        </div>
      </div>

      <div className="detail-grid">
        <section className="card pad-lg col" style={{ gap: 16 }} aria-labelledby="ch-h">
          <h2 id="ch-h" style={{ margin: 0 }}>The challenge</h2>
          <div className="who">
            {c.creator ? <Avatar avatar={c.creator.avatar} size={48} /> : <span className="glyph" aria-hidden>🔗</span>}
            <div>
              <div style={{ fontWeight: 750 }}>{c.creator ? <Link to={`/u/${c.creator.username}`} style={{ color: 'var(--text)' }}>{c.creator.username}</Link> : 'Someone'}</div>
              <div className="small text-2">
                {c.rounds} round{c.rounds === 1 ? '' : 's'} on {c.map ? <Link to={`/maps/${c.map.slug}`}>{c.map.name}</Link> : 'a custom set of locations'}. Everyone plays the exact same places.
              </div>
            </div>
          </div>

          <div className="row tight">
            <span className="chip accent">{MOVEMENT_LABELS[c.rules.movement] ?? c.rules.movement}</span>
            <span className="chip">{fmtTimeLimit(c.rules.timeLimit)}{c.rules.timeLimit ? ' per round' : ''}</span>
            <span className="chip">{c.rounds} rounds</span>
            {c.rules.difficulty && <span className="chip">{c.rules.difficulty}</span>}
            {c.map && <span className="chip teal">{c.map.name}</span>}
          </div>

          {done && (
            <div className="callout info" role="status">
              {c.myGame!.status === 'finished'
                ? <>You finished this challenge{mine ? <> with <b>{fmtInt(mine.score)}</b> points — rank <b>#{mine.rank}</b> of {c.results.length}</> : ''}.</>
                : <>You already have a game for this challenge.</>}
            </div>
          )}

          <div className="row">
            {active ? <Link className="btn primary lg" to={`/play/${c.myGame!.id}`} data-testid="challenge-resume">▶ Resume your game</Link>
              : done ? <Link className="btn primary lg" to={`/play/${c.myGame!.id}`} data-testid="challenge-view">View your game</Link>
              : <button className="btn primary lg" onClick={play} disabled={busy} data-testid="challenge-play">{busy ? 'Starting…' : '▶ Play this challenge'}</button>}
            <button className="btn" onClick={copy}>🔗 Copy link</button>
          </div>

          <label className="field">Share link
            <input className="input mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          </label>
        </section>

        <section className="card" aria-labelledby="st-h">
          <h2 id="st-h">Standings</h2>
          {c.results.length === 0 ? (
            <Empty icon="🏁" title="No finished games yet">{active ? 'Finish your game to take the top spot.' : 'Be the first to post a score.'}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Standings for challenge {c.code}</caption>
                <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" style={{ textAlign: 'right' }}>Score</th></tr></thead>
                <tbody>
                  {c.results.map((r) => (
                    <tr key={r.gameId} className={r.isYou ? 'you' : ''}>
                      <td className={`rank ${r.rank <= 3 ? `r${r.rank}` : ''}`}>{r.rank}</td>
                      <td>
                        <Link className="user-cell" to={`/u/${r.username}`} style={{ color: 'var(--text)' }}>
                          <Avatar avatar={r.avatar} size={28} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.username}</span>
                          {r.isYou && <span className="chip teal">you</span>}
                        </Link>
                      </td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 800 }} title={timeAgo(r.finishedAt)}>{fmtInt(r.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
