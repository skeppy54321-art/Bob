import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { useAsync, useTick } from '../lib/hooks.ts';
import { useApp } from '../lib/store.tsx';
import { fmtInt, fmtTimeLimit } from '../lib/format.ts';
import { startGame } from '../lib/game.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Empty, ErrorBox, Loading } from '../components/ui.tsx';
import { MOVEMENT_LABELS, type GameRules } from '../../shared/rules.ts';
import type { AvatarConfig } from '../lib/types.ts';
import './content.css';

interface DailyData {
  date: string; rules: GameRules; players: number;
  leaderboard: { rank: number; username: string; avatar: AvatarConfig; score: number; isYou: boolean }[];
  mine: { gameId: string; status: string; score: number } | null;
  streak: { current: number; best: number };
  nextAt: number; serverNow: number;
}

function fmtHMS(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}

export default function Daily() {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const { data, error, reload } = useAsync(() => api<DailyData>('/api/daily'), []);
  const [busy, setBusy] = useState(false);

  // Offset between the server clock and this device so the countdown matches the server.
  const offset = useMemo(() => (data ? data.serverNow - Date.now() : 0), [data]);
  useTick(!!data, 1000);
  const remaining = data ? data.nextAt - (Date.now() + offset) : 0;

  // When the day rolls over, fetch the new daily.
  const rolled = useRef<number | null>(null);
  useEffect(() => {
    if (data && remaining <= 0 && rolled.current !== data.nextAt) {
      rolled.current = data.nextAt;
      const h = setTimeout(reload, 1500);
      return () => clearTimeout(h);
    }
  }, [data, remaining, reload]);

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading today’s challenge…" />;

  const { mine, rules, leaderboard } = data;
  const finished = !!mine && mine.status !== 'active';
  const resume = !!mine && mine.status === 'active';
  const myRow = leaderboard.find((r) => r.isYou);
  const dateLabel = new Date(`${data.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

  const play = async () => {
    setBusy(true);
    try { nav(`/play/${await startGame({ mode: 'daily' })}`); }
    catch (e) { toast(errorMessage(e), 'error'); setBusy(false); }
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Daily challenge</h1><p>{dateLabel} · the same five places for everyone.</p></div>
        <span className="chip">UTC day</span>
      </div>

      <div className="daily-hero">
        <section className="card pad-lg col" style={{ gap: 14 }} aria-labelledby="today-h">
          <h2 id="today-h" style={{ margin: 0 }}>Today’s rules</h2>
          <div className="row tight">
            <span className="chip accent">{MOVEMENT_LABELS[rules.movement]}</span>
            <span className="chip">{fmtTimeLimit(rules.timeLimit)} per round</span>
            <span className="chip">{rules.rounds} rounds</span>
            <span className="chip">{rules.difficulty}</span>
          </div>

          {finished ? (
            <div className="col" style={{ gap: 6 }}>
              <div className="small muted">You scored</div>
              <div className="big-score">{fmtInt(mine!.score)} <span className="muted" style={{ fontSize: '1rem', fontWeight: 600 }}>/ {fmtInt(rules.rounds * 5000)}</span></div>
              {myRow && <div className="small text-2">You’re #{myRow.rank} of {fmtInt(data.players)} today.</div>}
              <div className="row" style={{ marginTop: 6 }}>
                <Link className="btn primary" to={`/play/${mine!.gameId}`} data-testid="daily-review">Review your game</Link>
                <span className="small muted">Next daily in {fmtHMS(remaining)}</span>
              </div>
            </div>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              <p className="text-2" style={{ margin: 0 }}>{resume ? 'You’ve started today’s challenge — pick up where you left off.' : 'You get one attempt per day. Make it count!'}</p>
              {resume ? (
                <div className="row"><Link className="btn primary lg" to={`/play/${mine!.gameId}`} data-testid="daily-resume">▶ Resume</Link></div>
              ) : (
                <div className="row"><button className="btn primary lg" onClick={play} disabled={busy} data-testid="daily-play">{busy ? 'Starting…' : '▶ Play today’s challenge'}</button></div>
              )}
            </div>
          )}
        </section>

        <section className="card pad-lg col" style={{ gap: 14 }} aria-label="Streak and countdown">
          <div className="row" style={{ gap: 28 }}>
            <div className="stat"><span className="v"><span className="flame" aria-hidden>🔥</span> {fmtInt(data.streak.current)}</span><span className="k">Day streak</span></div>
            <div className="stat"><span className="v">{fmtInt(data.streak.best)}</span><span className="k">Best streak</span></div>
            <div className="stat"><span className="v">{fmtInt(data.players)}</span><span className="k">Played today</span></div>
          </div>
          <div>
            <div className="small muted" style={{ fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next daily in</div>
            <div className="countdown" role="timer" aria-label={`Next daily challenge in ${fmtHMS(remaining)}`}>{remaining <= 0 ? 'Refreshing…' : fmtHMS(remaining)}</div>
          </div>
          <p className="hint" style={{ margin: 0 }}>Play every day to grow your streak. Missing a day resets it to zero.</p>
        </section>
      </div>

      <section aria-labelledby="lb-h">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 id="lb-h" style={{ margin: 0 }}>Today’s leaderboard</h2>
          <Link className="small" to="/leaderboards">All leaderboards →</Link>
        </div>
        <div className="card" style={{ padding: leaderboard.length ? '6px 10px' : undefined }}>
          {leaderboard.length === 0 ? (
            <Empty icon="📅" title="No one has finished today’s challenge yet">Be the first on the board.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Daily leaderboard for {data.date}</caption>
                <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" style={{ textAlign: 'right' }}>Score</th></tr></thead>
                <tbody>
                  {leaderboard.map((r) => (
                    <tr key={r.username} className={r.isYou ? 'you' : ''}>
                      <td className={`rank ${r.rank <= 3 ? `r${r.rank}` : ''}`}>{r.rank}</td>
                      <td>
                        <Link className="user-cell" to={`/u/${r.username}`} style={{ color: 'var(--text)' }}>
                          <Avatar avatar={r.avatar} size={28} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.username}</span>
                          {r.isYou && <span className="chip teal">you</span>}
                        </Link>
                      </td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{fmtInt(r.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
