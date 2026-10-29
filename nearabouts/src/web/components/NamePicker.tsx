import { useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { Avatar } from './Avatar.tsx';
import { Logo } from './Logo.tsx';
import type { AvatarConfig, Me } from '../lib/types.ts';

const rnd = (n: number) => Math.floor(Math.random() * n);
export const randomAvatar = (): AvatarConfig => ({ shape: rnd(6), hue: rnd(360), accent: rnd(360), face: rnd(6), pattern: rnd(5) });
const NAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

/** Name + random avatar form. Used on first visit and in Settings. */
export function NameForm({ submitLabel, onDone }: { submitLabel: string; onDone?: (u: Me) => void }) {
  const { user, setUser } = useApp();
  const [name, setName] = useState(user!.guest ? '' : user!.username);
  const [avatar, setAvatar] = useState<AvatarConfig>(user!.avatar);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!NAME_RE.test(n)) { setErr('Use 3–20 letters, numbers, _ or -.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api<{ user: Me }>('/api/me', { method: 'PATCH', body: { username: n, avatar } });
      setUser(r.user);
      onDone?.(r.user);
    } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
  };
  return (
    <form className="col" style={{ gap: 14 }} onSubmit={submit} noValidate>
      <div className="row" style={{ gap: 16 }}>
        <Avatar avatar={avatar} size={84} title="Your avatar" />
        <button type="button" className="btn" onClick={() => setAvatar(randomAvatar())} data-testid="reroll-avatar">🎲 New random avatar</button>
      </div>
      <label className="field">Player name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus autoComplete="nickname"
          placeholder="e.g. MapWizard" aria-describedby="name-hint" data-testid="name-input" />
        <span className="hint" id="name-hint">3–20 letters, numbers, _ or -. Other players see this name.</span>
      </label>
      {err && <div className="error-text" role="alert">{err}</div>}
      <button className="btn primary lg" type="submit" disabled={busy || !name.trim()} data-testid="name-submit">{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

/** Full-page welcome shown until the visitor picks a name. */
export function NameGate() {
  return (
    <main className="main" style={{ maxWidth: 520, paddingTop: '8vh' }}>
      <div className="card pad-lg fade-in">
        <div className="row" style={{ marginBottom: 10 }}><Logo size={34} /><h1 style={{ margin: 0, fontSize: '1.8rem' }}>Welcome to Nearabouts</h1></div>
        <p className="text-2">Pick a name and you’re in. No sign-up needed — this browser remembers you.</p>
        <NameForm submitLabel="Let’s play" />
      </div>
    </main>
  );
}
