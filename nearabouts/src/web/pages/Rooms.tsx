import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { emit } from '../lib/socket.ts';
import { useApp } from '../lib/store.tsx';
import { FORMAT_INFO, type Format } from '../../shared/room.ts';
import { MODE_ICONS } from './Modes.tsx';
import { modeName, timeAgo } from '../lib/format.ts';
import { errorMessage } from '../lib/api.ts';

export default function Rooms() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { toast, config } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<{ code: string; from: string; format: string; at: number }[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const preFormat = params.get('format') as Format | null;
  const preMap = params.get('map');

  useEffect(() => {
    emit('invites:list').then((r) => { setInvites(r.invites ?? []); setCurrent(r.roomCode ?? null); }).catch(() => {});
  }, []);

  const create = async (format?: Format) => {
    setBusy(true);
    try {
      const r = await emit('room:create');
      const patch: Record<string, unknown> = {};
      if (format ?? (preFormat && FORMAT_INFO[preFormat] ? preFormat : null)) patch.format = format ?? preFormat;
      if (preMap) patch.mapSlug = preMap;
      if (Object.keys(patch).length) await emit('room:settings', patch).catch((e) => toast(errorMessage(e), 'error'));
      nav(`/r/${r.code}`);
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 4) { toast('Room codes are 5 characters, like K7QX2.', 'error'); return; }
    nav(`/r/${c}`);
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Play with friends</h1>
          <p>Create a private room, share the code or link, and pick a game. Up to {config!.maxRoomPlayers} players. Guests can join too.</p>
        </div>
      </div>

      {current && (
        <div className="callout info row between">
          <span>You are still in room <b className="mono">{current}</b>.</span>
          <Link className="btn sm teal" to={`/r/${current}`}>Return to room</Link>
        </div>
      )}

      <div className="grid cols-2">
        <section className="card pad-lg col">
          <h2>Create a room</h2>
          <p className="text-2" style={{ margin: 0 }}>You’ll be the host: choose the format, map and rules, then start when everyone is ready.{preFormat && FORMAT_INFO[preFormat] ? <> Starting as <b>{FORMAT_INFO[preFormat].name}</b>.</> : null}</p>
          <button className="btn primary lg" onClick={() => create()} disabled={busy} data-testid="create-room">{busy ? 'Creating…' : 'Create room'}</button>
        </section>
        <section className="card pad-lg col">
          <h2>Join with a code</h2>
          <form className="row" onSubmit={join}>
            <label className="sr-only" htmlFor="room-code">Room code</label>
            <input id="room-code" className="input mono grow" style={{ textTransform: 'uppercase', letterSpacing: '0.2em', fontSize: '1.2rem' }} maxLength={8}
              placeholder="K7QX2" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" data-testid="join-code" />
            <button className="btn" type="submit" data-testid="join-room">Join</button>
          </form>
          <p className="hint" style={{ margin: 0 }}>Or open the invite link your friend shared.</p>
        </section>
      </div>

      {invites.length > 0 && (
        <section className="card">
          <h3>Invitations</h3>
          <div className="list">
            {invites.map((i) => (
              <div className="list-item" key={i.code}>
                <span className="grow"><b>{i.from}</b> invited you to <b>{modeName(i.format)}</b> <span className="muted small">· {timeAgo(i.at)}</span></span>
                <button className="btn sm ghost" onClick={() => { emit('invite:dismiss', { code: i.code }).catch(() => {}); setInvites((x) => x.filter((y) => y.code !== i.code)); }}>Dismiss</button>
                <Link className="btn sm primary" to={`/r/${i.code}`}>Join</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Game formats</h2>
        <div className="grid cols-3">
          {(Object.keys(FORMAT_INFO) as Format[]).map((f) => (
            <button key={f} className="card hover mode-card" onClick={() => create(f)} disabled={busy}>
              <span className="mode-icon" aria-hidden>{MODE_ICONS[f]}</span>
              <h3>{FORMAT_INFO[f].name}</h3>
              <p>{FORMAT_INFO[f].summary}</p>
              <span className="muted small">{FORMAT_INFO[f].min === FORMAT_INFO[f].max ? `${FORMAT_INFO[f].min} players` : `${FORMAT_INFO[f].min}–${FORMAT_INFO[f].max} players`}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
