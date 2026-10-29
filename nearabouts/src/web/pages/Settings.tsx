import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { resetSocket } from '../lib/socket.ts';
import { useApp } from '../lib/store.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Segmented, Switch } from '../components/ui.tsx';
import type { AvatarConfig, Me } from '../lib/types.ts';
import './account.css';

const FULL = (a: AvatarConfig | undefined): Required<AvatarConfig> => ({ shape: 0, hue: 200, accent: 30, face: 0, pattern: 0, ...(a ?? {}) } as Required<AvatarConfig>);
const SHAPE_NAMES = ['Blob', 'Gem', 'Egg', 'Tile', 'Flame', 'Disc'];
const FACE_NAMES = ['Happy', 'Cool', 'Wink-eyed', 'Joyful', 'Visor', 'Curious'];
const PATTERN_NAMES = ['Plain', 'Stripes', 'Dots', 'Slope', 'Sun'];
const rnd = (n: number) => Math.floor(Math.random() * n);

const SHORTCUTS: [string[], string][] = [
  [['←', '→', '↑', '↓'], 'Look around'],
  [['W'], 'Travel forward'],
  [['S'], 'Travel back'],
  [['+', '−'], 'Zoom in / out'],
  [['N'], 'Face north'],
  [['R'], 'Return to start'],
  [['Space', 'Enter'], 'Place your guess'],
  [['M'], 'Change map size'],
  [['F'], 'Fullscreen'],
  [['?'], 'Show help'],
];

export default function Settings() {
  const { user, config, settings, updateSettings, setUser, toast } = useApp();
  const me = user!;
  const guest = me.guest;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Settings</h1><p>Preferences apply immediately{guest ? ' and are saved to this browser.' : ' and follow your account.'}</p></div>
        <Link className="btn" to={`/u/${encodeURIComponent(me.username)}`}>View my profile</Link>
      </div>

      <div className="settings-grid">
        <div className="col" style={{ gap: 16 }}>
          <section className="card" aria-labelledby="prefs-h">
            <h3 id="prefs-h">Preferences</h3>
            <div className="setting-row">
              <div className="lbl" id="units-l">Distance units<small>Used for results, profiles and stats.</small></div>
              <Segmented<'km' | 'mi'> label="Distance units" value={settings.units} onChange={(units) => updateSettings({ units })} options={[{ value: 'km', label: 'Kilometres' }, { value: 'mi', label: 'Miles' }]} />
            </div>
            <div className="setting-row">
              <div className="lbl">Reduced motion<small>Turns off animations. Nearabouts also follows your operating system’s “reduce motion” setting.</small></div>
              <Switch checked={settings.reducedMotion} onChange={(reducedMotion) => updateSettings({ reducedMotion })} label={settings.reducedMotion ? 'On' : 'Off'} />
            </div>
            <div className="setting-row">
              <div className="lbl">
                Guess map style
                <small>
                  {config?.tiles
                    ? 'Auto uses street tiles when you zoom in; Vector always shows the built-in border map.'
                    : 'This site uses the built-in border map. The site owner can configure a street tile server to offer more detail.'}
                </small>
              </div>
              {config?.tiles ? (
                <Segmented<'auto' | 'vector' | 'tiles'> label="Guess map style" value={settings.mapStyle} onChange={(mapStyle) => updateSettings({ mapStyle })} options={[
                  { value: 'auto', label: 'Auto', title: 'Borders when zoomed out, street tiles when zoomed in' },
                  { value: 'vector', label: 'Borders only', title: 'Built-in border map' },
                  { value: 'tiles', label: 'Street tiles', title: 'Always use the street tile server' },
                ]} />
              ) : (
                <Segmented<'auto' | 'vector' | 'tiles'> label="Guess map style" value="vector" onChange={() => {}} options={[{ value: 'vector', label: 'Border map' }]} />
              )}
            </div>
          </section>

          <AvatarEditor me={me} onSaved={(u) => { setUser(u); toast('Avatar saved', 'success'); }} />
          <BioEditor me={me} onSaved={(u) => { setUser(u); toast('Bio saved', 'success'); }} />
        </div>

        <div className="col" style={{ gap: 16 }}>
          <section className="card" aria-labelledby="acct-h">
            <h3 id="acct-h">Account</h3>
            {guest ? (
              <>
                <p className="text-2">You’re playing as a guest (<b>{me.username}</b>). Create a free account to keep your progress on any device, add friends and appear on leaderboards.</p>
                <p className="muted small">Everything you’ve played as a guest — games, stats, XP — carries over to your new account.</p>
                <div className="row"><Link className="btn primary" to="/signup">Create an account</Link><Link className="btn ghost" to="/login">Log in</Link></div>
              </>
            ) : (
              <>
                <div className="setting-row"><div className="lbl">Username</div><span>{me.username}</span></div>
                <div className="setting-row"><div className="lbl">Email</div><span>{me.email ?? <span className="muted">Not set</span>}</span></div>
                <div className="setting-row"><div className="lbl">Member since</div><span>{new Date(me.createdAt).toLocaleDateString()}</span></div>
                <div style={{ marginTop: 12 }}><LogoutButton /></div>
              </>
            )}
          </section>

          {!guest && <PasswordForm />}

          <section className="card" aria-labelledby="kbd-h">
            <h3 id="kbd-h">Keyboard shortcuts</h3>
            <p className="muted small">While playing. Shortcuts are paused while you type in a text box.</p>
            <div className="kbd-grid">
              {SHORTCUTS.map(([keys, label]) => (
                <div key={label}><span className="row tight" style={{ gap: 4, minWidth: 92 }}>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>{label}</div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function LogoutButton() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn danger" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await api('/api/auth/logout', { method: 'POST', body: {} }); resetSocket(); window.location.href = '/'; }
      catch (e) { toast(errorMessage(e), 'error'); setBusy(false); }
    }}>{busy ? 'Logging out…' : 'Log out'}</button>
  );
}

function AvatarEditor({ me, onSaved }: { me: Me; onSaved: (u: Me) => void }) {
  const { toast } = useApp();
  const saved = FULL(me.avatar);
  const [a, setA] = useState<Required<AvatarConfig>>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = (Object.keys(a) as (keyof AvatarConfig)[]).some((k) => a[k] !== saved[k]);
  const set = (k: keyof AvatarConfig, v: number) => setA((x) => ({ ...x, [k]: v }));
  const pick = (k: 'shape' | 'face' | 'pattern', label: string, names: string[]) => (
    <div className="col" style={{ gap: 6 }}>
      <span className="small" style={{ fontWeight: 600, color: 'var(--text-2)' }}>{label}</span>
      <Segmented<number> label={label} value={a[k]} onChange={(v) => set(k, v)} options={names.map((n, i) => ({ value: i, label: String(i + 1), title: n }))} />
    </div>
  );
  return (
    <section className="card" aria-labelledby="av-h">
      <h3 id="av-h">Avatar</h3>
      <div className="avatar-editor">
        <div className="preview">
          <Avatar avatar={a} size={96} title="Avatar preview" />
          <button type="button" className="btn sm" onClick={() => setA({ shape: rnd(6), hue: rnd(360), accent: rnd(360), face: rnd(6), pattern: rnd(5) })}>🎲 Randomise</button>
        </div>
        <div className="controls">
          {pick('shape', `Shape — ${SHAPE_NAMES[a.shape]}`, SHAPE_NAMES)}
          {pick('face', `Face — ${FACE_NAMES[a.face]}`, FACE_NAMES)}
          {pick('pattern', `Pattern — ${PATTERN_NAMES[a.pattern]}`, PATTERN_NAMES)}
          <label className="field">Colour
            <input className="hue-range" type="range" min={0} max={359} value={a.hue} onChange={(e) => set('hue', +e.target.value)} aria-label="Colour hue" />
          </label>
          <label className="field">Accent colour
            <input className="hue-range" type="range" min={0} max={359} value={a.accent} onChange={(e) => set('accent', +e.target.value)} aria-label="Accent hue" />
          </label>
        </div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={!dirty || busy} onClick={async () => {
          setBusy(true);
          try { const r = await api<{ user: Me }>('/api/me', { method: 'PATCH', body: { avatar: a } }); onSaved(r.user); }
          catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
        }}>{busy ? 'Saving…' : 'Save avatar'}</button>
        <button className="btn ghost" disabled={!dirty || busy} onClick={() => setA(saved)}>Reset</button>
      </div>
    </section>
  );
}

function BioEditor({ me, onSaved }: { me: Me; onSaved: (u: Me) => void }) {
  const { toast } = useApp();
  const [bio, setBio] = useState(me.bio ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = bio !== (me.bio ?? '');
  return (
    <section className="card" aria-labelledby="bio-h">
      <h3 id="bio-h">Bio</h3>
      <label className="field">
        <span className="sr-only">Bio</span>
        <textarea className="input" value={bio} maxLength={160} rows={3} placeholder="Tell other players a little about yourself." onChange={(e) => setBio(e.target.value)} />
        <span className="hint num" style={{ alignSelf: 'flex-end' }}>{bio.length} / 160</span>
      </label>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" disabled={!dirty || busy} onClick={async () => {
          setBusy(true);
          try { const r = await api<{ user: Me }>('/api/me', { method: 'PATCH', body: { bio: bio.trim() } }); setBio(r.user.bio ?? ''); onSaved(r.user); }
          catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
        }}>{busy ? 'Saving…' : 'Save bio'}</button>
      </div>
    </section>
  );
}

function PasswordForm() {
  const { toast } = useApp();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setErr('New passwords need at least 8 characters.');
    if (pw !== pw2) return setErr('The new passwords don’t match.');
    setBusy(true); setErr(null);
    try {
      await api('/api/me', { method: 'PATCH', body: { currentPassword: cur, password: pw } });
      toast('Password changed', 'success'); setCur(''); setPw(''); setPw2('');
    } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
  };
  return (
    <section className="card" aria-labelledby="pw-h">
      <h3 id="pw-h">Change password</h3>
      <form className="col" onSubmit={submit} noValidate>
        <label className="field">Current password<input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
        <label className="field">New password<input className="input" type="password" autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required /><span className="hint">At least 8 characters.</span></label>
        <label className="field">Confirm new password<input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></label>
        {err && <div className="error-text" role="alert">{err}</div>}
        <div><button className="btn primary" type="submit" disabled={busy || !cur || !pw || !pw2}>{busy ? 'Saving…' : 'Change password'}</button></div>
      </form>
    </section>
  );
}
