import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { useApp } from '../lib/store.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Empty, ErrorBox, Loading, Modal } from '../components/ui.tsx';
import { timeAgo } from '../lib/format.ts';
import type { PublicUser } from '../lib/types.ts';
import './account.css';

interface FriendRow extends PublicUser { online: boolean; lastSeenAt: number | null; since: number }
interface FriendsData { friends: FriendRow[]; incoming: FriendRow[]; outgoing: FriendRow[] }

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const h = setTimeout(() => setV(value), ms); return () => clearTimeout(h); }, [value, ms]);
  return v;
}

export default function Friends() {
  return <FriendsInner />;
}

function FriendsInner() {
  const { toast, user } = useApp();
  const friends = useAsync(() => api<FriendsData>('/api/friends'), []);
  const blocks = useAsync(() => api<{ blocked: PublicUser[] }>('/api/blocks'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<FriendRow | null>(null);

  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [results, setResults] = useState<PublicUser[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (dq.length < 2) { setResults(null); setSearchErr(null); setSearching(false); return; }
    let live = true;
    setSearching(true);
    api<{ users: PublicUser[] }>(`/api/users/search?q=${encodeURIComponent(dq)}`)
      .then((r) => { if (live) { setResults(r.users); setSearchErr(null); } })
      .catch((e) => { if (live) setSearchErr(errorMessage(e)); })
      .finally(() => { if (live) setSearching(false); });
    return () => { live = false; };
  }, [dq]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string, then?: () => void) => {
    setBusy(key);
    try { await fn(); toast(ok, 'success'); friends.reload(); blocks.reload(); then?.(); }
    catch (e) { toast(errorMessage(e), 'error'); }
    finally { setBusy(null); }
  };
  const enc = encodeURIComponent;
  const d = friends.data;
  const relation = (name: string): 'friend' | 'incoming' | 'outgoing' | null => {
    if (!d) return null;
    const n = name.toLowerCase();
    if (d.friends.some((f) => f.username.toLowerCase() === n)) return 'friend';
    if (d.incoming.some((f) => f.username.toLowerCase() === n)) return 'incoming';
    if (d.outgoing.some((f) => f.username.toLowerCase() === n)) return 'outgoing';
    return null;
  };
  const visible = (results ?? []).filter((r) => r.id !== user?.id);

  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Friends</h1><p>Add players by username, then invite them to a private room.</p></div></div>

      <div className="callout info">
        To play together, create a room on the <Link to="/rooms">With friends</Link> page and press <b>Invite</b> next to a friend.
      </div>

      <section className="card">
        <h3>Add a friend</h3>
        <label className="field">
          <span className="sr-only">Search players by username</span>
          <input className="input" type="search" placeholder="Search by username (2+ characters)" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" maxLength={20} aria-label="Search players by username" />
        </label>
        <div aria-live="polite" style={{ marginTop: 8 }}>
          {dq.length > 0 && dq.length < 2 && <p className="hint">Keep typing — at least 2 characters.</p>}
          {searchErr && <p className="error-text">{searchErr}</p>}
          {dq.length >= 2 && !searchErr && searching && !results && <p className="hint">Searching…</p>}
          {dq.length >= 2 && !searchErr && results && visible.length === 0 && !searching && <p className="muted small">No players found starting with “{dq}”.</p>}
          {visible.length > 0 && (
            <div className="list">
              {visible.map((r) => {
                const rel = relation(r.username);
                return (
                  <div className="list-item" key={r.id}>
                    <Link className="name-link grow" to={`/u/${enc(r.username)}`}><Avatar avatar={r.avatar} size={34} /><span className="t">{r.username}</span></Link>
                    {rel === 'friend' && <span className="chip ok">Friends</span>}
                    {rel === 'outgoing' && <span className="chip">Request sent</span>}
                    {rel === 'incoming' && (
                      <button className="btn sm primary" disabled={busy === `acc:${r.username}`} onClick={() => run(`acc:${r.username}`, () => api('/api/friends/respond', { body: { username: r.username, accept: true } }), `You and ${r.username} are friends`)}>Accept</button>
                    )}
                    {rel === null && (
                      <button className="btn sm primary" disabled={busy === `add:${r.username}`} onClick={() => run(`add:${r.username}`, async () => {
                        const res = await api<{ status: string }>('/api/friends/request', { body: { username: r.username } });
                        if (res.status === 'friends') toast(`You and ${r.username} are now friends`, 'success');
                      }, 'Friend request sent')}>Add</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {friends.error && !d ? <ErrorBox message={friends.error} onRetry={friends.reload} /> : !d ? <Loading label="Loading friends…" /> : (
        <>
          {d.incoming.length > 0 && (
            <section className="card">
              <h3>Friend requests <span className="chip accent">{d.incoming.length}</span></h3>
              <div className="list">
                {d.incoming.map((r) => (
                  <div className="list-item" key={r.id}>
                    <Link className="name-link grow" to={`/u/${enc(r.username)}`}><Avatar avatar={r.avatar} size={34} /><span className="t">{r.username}</span></Link>
                    <button className="btn sm primary" disabled={!!busy} onClick={() => run(`acc:${r.username}`, () => api('/api/friends/respond', { body: { username: r.username, accept: true } }), `You and ${r.username} are friends`)}>Accept</button>
                    <button className="btn sm" disabled={!!busy} onClick={() => run(`dec:${r.username}`, () => api('/api/friends/respond', { body: { username: r.username, accept: false } }), 'Request declined')}>Decline</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {d.outgoing.length > 0 && (
            <section className="card">
              <h3>Sent requests</h3>
              <div className="list">
                {d.outgoing.map((r) => (
                  <div className="list-item" key={r.id}>
                    <Link className="name-link grow" to={`/u/${enc(r.username)}`}><Avatar avatar={r.avatar} size={34} /><span className="t">{r.username}</span></Link>
                    <span className="small muted">Waiting for a reply</span>
                    <button className="btn sm" disabled={!!busy} onClick={() => run(`can:${r.username}`, () => api(`/api/friends/${enc(r.username)}`, { method: 'DELETE' }), 'Request cancelled')}>Cancel</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <div className="row between"><h3>Your friends <span className="chip">{d.friends.length}</span></h3>{d.friends.some((f) => f.online) && <span className="small muted">{d.friends.filter((f) => f.online).length} online</span>}</div>
            {d.friends.length === 0 ? (
              <Empty icon="🧭" title="No friends yet">Search for a username above to send your first request.</Empty>
            ) : (
              <div className="list">
                {d.friends.map((f) => (
                  <div className="list-item" key={f.id}>
                    <Link className="name-link grow" to={`/u/${enc(f.username)}`}>
                      <Avatar avatar={f.avatar} size={36} />
                      <span className="t">{f.username}</span>
                    </Link>
                    <span className="row tight small muted" style={{ flexWrap: 'nowrap' }}>
                      <span className={`dot ${f.online ? 'on' : ''}`} role="img" aria-label={f.online ? 'Online' : 'Offline'} />
                      {f.online ? 'Online' : f.lastSeenAt ? `Seen ${timeAgo(f.lastSeenAt)}` : 'Offline'}
                    </span>
                    <button className="btn sm ghost" disabled={!!busy} onClick={() => setRemoving(f)} aria-label={`Remove ${f.username}`}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <section className="card">
        <h3>Blocked players</h3>
        {blocks.error && !blocks.data ? <ErrorBox message={blocks.error} onRetry={blocks.reload} /> : !blocks.data ? <Loading /> : blocks.data.blocked.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>You haven’t blocked anyone. Blocked players can’t send you requests or invites. Block someone from their profile page.</p>
        ) : (
          <div className="list">
            {blocks.data.blocked.map((b) => (
              <div className="list-item" key={b.id}>
                <Link className="name-link grow" to={`/u/${enc(b.username)}`}><Avatar avatar={b.avatar} size={34} /><span className="t">{b.username}</span></Link>
                <button className="btn sm" disabled={!!busy} onClick={() => run(`unb:${b.username}`, () => api(`/api/blocks/${enc(b.username)}`, { method: 'DELETE' }), `Unblocked ${b.username}`)}>Unblock</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {removing && (
        <Modal title={`Remove ${removing.username}?`} onClose={() => setRemoving(null)}>
          <p className="text-2">You’ll no longer be friends. You can send a new request later.</p>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setRemoving(null)}>Cancel</button>
            <button className="btn danger" onClick={() => { const r = removing; setRemoving(null); run(`rm:${r.username}`, () => api(`/api/friends/${enc(r.username)}`, { method: 'DELETE' }), `Removed ${r.username}`); }}>Remove friend</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
