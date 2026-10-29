import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { ErrorBox, Loading, Medal, Modal } from '../components/ui.tsx';
import { fmtInt, formatDistance, modeName, timeAgo } from '../lib/format.ts';
import type { AvatarConfig } from '../lib/types.ts';
import './account.css';

type FriendStatus = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming';
interface ProfileData {
  user: { id: string; username: string; avatar: AvatarConfig; guest: boolean; xp: number; bio: string; createdAt: number; online: boolean; level: { level: number; current: number; next: number; progress: number } };
  isSelf: boolean;
  friendStatus: FriendStatus;
  stats: {
    gamesFinished: number; bestFiveRound: number; roundsPlayed: number; avgRoundScore: number; perfectRounds: number; totalDistanceKm: number; avgDistanceKm: number;
    countriesSeen: number; bestCountryStreak: number; bestStateStreak: number; daily: { current: number; best: number };
    multiplayer: { mode: string; played: number; wins: number }[];
    medals: { medal: string; n: number }[];
    byMode: { mode: string; n: number; avg: number; best: number }[];
  };
  achievements: { key: string; name: string; description: string; icon: string; unlockedAt: number | null }[];
  recentGames: { id: string; mode: string; status: string; score: number; rounds: number; map: string | null; mapSlug: string | null; createdAt: number; finishedAt: number | null }[];
  recentMatches: { id: string; mode: string; startedAt: number; endedAt: number | null; outcome: string; placement: number | null; score: number | null; forfeited: boolean; players: number }[];
}

const isStreak = (m: string) => m.startsWith('streak');
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const MEDAL_ORDER = ['bronze', 'silver', 'gold', 'platinum'];

export default function Profile() {
  const { username = '' } = useParams();
  const nav = useNavigate();
  const { user: me, settings, toast, refreshUser } = useApp();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setData(null); setError(null); }
    try { setData(await api<ProfileData>(`/api/users/${encodeURIComponent(username)}`)); }
    catch (e) { setError({ message: errorMessage(e), notFound: e instanceof ApiError && e.status === 404 }); }
  }, [username]);
  useEffect(() => { setBlocked(false); load(); }, [load, me?.id]);

  if (error && !data) {
    if (error.notFound) {
      return (
        <div className="center-state">
          <div className="not-found-art" aria-hidden>🔍</div>
          <h2>No player called “{username}”</h2>
          <p className="muted">Check the spelling, or find them from the leaderboards.</p>
          <div className="row"><Link className="btn" to="/leaderboards">Leaderboards</Link><Link className="btn ghost" to="/">Home</Link></div>
        </div>
      );
    }
    return <ErrorBox message={error.message} onRetry={() => load()} />;
  }
  if (!data) return <Loading label="Loading profile…" />;

  const { user: u, stats, isSelf } = data;
  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg, 'success'); await load(true); }
    catch (e) {
      toast(errorMessage(e), 'error');
    } finally { setBusy(false); }
  };
  const fs = data.friendStatus;
  const unlockedCount = data.achievements.filter((a) => a.unlockedAt).length;
  const medalCounts = Object.fromEntries(stats.medals.map((m) => [m.medal, m.n]));
  const totalMedals = stats.medals.reduce((a, m) => a + m.n, 0);

  return (
    <div className="stack-lg">
      <div className="card pad-lg">
        <div className="profile-head">
          <Avatar avatar={u.avatar} size={96} title={u.username} />
          <div className="who">
            <h1>
              {u.username}
              <span className={`dot ${u.online ? 'on' : ''}`} role="img" aria-label={u.online ? 'Online' : 'Offline'} title={u.online ? 'Online now' : 'Offline'} />
              {isSelf && <span className="chip teal">You</span>}
            </h1>
            <div className="row tight" style={{ marginBottom: 8 }}>
              <span className="chip gold">Level {u.level.level}</span>
              <span className="small muted num">{fmtInt(u.xp)} XP</span>
              <span className="small muted">· Member since {new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </div>
            <div className="xp-bar" role="progressbar" aria-label={`Progress to level ${u.level.level + 1}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.level.progress * 100)}>
              <div style={{ width: `${Math.round(u.level.progress * 100)}%` }} />
            </div>
            <div className="small muted num" style={{ marginTop: 4 }}>{fmtInt(u.level.current)} / {fmtInt(u.level.next)} XP to level {u.level.level + 1}</div>
            {u.bio ? <p className="bio">{u.bio}</p> : isSelf ? <p className="bio muted">You haven’t written a bio yet.</p> : null}
          </div>
          <div className="row" style={{ alignSelf: 'flex-start' }}>
            {isSelf ? (
              <Link className="btn" to="/settings">Edit profile</Link>
            ) : blocked ? (
              <button className="btn" disabled={busy} onClick={() => act(async () => { await api(`/api/blocks/${encodeURIComponent(u.username)}`, { method: 'DELETE' }); setBlocked(false); }, `Unblocked ${u.username}`)}>Unblock</button>
            ) : (
              <>
                {fs === 'none' && <button className="btn primary" disabled={busy} onClick={() => act(() => api('/api/friends/request', { body: { username: u.username } }), 'Friend request sent')}>Add friend</button>}
                {fs === 'outgoing' && (
                  <>
                    <span className="chip">Request sent</span>
                    <button className="btn sm" disabled={busy} onClick={() => act(() => api(`/api/friends/${encodeURIComponent(u.username)}`, { method: 'DELETE' }), 'Request cancelled')}>Cancel</button>
                  </>
                )}
                {fs === 'incoming' && (
                  <>
                    <button className="btn primary" disabled={busy} onClick={() => act(() => api('/api/friends/respond', { body: { username: u.username, accept: true } }), `You and ${u.username} are friends`)}>Accept</button>
                    <button className="btn" disabled={busy} onClick={() => act(() => api('/api/friends/respond', { body: { username: u.username, accept: false } }), 'Request declined')}>Decline</button>
                  </>
                )}
                {fs === 'friends' && <button className="btn" disabled={busy} onClick={() => { if (confirm(`Remove ${u.username} from your friends?`)) act(() => api(`/api/friends/${encodeURIComponent(u.username)}`, { method: 'DELETE' }), 'Friend removed'); }}>Remove friend</button>}
                <button className="btn danger" disabled={busy} onClick={() => setConfirmBlock(true)}>Block</button>
              </>
            )}
          </div>
        </div>
      </div>

      <section>
        <h2>Stats</h2>
        <div className="stat-grid">
          {[
            ['Games finished', fmtInt(stats.gamesFinished)],
            ['Best 5-round score', fmtInt(stats.bestFiveRound)],
            ['Rounds played', fmtInt(stats.roundsPlayed)],
            ['Average round', fmtInt(stats.avgRoundScore)],
            ['Perfect rounds', fmtInt(stats.perfectRounds)],
            ['Countries seen', fmtInt(stats.countriesSeen)],
            ['Average distance', stats.roundsPlayed ? formatDistance(stats.avgDistanceKm, settings.units) : '—'],
            ['Best country streak', fmtInt(stats.bestCountryStreak)],
            ['Best state streak', fmtInt(stats.bestStateStreak)],
            ['Daily streak', `${stats.daily.current} · best ${stats.daily.best}`],
          ].map(([k, v]) => (
            <div className="card" key={k}><div className="stat"><span className="v">{v}</span><span className="k">{k}</span></div></div>
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <h3>By mode</h3>
          {stats.byMode.length === 0 ? <p className="muted small">No finished games yet.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Mode</th><th>Games</th><th>Average</th><th>Best</th></tr></thead>
                <tbody>
                  {stats.byMode.map((m) => (
                    <tr key={m.mode}>
                      <td>{modeName(m.mode)}</td><td className="num">{fmtInt(m.n)}</td>
                      <td className="num">{isStreak(m.mode) ? `${(m.avg ?? 0).toFixed(1)} in a row` : fmtInt(m.avg)}</td>
                      <td className="num">{isStreak(m.mode) ? `${fmtInt(m.best)} in a row` : fmtInt(m.best)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card">
          <h3>Multiplayer</h3>
          {stats.multiplayer.length === 0 ? <p className="muted small">No multiplayer matches yet. <Link to="/rooms">Play with friends</Link>.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Mode</th><th>Played</th><th>Wins</th><th>Win rate</th></tr></thead>
                <tbody>
                  {stats.multiplayer.map((m) => (
                    <tr key={m.mode}>
                      <td>{modeName(m.mode)}</td><td className="num">{fmtInt(m.played)}</td><td className="num">{fmtInt(m.wins)}</td>
                      <td className="num">{m.played ? `${Math.round((m.wins / m.played) * 100)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="row between"><h3>Explorer medals</h3>{isSelf && <Link className="small" to="/explorer">Open Explorer →</Link>}</div>
        {totalMedals === 0 ? <p className="muted small" style={{ margin: 0 }}>No Explorer medals yet. Score 10,000+ in a country to earn bronze.</p> : (
          <div className="medal-row">
            {MEDAL_ORDER.map((m) => <div className="m" key={m}><Medal medal={m} /><span className="num">{medalCounts[m] ?? 0}</span><span className="muted small" style={{ textTransform: 'capitalize' }}>{m}</span></div>)}
          </div>
        )}
      </section>

      <section>
        <div className="row between"><h2>Achievements</h2><span className="chip">{unlockedCount} / {data.achievements.length} unlocked</span></div>
        <div className="ach-grid">
          {data.achievements.map((a) => (
            <div key={a.key} className={`ach ${a.unlockedAt ? 'unlocked' : 'locked'}`} title={a.unlockedAt ? `Unlocked ${new Date(a.unlockedAt).toLocaleDateString()}` : 'Locked'}>
              <span className="ic" aria-hidden>{a.icon}</span>
              <div>
                <div className="nm">{a.name}</div>
                <div className="ds">{a.description}</div>
                <div className="dt">{a.unlockedAt ? `Unlocked ${new Date(a.unlockedAt).toLocaleDateString()}` : 'Locked'}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <h3>Recent games</h3>
          {data.recentGames.length === 0 ? <p className="muted small">No games yet.</p> : (
            <div className="list">
              {data.recentGames.map((g) => (
                <div className="list-item" key={g.id}>
                  <div className="grow">
                    {g.status === 'finished' || isSelf ? <Link to={`/play/${g.id}`} style={{ fontWeight: 700 }}>{modeName(g.mode)}</Link> : <b>{modeName(g.mode)}</b>}
                    <div className="small muted">{g.map ?? 'Unknown map'} · {timeAgo(g.finishedAt ?? g.createdAt)}</div>
                  </div>
                  <span className={`chip ${g.status === 'finished' ? 'teal' : ''}`}>{g.status === 'finished' ? 'Finished' : 'In progress'}</span>
                  <b className="num" style={{ minWidth: 70, textAlign: 'right' }}>{isStreak(g.mode) ? `${fmtInt(g.score)} streak` : fmtInt(g.score)}</b>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <h3>Recent matches</h3>
          {data.recentMatches.length === 0 ? <p className="muted small">No multiplayer matches yet.</p> : (
            <div className="list">
              {data.recentMatches.map((m) => (
                <div className="list-item" key={m.id}>
                  <div className="grow">
                    <b>{modeName(m.mode)}</b>
                    <div className="small muted">
                      {m.placement ? `${ordinal(m.placement)} of ${m.players}` : `${m.players} players`} · {timeAgo(m.endedAt ?? m.startedAt)}
                      {m.forfeited && <span className="chip danger" style={{ marginLeft: 6 }}>Forfeited</span>}
                    </div>
                  </div>
                  <span className={`chip ${m.outcome === 'win' ? 'ok' : m.outcome === 'loss' ? 'danger' : ''}`} style={{ textTransform: 'capitalize' }}>{m.outcome}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {confirmBlock && (
        <Modal title={`Block ${u.username}?`} onClose={() => setConfirmBlock(false)}>
          <p className="text-2">They will be removed from your friends and won’t be able to invite you or send you friend requests. You can unblock them any time from the Friends page.</p>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setConfirmBlock(false)}>Cancel</button>
            <button className="btn danger" disabled={busy} onClick={async () => {
              setConfirmBlock(false);
              await act(async () => { await api('/api/blocks', { body: { username: u.username } }); setBlocked(true); }, `Blocked ${u.username}`);
              refreshUser().catch(() => {});
            }}>Block</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
