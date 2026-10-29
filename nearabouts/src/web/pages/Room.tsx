import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { emit, getSocket } from '../lib/socket.ts';
import { api, errorMessage } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { useServerClock, useTick } from '../lib/hooks.ts';
import type { RoomSnapshot, RoomSettings, Format } from '../lib/types.ts';
import { GameStage } from '../components/GameStage.tsx';
import { ResultMap } from '../components/ResultMap.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { ErrorBox, Loading, Modal, Segmented, Switch } from '../components/ui.tsx';
import { RulesForm } from '../components/RulesForm.tsx';
import { FORMAT_INFO, CHAT_PRESETS } from '../../shared/room.ts';
import { MOVEMENT_LABELS } from '../../shared/rules.ts';
import { formatDistance, fmtInt, fmtTimeLimit, flag, fmtClock } from '../lib/format.ts';
import { shareText } from '../lib/game.ts';

type Member = RoomSnapshot['members'][number];
const PALETTE = ['#f5c451', '#9b8cff', '#ff8fb1', '#4ea8ff', '#ffb547', '#7ee081', '#ff7a59', '#c58bff', '#5fd4c8', '#e9eef6'];
const TEAM_COLORS = ['#4ea8ff', '#ff7a59'];

// Leaving is delayed slightly so a quick remount (dev StrictMode, fast navigation back) doesn't drop you.
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

export default function Room() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { toast, user } = useApp();
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [muted, setMuted] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('nearabouts:muted') ?? '[]')); } catch { return new Set(); } });
  const now = useServerClock(snap?.serverNow);
  const upper = code.toUpperCase();

  const join = useCallback(() => {
    emit('room:join', { code: upper }).then(() => setError(null)).catch((e) => setError(errorMessage(e)));
  }, [upper]);

  useEffect(() => {
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
    const s = getSocket();
    const onState = (st: RoomSnapshot) => { if (st.code === upper) setSnap(st); };
    const onKicked = () => { toast('The host removed you from the room.', 'error'); nav('/rooms'); };
    const onConnect = () => { setConnected(true); join(); };
    const onDisconnect = () => setConnected(false);
    s.on('room:state', onState);
    s.on('room:kicked', onKicked);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    if (s.connected) join();
    return () => {
      s.off('room:state', onState); s.off('room:kicked', onKicked); s.off('connect', onConnect); s.off('disconnect', onDisconnect);
      leaveTimer = setTimeout(() => { emit('room:leave').catch(() => {}); leaveTimer = null; }, 400);
    };
  }, [upper, join, nav, toast]);

  useEffect(() => { try { localStorage.setItem('nearabouts:muted', JSON.stringify([...muted])); } catch { /* ignore */ } }, [muted]);

  if (error) return (
    <div className="main">
      <ErrorBox message={error} onRetry={join} />
      <div className="row" style={{ justifyContent: 'center' }}><Link className="btn" to="/rooms">Back to rooms</Link></div>
    </div>
  );
  if (!snap) return <div className="main"><Loading label={`Joining room ${upper}…`} /></div>;

  const me = snap.members.find((m) => m.id === snap.you);
  const ctx: Ctx = { snap, me, now, toast, muted, setMuted, leave: () => { emit('room:leave').catch(() => {}); nav('/rooms'); }, isAccount: !!user };
  return (
    <>
      {!connected && <div className="toasts" style={{ top: 16, bottom: 'auto' }}><div className="toast error">Connection lost — reconnecting…</div></div>}
      {snap.status === 'lobby' && <Lobby {...ctx} />}
      {snap.status === 'starting' && <Starting {...ctx} />}
      {snap.status === 'round' && <LiveRound {...ctx} />}
      {snap.status === 'reveal' && <Reveal {...ctx} />}
      {snap.status === 'finished' && <Finished {...ctx} />}
    </>
  );
}

interface Ctx {
  snap: RoomSnapshot; me: Member | undefined; now: () => number; toast: ReturnType<typeof useApp>['toast'];
  muted: Set<string>; setMuted: (s: Set<string>) => void; leave: () => void; isAccount: boolean;
}

const act = async (toast: Ctx['toast'], event: string, data?: unknown) => {
  try { return await emit(event, data); } catch (e) { toast(errorMessage(e), 'error'); return null; }
};
const colorFor = (snap: RoomSnapshot, id: string) => {
  if (id === snap.you) return '#2ed3b7';
  const m = snap.members.find((x) => x.id === id);
  if (m?.team !== null && m?.team !== undefined && (snap.settings.format === 'teamduel' || snap.settings.teams)) return TEAM_COLORS[m.team];
  return PALETTE[Math.max(0, snap.members.findIndex((x) => x.id === id)) % PALETTE.length];
};
const teamMode = (s: RoomSnapshot) => s.settings.format === 'teamduel' || (s.settings.format === 'party' && s.settings.teams);

// ---------------------------------------------------------------------------- lobby
function Lobby(c: Ctx) {
  const { snap, me, toast } = c;
  const isHost = snap.hostId === snap.you;
  const s = snap.settings;
  const info = FORMAT_INFO[s.format];
  const link = `${location.origin}/r/${snap.code}`;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const players = snap.members.filter((m) => !m.spectator);
  const spectators = snap.members.filter((m) => m.spectator);
  const set = (patch: Partial<RoomSettings>) => act(toast, 'room:settings', patch);

  const copy = async () => { const r = await shareText(`Join my Nearabouts room ${snap.code}`, link); toast(r === 'failed' ? link : 'Invite link copied!', 'success'); };

  return (
    <main className="main wide fade-in">
      <div className="page-head">
        <div>
          <span className="chip">Private room</span>
          <h1 style={{ marginTop: 8 }}>{info.name}</h1>
          <p>{info.summary}</p>
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
          <span className="muted small">Room code</span>
          <span className="room-code" data-testid="room-code">{snap.code}</span>
          <div className="row tight">
            <button className="btn sm" onClick={copy}>Copy invite link</button>
            {c.isAccount && <button className="btn sm" onClick={() => setInviteOpen(true)}>Invite friends</button>}
            <button className="btn sm ghost" onClick={c.leave}>Leave</button>
          </div>
        </div>
      </div>
      {snap.error && <div className="callout danger" style={{ marginBottom: 14 }}>{snap.error}</div>}
      <div className="lobby">
        <div className="col" style={{ gap: 16 }}>
          <section className="card">
            <div className="row between"><h3>Players ({players.length}/{info.max === info.min ? info.max : `${info.min}–${info.max}`})</h3>
              {me && !me.spectator && !isHost && (
                <button className={`btn ${me.ready ? 'teal' : 'primary'}`} onClick={() => act(toast, 'room:ready', { ready: !me.ready })} data-testid="ready-btn">{me.ready ? '✓ Ready' : 'I’m ready'}</button>
              )}
            </div>
            {teamMode(snap) ? (
              <div className="grid cols-2" style={{ marginTop: 10 }}>
                {[0, 1].map((t) => (
                  <div key={t} className={`team-col t${t}`}>
                    <div className="row between"><b style={{ color: TEAM_COLORS[t] }}>Team {t === 0 ? 'Blue' : 'Orange'}</b>
                      {me && !me.spectator && me.team !== t && <button className="btn sm ghost" onClick={() => act(toast, 'room:team', { team: t })}>Join</button>}
                    </div>
                    {players.filter((m) => m.team === t).map((m) => <PlayerRow key={m.id} c={c} m={m} isHost={isHost} />)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="col" style={{ gap: 6, marginTop: 10 }}>{players.map((m) => <PlayerRow key={m.id} c={c} m={m} isHost={isHost} />)}</div>
            )}
            {spectators.length > 0 && (
              <><div className="divider" /><span className="muted small">Spectators</span>
                <div className="col" style={{ gap: 6, marginTop: 6 }}>{spectators.map((m) => <PlayerRow key={m.id} c={c} m={m} isHost={isHost} />)}</div></>
            )}
            {me && <div className="row" style={{ marginTop: 12 }}>
              <button className="btn sm ghost" onClick={() => act(toast, 'room:spectate', { spectator: !me.spectator })}>{me.spectator ? 'Play instead of watching' : 'Watch as spectator'}</button>
            </div>}
          </section>

          <section className="card">
            <h3>How {info.name} works</h3>
            <ul className="text-2" style={{ margin: 0, paddingLeft: 18 }}>{info.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </section>
          <Chat c={c} />
        </div>

        <div className="col" style={{ gap: 16 }}>
          <section className="card col" style={{ gap: 14 }}>
            <div className="row between"><h3>Game settings</h3>{!isHost && <span className="chip">Host decides</span>}</div>
            <fieldset disabled={!isHost} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="col" style={{ gap: 6 }}>
                <span className="small text-2" style={{ fontWeight: 650 }}>Format</span>
                <Segmented<Format> label="Format" value={s.format} onChange={(format) => set({ format })}
                  options={(Object.keys(FORMAT_INFO) as Format[]).map((f) => ({ value: f, label: FORMAT_INFO[f].name.replace('Battle Royale: ', 'BR ') }))} />
              </div>
              <div className="row between">
                <span>Map: <b>{snap.map?.name ?? s.mapSlug}</b></span>
                {isHost && <button className="btn sm" type="button" onClick={() => setMapOpen(true)}>Change map</button>}
              </div>
              <RulesForm value={{ movement: s.movement, timeLimit: s.timeLimit, rounds: s.rounds, difficulty: s.difficulty }}
                onChange={(r) => set(r)} hide={s.format === 'party' ? [] : ['rounds']} allowUntimed={s.format === 'party'} />
              {s.format === 'party' && <Switch checked={s.teams} onChange={(teams) => set({ teams })} label="Play in two teams (team score = average of members)" />}
              {(s.format === 'duel' || s.format === 'teamduel') && (
                <>
                  <NumberChoice label="Starting health" value={s.startHealth} options={[3000, 6000, 10000, 15000]} onChange={(startHealth) => set({ startHealth })} />
                  <NumberChoice label="Damage multiplier starts at round" value={s.multiplierFrom} options={[2, 3, 4, 6, 99]} format={(v) => (v === 99 ? 'Never' : String(v))} onChange={(multiplierFrom) => set({ multiplierFrom })} />
                  <NumberChoice label="Multiplier growth per round" value={s.multiplierStep} options={[0.25, 0.5, 1]} format={(v) => `+${v}×`} onChange={(multiplierStep) => set({ multiplierStep })} />
                </>
              )}
              {(s.format === 'duel' || s.format === 'teamduel' || s.format === 'br_distance') && (
                <NumberChoice label="Countdown after the first guess" value={s.countdownAfterGuess} options={[0, 10, 15, 20, 30]} format={(v) => (v ? `${v}s` : 'Off')} onChange={(countdownAfterGuess) => set({ countdownAfterGuess })} />
              )}
              {s.format === 'br_countries' && (
                <>
                  <NumberChoice label="Lives" value={s.lives} options={[1, 2, 3, 4, 5]} onChange={(lives) => set({ lives })} />
                  <Switch checked={s.slowestLosesLife} onChange={(slowestLosesLife) => set({ slowestLosesLife })} label="If everyone is right, the slowest loses a life" />
                </>
              )}
              {s.format === 'br_distance' && <NumberChoice label="Eliminated per round" value={s.eliminatePerRound} options={[1, 2, 3]} onChange={(eliminatePerRound) => set({ eliminatePerRound })} />}
            </fieldset>
            {!isHost && <p className="hint" style={{ margin: 0 }}>{MOVEMENT_LABELS[s.movement]} · {fmtTimeLimit(s.timeLimit)}{s.format === 'party' ? ` · ${s.rounds} rounds` : ''}</p>}
          </section>
          <section className="card col">
            {snap.startProblem ? <div className="callout warn" data-testid="start-problem">{snap.startProblem}</div> : <div className="callout info">Everyone’s ready.</div>}
            {isHost ? (
              <button className="btn primary lg block" disabled={!!snap.startProblem} onClick={() => act(toast, 'room:start')} data-testid="start-btn">Start game</button>
            ) : <p className="muted" style={{ margin: 0 }}>Waiting for the host to start.</p>}
            {snap.demo && <p className="hint" style={{ margin: 0 }}>Demo mode: rounds use illustrated scenes, not photographs.</p>}
          </section>
        </div>
      </div>
      {inviteOpen && <InviteModal c={c} onClose={() => setInviteOpen(false)} />}
      {mapOpen && <MapPicker onPick={(slug) => { set({ mapSlug: slug }); setMapOpen(false); }} onClose={() => setMapOpen(false)} />}
    </main>
  );
}

function NumberChoice({ label, value, options, onChange, format }: { label: string; value: number; options: number[]; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="small text-2" style={{ fontWeight: 650 }}>{label}</span>
      <Segmented<number> label={label} value={value} onChange={onChange} options={options.map((o) => ({ value: o, label: format ? format(o) : o.toLocaleString() }))} />
    </div>
  );
}

function PlayerRow({ c, m, isHost }: { c: Ctx; m: Member; isHost: boolean }) {
  const { snap, toast } = c;
  const [menu, setMenu] = useState(false);
  const self = m.id === snap.you;
  return (
    <div className={`player-row ${m.connected ? '' : 'offline'}`} data-testid="player-row">
      <Avatar avatar={m.avatar as any} size={30} />
      <span className="name">{m.username}{self ? ' (you)' : ''}</span>
      {m.id === snap.hostId && <span className="chip gold" title="Host">Host</span>}
      {!m.connected && <span className="chip">Offline</span>}
      {!m.spectator && m.id !== snap.hostId && (m.ready ? <span className="chip teal">Ready</span> : <span className="chip">Not ready</span>)}
      {!self && (
        <div style={{ position: 'relative' }}>
          <button className="btn ghost icon sm" onClick={() => setMenu((x) => !x)} aria-label={`Actions for ${m.username}`} aria-expanded={menu}>⋯</button>
          {menu && (
            <div className="card" style={{ position: 'absolute', right: 0, top: 34, zIndex: 20, padding: 6, minWidth: 180 }} onMouseLeave={() => setMenu(false)}>
              <div className="col" style={{ gap: 2 }}>
                <Link className="btn sm ghost" to={`/u/${m.username}`} target="_blank">View profile</Link>
                <button className="btn sm ghost" onClick={() => { const n = new Set(c.muted); n.has(m.id) ? n.delete(m.id) : n.add(m.id); c.setMuted(n); setMenu(false); }}>{c.muted.has(m.id) ? 'Unmute chat' : 'Mute chat'}</button>
                <button className="btn sm ghost" onClick={async () => { if (!confirm(`Block ${m.username}? You won’t see each other’s chat or invites.`)) return; try { await api('/api/blocks', { body: { username: m.username } }); toast(`${m.username} blocked.`); } catch (e) { toast(errorMessage(e), 'error'); } setMenu(false); }}>Block</button>
                {isHost && <>
                  {teamMode(snap) && !m.spectator && <button className="btn sm ghost" onClick={() => { act(toast, 'room:team', { userId: m.id, team: m.team === 0 ? 1 : 0 }); setMenu(false); }}>Move to other team</button>}
                  <button className="btn sm ghost" onClick={() => { act(toast, 'room:spectate', { userId: m.id, spectator: !m.spectator }); setMenu(false); }}>{m.spectator ? 'Make player' : 'Make spectator'}</button>
                  <button className="btn sm ghost" onClick={() => { act(toast, 'room:host', { userId: m.id }); setMenu(false); }}>Make host</button>
                  <button className="btn sm danger" onClick={() => { if (confirm(`Remove ${m.username} from the room?`)) act(toast, 'room:kick', { userId: m.id }); setMenu(false); }}>Kick</button>
                </>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chat({ c, compact }: { c: Ctx; compact?: boolean }) {
  const { snap, toast } = c;
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const msgs = snap.chat.filter((m) => !c.muted.has(m.userId));
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [msgs.length]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const r = await act(toast, 'room:chat', { text });
    if (r) setText('');
  };
  return (
    <section className={compact ? '' : 'card'}>
      {!compact && <h3>Chat</h3>}
      <div className="chat">
        <div className="chat-log" ref={log} aria-live="polite" data-testid="chat-log">
          {msgs.length === 0 && <span className="muted small">Say hi! Messages vanish when the room closes.</span>}
          {msgs.map((m) => (
            <div key={m.id} className={`chat-msg ${m.userId === 'system' ? 'system' : ''}`}>
              {m.userId !== 'system' && <span className="who" style={{ color: colorFor(snap, m.userId) }}>{m.username}</span>}
              <span>{m.text}</span>
            </div>
          ))}
        </div>
        <div className="row tight" style={{ marginTop: 6 }}>
          {CHAT_PRESETS.slice(0, compact ? 4 : 8).map((p, i) => <button key={p} className="chip" style={{ cursor: 'pointer' }} onClick={() => act(toast, 'room:chat', { preset: i })}>{p}</button>)}
        </div>
        <form className="row tight" style={{ marginTop: 6 }} onSubmit={send}>
          <input className="input grow" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" aria-label="Chat message" data-testid="chat-input" />
          <button className="btn" type="submit">Send</button>
        </form>
      </div>
    </section>
  );
}

function InviteModal({ c, onClose }: { c: Ctx; onClose: () => void }) {
  const [friends, setFriends] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  useEffect(() => { api('/api/friends').then((r) => setFriends(r.friends)).catch((e) => setErr(errorMessage(e))); }, []);
  return (
    <Modal title="Invite friends" onClose={onClose}>
      {err ? <p className="error-text">{err}</p> : !friends ? <Loading /> : friends.length === 0 ? (
        <p className="text-2">No friends yet. <Link to="/friends">Add some</Link>, or copy the invite link instead.</p>
      ) : (
        <div className="list">
          {friends.map((f) => (
            <div key={f.id} className="list-item">
              <Avatar avatar={f.avatar} size={28} /><span className="grow">{f.username}</span>
              <span className={`dot ${f.online ? 'on' : ''}`} title={f.online ? 'Online' : 'Offline'} />
              <button className="btn sm" disabled={sent.has(f.id)} onClick={async () => {
                const r = await act(c.toast, 'room:invite', { username: f.username });
                if (r) { setSent(new Set(sent).add(f.id)); c.toast(r.online ? `Invite sent to ${f.username}.` : `${f.username} is offline — they’ll see it next time.`, 'success'); }
              }}>{sent.has(f.id) ? 'Invited' : 'Invite'}</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function MapPicker({ onPick, onClose }: { onPick: (slug: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [maps, setMaps] = useState<any[] | null>(null);
  useEffect(() => {
    const h = setTimeout(() => { api(`/api/maps?limit=30&q=${encodeURIComponent(q)}`).then((r) => setMaps(r.maps)).catch(() => setMaps([])); }, 250);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <Modal title="Choose a map" onClose={onClose} wide>
      <input className="input" placeholder="Search maps…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search maps" />
      <div className="list" style={{ marginTop: 10, maxHeight: '55vh', overflowY: 'auto' }}>
        {!maps ? <Loading /> : maps.length === 0 ? <p className="muted">No maps found.</p> : maps.map((m) => (
          <button key={m.id} className="list-item" style={{ background: 'none', border: 0, borderBottom: '1px solid var(--border)', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => onPick(m.slug)}>
            <span className="grow"><b>{m.countryCode ? `${flag(m.countryCode)} ` : ''}{m.name}</b> <span className="muted small">· {m.category}</span></span>
            <span className={`chip ${m.playable >= 5 ? 'teal' : ''}`}>{m.playable} playable</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------- in game
function HealthBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="health">
      <div className="label"><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span><span className="num">{fmtInt(value)}</span></div>
      <div className="bar"><div style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} /></div>
    </div>
  );
}

function StatusBars({ snap }: { snap: RoomSnapshot }) {
  const s = snap.settings;
  const players = snap.members.filter((m) => !m.spectator || m.forfeited);
  if (s.format === 'duel') return <div className="col" style={{ gap: 6 }}>{players.map((m) => <HealthBar key={m.id} label={m.username + (m.forfeited ? ' (left)' : '')} value={m.health} max={s.startHealth} color={colorFor(snap, m.id)} />)}</div>;
  if (s.format === 'teamduel' && snap.teams) return <div className="col" style={{ gap: 6 }}>{snap.teams.map((t) => <HealthBar key={t.team} label={`Team ${t.team === 0 ? 'Blue' : 'Orange'}`} value={t.health} max={s.startHealth} color={TEAM_COLORS[t.team]} />)}</div>;
  return null;
}

function PlayersStrip({ snap }: { snap: RoomSnapshot }) {
  const s = snap.settings;
  return (
    <div className="players-strip" aria-label="Players">
      {snap.members.filter((m) => !m.spectator || m.forfeited).map((m) => (
        <span key={m.id} className={`p ${m.guessed ? 'guessed' : ''} ${!m.alive || m.forfeited ? 'out' : ''}`} title={m.guessed ? `${m.username} has guessed` : m.username}>
          <Avatar avatar={m.avatar as any} size={20} />
          {m.username}{s.format === 'br_countries' && m.alive ? <span className="lives">{'♥'.repeat(Math.max(0, m.lives))}</span> : null}
          {m.guessed ? ' ✓' : ''}{!m.connected && !m.forfeited ? ' ⚠' : ''}
        </span>
      ))}
    </div>
  );
}

function LiveRound(c: Ctx) {
  const { snap, me, toast, now } = c;
  const r = snap.round!;
  const [chatOpen, setChatOpen] = useState(false);
  const s = snap.settings;
  const playing = !!me && !me.spectator && me.alive && !me.forfeited;
  const others = useMemo(() => r.guesses.filter((g) => g.userId !== snap.you).map((g) => ({ ...g, color: colorFor(snap, g.userId), label: `${snap.members.find((m) => m.id === g.userId)?.username ?? 'Teammate'} (teammate)` })), [r.guesses, snap]);
  const guess = async (p: { lat: number; lng: number }) => {
    const res = await act(toast, 'room:guess', { ...p, round: r.idx });
    if (res && !res.accepted) toast(res.reason === 'too_late' ? 'Too late — the round had ended.' : res.reason === 'duplicate' ? 'You already guessed.' : 'Guess not accepted.', 'error');
  };
  const lockedLabel = !me || me.spectator ? 'Spectating' : me.forfeited ? 'You left this match' : !me.alive ? 'Eliminated — watching' : 'Guess locked in — waiting for others';
  return (
    <GameStage
      pano={r.pano} movement={s.movement} roundKey={`${snap.code}:${r.idx}:${r.pano.panoId}`} now={now}
      startedAt={r.startedAt} deadline={r.endsAt} countdownEndsAt={r.countdownEndsAt}
      onGuess={guess} guessLocked={!playing || !!me?.guessed} lockedLabel={lockedLabel}
      guessLabel={s.format === 'br_countries' ? 'Guess this country' : 'Guess'}
      mapBounds={(snap.map as any)?.bounds ?? null} labels={s.difficulty !== 'hard'} others={others}
      onPanoError={() => emit('room:unavailable', { round: r.idx }).catch(() => {})}
      onExit={() => { if (confirm(s.format === 'party' ? 'Leave this game?' : 'Leaving now counts as a forfeit. Leave?')) c.leave(); }}
      hud={<>
        <div className="kv"><span className="k">{FORMAT_INFO[s.format].name}</span><span className="v">{snap.map?.name}</span></div>
        <div className="kv"><span className="k">Round</span><span className="v" data-testid="mp-round">{r.number}{s.format === 'party' ? ` / ${s.rounds}` : ''}</span></div>
        {r.multiplier > 1 && <div className="kv"><span className="k">Damage</span><span className="v" style={{ color: 'var(--warn)' }}>×{r.multiplier}</span></div>}
        {s.format === 'party' && me && <div className="kv"><span className="k">Score</span><span className="v">{fmtInt(me.totalScore)}</span></div>}
        {(s.format === 'br_countries' || s.format === 'br_distance') && <div className="kv"><span className="k">Alive</span><span className="v">{snap.members.filter((m) => !m.spectator && m.alive && !m.forfeited).length}</span></div>}
      </>}
      hudRight={<div className="col" style={{ gap: 6, alignItems: 'flex-end' }}>
        <div className="hud-pill" style={{ flexDirection: 'column', alignItems: 'stretch' }}><StatusBars snap={snap} /><PlayersStrip snap={snap} /></div>
        <button className="btn sm" onClick={() => setChatOpen((x) => !x)} aria-expanded={chatOpen}>💬 Chat{snap.chat.length ? ` (${snap.chat.length})` : ''}</button>
      </div>}
      overlay={chatOpen ? <div className="chat-overlay"><Chat c={c} compact /></div> : null}
    />
  );
}

function Starting({ snap, now }: Ctx) {
  useTick(true, 200);
  const left = snap.startsAt ? snap.startsAt - now() : 0;
  const nextNumber = (snap.history.length || 0) + 1;
  return (
    <div className="stage"><div className="countdown-overlay">
      <div className="col" style={{ alignItems: 'center' }}>
        <span className="muted">{FORMAT_INFO[snap.settings.format].name} · {snap.map?.name}</span>
        <div className="n num">{left > 400 ? Math.ceil(left / 1000) : <span className="spinner" style={{ width: 48, height: 48 }} />}</div>
        <span className="text-2">Round {nextNumber} is coming up…</span>
      </div>
    </div></div>
  );
}

function RoundTable({ snap, result }: { snap: RoomSnapshot; result: NonNullable<RoomSnapshot['lastResult']> }) {
  const { settings: st } = useApp();
  const fmt = snap.settings.format;
  const rows = [...result.players].sort((a, b) => (fmt === 'br_countries' ? Number(b.correct) - Number(a.correct) : (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)));
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Player</th><th>{fmt === 'br_countries' ? 'Answer' : 'Distance'}</th>{fmt !== 'br_countries' && <th>Score</th>}
        {(fmt === 'duel' || fmt === 'teamduel') && <th>Damage</th>}{fmt === 'br_countries' && <th>Lives</th>}{fmt.startsWith('br_') && <th></th>}</tr></thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.userId} className={p.userId === snap.you ? 'you' : ''}>
            <td><span className="dot" style={{ background: colorFor(snap, p.userId), marginRight: 8 }} />{p.username}</td>
            <td className="text-2">{fmt === 'br_countries' ? (p.guess ? `${p.correct ? '✅' : '❌'} ${p.countryName ?? 'Sea'}` : '⏱ No answer') : p.guess ? formatDistance(p.distanceKm, st.units) : '⏱ No guess'}</td>
            {fmt !== 'br_countries' && <td className="num">{fmtInt(p.score)}</td>}
            {(fmt === 'duel' || fmt === 'teamduel') && <td className="num" style={{ color: p.damage ? 'var(--danger)' : undefined }}>{p.damage ? `−${fmtInt(p.damage)}` : '—'}</td>}
            {fmt === 'br_countries' && <td className="lives">{'♥'.repeat(Math.max(0, p.livesAfter ?? 0))}</td>}
            {fmt.startsWith('br_') && <td>{p.eliminated ? <span className="chip danger">Eliminated</span> : null}</td>}
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function Reveal(c: Ctx) {
  const { snap, now, toast, me } = c;
  useTick(true, 250);
  const res = snap.lastResult!;
  const left = snap.revealEndsAt ? snap.revealEndsAt - now() : 0;
  const waiting = snap.members.filter((m) => !m.spectator && m.alive && !m.forfeited && m.connected && !m.continueReady).length;
  const pairs = [{ answer: { lat: res.answer.lat, lng: res.answer.lng, label: `${flag(res.answer.country)} ${res.answer.countryName}` },
    guesses: res.players.filter((p) => p.guess).map((p) => ({ ...p.guess!, color: colorFor(snap, p.userId), label: p.username })) }];
  return (
    <div className="result-screen fade-in" data-testid="mp-reveal">
      <div className="result-map"><ResultMap pairs={pairs} /></div>
      <div className="result-panel" style={{ alignItems: 'stretch' }}>
        <div className="col grow" style={{ maxWidth: 720, gap: 8 }}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>Round {res.number}: {flag(res.answer.country)} {res.answer.countryName}{res.multiplier > 1 ? <span className="chip gold" style={{ marginLeft: 8 }}>×{res.multiplier} damage</span> : null}</h2>
            <StatusBars snap={snap} />
          </div>
          {res.note && <div className="callout info">{res.note}</div>}
          {res.teams && <div className="row">{res.teams.map((t) => <span key={t.team} className="chip" style={{ borderColor: TEAM_COLORS[t.team] }}>Team {t.team === 0 ? 'Blue' : 'Orange'} best: {fmtInt(t.score)}{t.damage ? ` · −${fmtInt(t.damage)}` : ''}</span>)}</div>}
          <RoundTable snap={snap} result={res} />
        </div>
        <div className="col" style={{ justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          {me && !me.spectator && me.alive && !me.forfeited
            ? <button className="btn primary lg" disabled={me.continueReady} onClick={() => act(toast, 'room:continue')} data-testid="continue-btn">{me.continueReady ? 'Waiting…' : 'Continue'}</button>
            : <span className="muted">{me && !me.alive ? 'You are out — keep watching!' : 'Spectating'}</span>}
          <span className="muted small">Next round in {fmtClock(left)}{waiting ? ` · waiting for ${waiting}` : ''}</span>
        </div>
      </div>
    </div>
  );
}

function Finished(c: Ctx) {
  const { snap, toast } = c;
  const fin = snap.final;
  const isHost = snap.hostId === snap.you;
  const { settings: st } = useApp();
  if (!fin) return <div className="main"><Loading /></div>;
  const mine = fin.placements.find((p) => p.userId === snap.you);
  const headline = !mine ? 'Game over' : mine.outcome === 'win' ? (snap.settings.format.startsWith('br_') ? 'Winner winner! 👑' : 'You win! 🎉') : mine.outcome === 'draw' ? 'It’s a draw' : `You placed #${mine.placement}`;
  const reason = { completed: 'All rounds played.', health: 'Health ran out.', elimination: 'Last one standing.', forfeit: 'Won by forfeit.', round_cap: 'Round limit reached.', pool_exhausted: 'Ran out of locations on this map.' }[fin.reason];
  const sorted = [...fin.placements].sort((a, b) => a.placement - b.placement);
  return (
    <main className="main fade-in" data-testid="mp-finished">
      <div className="page-head">
        <div><span className="chip">{FORMAT_INFO[snap.settings.format].name} · {snap.map?.name}</span><h1 style={{ marginTop: 8 }} data-testid="mp-headline">{headline}</h1><p>{reason}{fin.winnerTeam !== null ? ` Team ${fin.winnerTeam === 0 ? 'Blue' : 'Orange'} wins.` : ''}</p></div>
        <div className="row">
          {isHost ? <button className="btn primary" onClick={() => act(toast, 'room:rematch')} data-testid="rematch-btn">Rematch (back to lobby)</button> : <span className="muted">The host can start a rematch.</span>}
          <button className="btn ghost" onClick={c.leave}>Leave room</button>
        </div>
      </div>
      <div className="grid cols-2">
        <section className="card">
          <h3>Final standings</h3>
          <table className="table"><tbody>
            {sorted.map((p) => (
              <tr key={p.userId} className={p.userId === snap.you ? 'you' : ''}>
                <td className={`rank r${p.placement}`}>#{p.placement}</td>
                <td><span className="dot" style={{ background: colorFor(snap, p.userId), marginRight: 8 }} />{p.username}{p.forfeited ? <span className="chip" style={{ marginLeft: 6 }}>left</span> : null}</td>
                <td><span className={`chip ${p.outcome === 'win' ? 'teal' : p.outcome === 'draw' ? 'gold' : ''}`}>{p.outcome}</span></td>
                <td className="num" style={{ textAlign: 'right' }}>{snap.settings.format === 'br_countries' ? `${p.totalScore} correct` : fmtInt(p.totalScore)}</td>
              </tr>
            ))}
          </tbody></table>
        </section>
        <section className="card">
          <h3>Rounds</h3>
          <div className="table-wrap"><table className="table"><tbody>
            {snap.history.map((h) => {
              const myRes = h.players.find((p) => p.userId === snap.you);
              return (
                <tr key={h.idx}><td className="rank">{h.number}</td><td>{flag(h.answer.country)} {h.answer.countryName}{h.multiplier > 1 ? <span className="muted small"> ×{h.multiplier}</span> : null}</td>
                  <td className="text-2">{myRes ? (myRes.distanceKm !== null ? formatDistance(myRes.distanceKm, st.units) : 'no guess') : ''}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{myRes && snap.settings.format !== 'br_countries' ? fmtInt(myRes.score) : myRes?.correct ? '✅' : myRes ? '❌' : ''}</td></tr>
              );
            })}
          </tbody></table></div>
        </section>
      </div>
      <div className="section" style={{ position: 'relative', height: 360, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <ResultMap pairs={snap.history.map((h) => ({ answer: { lat: h.answer.lat, lng: h.answer.lng, label: `Round ${h.number}` }, guesses: [] }))} />
      </div>
      <div className="section"><Chat c={c} /></div>
    </main>
  );
}
