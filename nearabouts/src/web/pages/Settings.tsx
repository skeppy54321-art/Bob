import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Segmented, Switch } from '../components/ui.tsx';
import { NameForm } from '../components/NamePicker.tsx';
import type { AvatarConfig, Me, MapStyle } from '../lib/types.ts';
import { availableStyles } from '../lib/leaflet.ts';
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

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Settings</h1><p>Preferences apply immediately and are saved for you on this site.</p></div>
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
              <div className="lbl">Guess map style<small>You can also switch with the buttons in the corner of any map. Hard difficulty hides labels and the street map.</small></div>
              <Segmented<MapStyle> label="Guess map style" value={settings.mapStyle} onChange={(mapStyle) => updateSettings({ mapStyle })}
                options={availableStyles(config).map((v) => ({ value: v, label: v === 'satellite' ? 'Satellite' : v === 'streets' ? 'Street map' : 'Borders only' }))} />
            </div>
          </section>

          <AvatarEditor me={me} onSaved={(u) => { setUser(u); toast('Avatar saved', 'success'); }} />
          <BioEditor me={me} onSaved={(u) => { setUser(u); toast('Bio saved', 'success'); }} />
        </div>

        <div className="col" style={{ gap: 16 }}>
          <section className="card" aria-labelledby="acct-h">
            <h3 id="acct-h">Your name</h3>
            <p className="muted small">No sign-up needed: this browser remembers you. Clearing cookies or switching browsers starts a new player.</p>
            <NameForm submitLabel="Save name and avatar" onDone={() => toast('Saved', 'success')} />
            <div className="setting-row" style={{ marginTop: 12 }}><div className="lbl">Playing since</div><span>{new Date(me.createdAt).toLocaleDateString()}</span></div>
          </section>

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
