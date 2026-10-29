import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { useApp } from '../lib/store.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Empty, ErrorBox, Segmented } from '../components/ui.tsx';
import { fmtInt } from '../lib/format.ts';
import type { AvatarConfig } from '../lib/types.ts';
import './account.css';

type Board = 'xp' | 'classic' | 'streak' | 'daily' | 'wins';
type Scope = 'global' | 'friends';
interface Entry { rank: number; username: string; avatar: AvatarConfig; value: number; isYou: boolean; level?: number }

const BOARDS: { value: Board; label: string; blurb: string; col: string }[] = [
  { value: 'xp', label: 'Level / XP', blurb: 'Total experience earned across every mode.', col: 'Level · XP' },
  { value: 'classic', label: 'Best World game', blurb: 'Highest score in a 5-round game on the World map (max 25,000).', col: 'Score' },
  { value: 'streak', label: 'Country streak', blurb: 'Longest run of correct countries in a row.', col: 'Streak' },
  { value: 'daily', label: 'Today’s daily', blurb: 'Scores for today’s daily challenge (resets at 00:00 UTC).', col: 'Score' },
  { value: 'wins', label: 'Multiplayer wins', blurb: 'Matches won in private rooms.', col: 'Wins' },
];

export default function Leaderboards() {
  const { user } = useApp();
  const [params, setParams] = useSearchParams();
  const initial = BOARDS.find((b) => b.value === params.get('board'))?.value ?? 'xp';
  const [board, setBoard] = useState<Board>(initial);
  const [scope, setScope] = useState<Scope>(params.get('scope') === 'friends' ? 'friends' : 'global');

  useEffect(() => {
    const next = new URLSearchParams(); next.set('board', board); if (scope === 'friends') next.set('scope', 'friends');
    setParams(next, { replace: true });
  }, [board, scope, setParams]);

  const { data, error, loading, reload } = useAsync(
    () => api<{ entries: Entry[] }>(`/api/leaderboards/${board}?scope=${scope}`),
    [board, scope, user?.id],
  );
  const info = BOARDS.find((b) => b.value === board)!;
  const entries = data?.entries ?? [];

  const fmtValue = (e: Entry) => {
    if (board === 'xp') return <>Lv {e.level ?? 1} <span className="muted">· {fmtInt(e.value)} XP</span></>;
    return fmtInt(e.value);
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Leaderboards</h1><p>{info.blurb}</p></div>
        <Segmented<Scope> label="Scope" value={scope} onChange={setScope} options={[{ value: 'global', label: 'Global' }, { value: 'friends', label: 'Friends' }]} />
      </div>
      <div className="table-wrap" style={{ paddingBottom: 2 }}>
        <Segmented<Board> label="Leaderboard" value={board} onChange={setBoard} options={BOARDS.map((b) => ({ value: b.value, label: b.label }))} />
      </div>

      <div className="card" style={{ padding: 8 }}>
        {error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : loading && !data ? (
          <div className="col" style={{ padding: 10 }} aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" style={{ minHeight: 40 }} />)}</div>
        ) : entries.length === 0 ? (
          scope === 'friends' ? (
            <Empty icon="🏁" title="Nothing here yet">
              <p>No scores from you or your friends on this board. Play a game, or <Link to="/friends">add some friends</Link>.</p>
            </Empty>
          ) : (
            <Empty icon="🏁" title="No scores yet">
              <p>Be the first on this board. <Link to="/play">Start a game</Link>.</p>
            </Empty>
          )
        ) : (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="table">
              <caption className="sr-only">{info.label} leaderboard, {scope}</caption>
              <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" style={{ textAlign: 'right' }}>{info.col}</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.username} className={e.isYou ? 'you' : ''} aria-current={e.isYou ? 'true' : undefined}>
                    <td><span className={`rank ${e.rank <= 3 ? `r${e.rank}` : ''}`}>{e.rank}</span></td>
                    <td>
                      <div className="row tight" style={{ flexWrap: 'nowrap' }}>
                        <Link className="name-link" to={`/u/${encodeURIComponent(e.username)}`}>
                          <Avatar avatar={e.avatar} size={30} />
                          <span className="t">{e.username}</span>
                        </Link>
                        {e.isYou && <span className="chip teal">You</span>}
                      </div>
                    </td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtValue(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="small muted">Everyone who has picked a name appears here.</p>
    </div>
  );
}
