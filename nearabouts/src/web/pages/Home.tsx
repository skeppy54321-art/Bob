import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useApp } from '../lib/store.tsx';
import { startGame } from '../lib/game.ts';
import { errorMessage } from '../lib/api.ts';
import { MODE_ICONS } from './Modes.tsx';

export default function Home() {
  const { user, config, toast } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const quick = async () => {
    setBusy(true);
    try { nav(`/play/${await startGame({ mode: 'quick' })}`); } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="stack-lg">
      <section className="hero">
        <span className="chip accent">Where on Earth are you?</span>
        <h1 style={{ marginTop: 14 }}>Drop in somewhere. Guess where.</h1>
        <p className="lead">Look around a street-level scene, read the clues — the road paint, the side people drive on, the sun, the plants — then pin your guess on the map. Closer means more points.</p>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn primary lg" onClick={quick} disabled={busy} data-testid="quick-play">{busy ? 'Starting…' : 'Quick play'}</button>
          <Link className="btn lg" to="/rooms">Play with friends</Link>
          <Link className="btn lg ghost" to="/daily">Today’s daily →</Link>
        </div>
        {config!.demo && (
          <p className="callout warn" style={{ marginTop: 18, maxWidth: 680 }}>
            <b>Demo mode.</b> No street-imagery provider is connected yet, so rounds use illustrated scenes drawn by Nearabouts (not photographs).
            The whole game — scoring, rooms, streaks — works; real imagery appears once the site owner adds a Mapillary token. <Link to="/about#imagery">Learn more</Link>
          </p>
        )}
      </section>

      <section className="grid cols-4">
        {[
          { to: '/play', icon: MODE_ICONS.classic, t: 'Classic & streaks', d: 'Five rounds, country streaks, US states.' },
          { to: '/explorer', icon: MODE_ICONS.explorer, t: 'Explorer', d: 'Collect medals country by country.' },
          { to: '/rooms', icon: MODE_ICONS.duel, t: 'Duels & Battle Royale', d: 'Private rooms for up to 10 friends.' },
          { to: '/maps', icon: '🗺️', t: 'Maps', d: 'Browse maps or build your own.' },
        ].map((c) => (
          <Link key={c.to} to={c.to} className="card hover mode-card">
            <span className="mode-icon" aria-hidden>{c.icon}</span><h3>{c.t}</h3><p>{c.d}</p>
          </Link>
        ))}
      </section>

      {user!.guest && (
        <section className="card row between">
          <div><h3>Playing as {user!.username}</h3><p className="muted" style={{ margin: 0 }}>Create a free account to keep your stats, add friends, appear on leaderboards and make maps. Your progress so far comes with you.</p></div>
          <Link className="btn primary" to="/signup">Create account</Link>
        </section>
      )}
    </div>
  );
}
