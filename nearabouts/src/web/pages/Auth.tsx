import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { resetSocket } from '../lib/socket.ts';
import { useApp } from '../lib/store.tsx';
import type { Me } from '../lib/types.ts';
import './account.css';

const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function Auth({ mode }: { mode: 'login' | 'signup' }) {
  const { user, setUser, refreshUser, toast } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';
  const signup = mode === 'signup';
  const suffix = rawNext ? `?next=${encodeURIComponent(next)}` : '';

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);

  if (user && !user.guest) {
    return (
      <div className="auth-wrap">
        <div className="card pad-lg">
          <h1 style={{ fontSize: '1.6rem' }}>You’re signed in as {user.username}</h1>
          <p className="text-2">To {signup ? 'create another account' : 'switch accounts'}, log out first from Settings.</p>
          <div className="row">
            <Link className="btn primary" to="/">Home</Link>
            <Link className="btn" to={`/u/${encodeURIComponent(user.username)}`}>My profile</Link>
            <Link className="btn ghost" to="/settings">Settings</Link>
          </div>
        </div>
      </div>
    );
  }

  const errors: Record<string, string> = {};
  if (signup) {
    if (!USERNAME_RE.test(username)) errors.username = 'Use 3–20 letters, numbers, _ or -.';
    else if (/^guest/i.test(username)) errors.username = 'Usernames starting with “guest” are reserved.';
    if (email.trim() && !EMAIL_RE.test(email.trim())) errors.email = 'That email address looks wrong.';
    if (password.length < 8) errors.password = 'Use at least 8 characters.';
    if (confirm !== password) errors.confirm = 'The passwords don’t match.';
  } else {
    if (!username.trim()) errors.username = 'Enter your username or email.';
    if (!password) errors.password = 'Enter your password.';
  }
  const show = (k: string) => (submitted || touched[k]) && errors[k];
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true); setServerErr(null);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const res = signup
        ? await api<{ user: Me }>('/api/auth/register', { body: { username, email: email.trim() || undefined, password } })
        : await api<{ user: Me }>('/api/auth/login', { body: { username: username.trim(), password } });
      resetSocket(); // the session cookie changed
      setUser(res.user);
      refreshUser().catch(() => {}); // also pulls this account’s saved settings
      toast(signup ? `Welcome to Nearabouts, ${res.user.username}!` : `Welcome back, ${res.user.username}!`, 'success');
      nav(next, { replace: true });
    } catch (err) {
      setServerErr(errorMessage(err));
      setBusy(false);
    }
  };

  const field = (k: string, id: string) => ({ id, 'aria-invalid': !!show(k), 'aria-describedby': show(k) ? `${id}-err` : undefined, onBlur: blur(k) });
  const err = (k: string, id: string) => show(k) ? <span className="field-err" id={`${id}-err`} role="alert">{errors[k]}</span> : null;

  return (
    <div className="auth-wrap">
      <div className="card pad-lg">
        <h1 style={{ fontSize: '1.8rem' }}>{signup ? 'Create your account' : 'Log in'}</h1>
        {signup ? (
          <p className="text-2">{user?.guest
            ? <>You’re playing as <b>{user.username}</b>. Your games, stats and XP will carry over to your new account.</>
            : <>Free, and takes ten seconds. If you’ve already played as a guest in this browser, your games and stats carry over.</>}</p>
        ) : (
          <p className="text-2">Welcome back. {user?.guest && <span className="muted">Logging in switches you away from your current guest session.</span>}</p>
        )}
        <form onSubmit={submit} noValidate>
          <label className="field" htmlFor="au-user">{signup ? 'Username' : 'Username or email'}
            <input className="input" type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={signup ? 20 : 200} autoFocus {...field('username', 'au-user')} />
            {signup && !show('username') && <span className="hint">3–20 letters, numbers, _ or -</span>}
            {err('username', 'au-user')}
          </label>
          {signup && (
            <label className="field" htmlFor="au-email">Email <span className="hint">(optional — lets you log in with it)</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" {...field('email', 'au-email')} />
              {err('email', 'au-email')}
            </label>
          )}
          <label className="field" htmlFor="au-pw">Password
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} {...field('password', 'au-pw')} />
            {signup && !show('password') && <span className="hint">At least 8 characters</span>}
            {err('password', 'au-pw')}
          </label>
          {signup && (
            <label className="field" htmlFor="au-pw2">Confirm password
              <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" {...field('confirm', 'au-pw2')} />
              {err('confirm', 'au-pw2')}
            </label>
          )}
          {serverErr && <div className="callout danger" role="alert">{serverErr}</div>}
          <button className="btn primary lg block" type="submit" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}</button>
        </form>
        <hr className="divider" />
        <p className="small muted" style={{ margin: 0 }}>
          {signup ? <>Already have an account? <Link to={`/login${suffix}`}>Log in</Link></> : <>New here? <Link to={`/signup${suffix}`}>Create an account</Link> — or just <Link to="/play">play as a guest</Link>.</>}
        </p>
        {signup && <p className="small muted" style={{ margin: '8px 0 0' }}>We store your username, optional email and a hashed password. See <Link to="/about#privacy">privacy</Link>.</p>}
      </div>
    </div>
  );
}
