import { Link, useLocation } from 'react-router-dom';
import './account.css';

export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="center-state" style={{ paddingTop: 70 }}>
      <div className="not-found-art" aria-hidden>🧭</div>
      <h1 style={{ fontSize: '2rem' }}>You’re off the map</h1>
      <p className="muted" style={{ maxWidth: '44ch', overflowWrap: 'anywhere' }}>We couldn’t find a page at <span className="mono">{pathname}</span>. Let’s get you back somewhere familiar.</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn primary" to="/">Go home</Link>
        <Link className="btn" to="/play">Play a game</Link>
        <Link className="btn ghost" to="/about">How to play</Link>
      </div>
    </div>
  );
}
