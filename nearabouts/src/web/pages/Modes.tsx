import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/store.tsx';
import { startGame } from '../lib/game.ts';
import { errorMessage } from '../lib/api.ts';
import { RulesForm } from '../components/RulesForm.tsx';
import { Modal } from '../components/ui.tsx';
import { DEFAULT_RULES, type GameRules } from '../../shared/rules.ts';

export const MODE_ICONS: Record<string, string> = {
  classic: '🌍', quick: '⚡', daily: '📅', streak_country: '🔥', streak_state: '🇺🇸', explorer: '🧭', challenge: '🔗',
  duel: '⚔️', teamduel: '🤝', br_countries: '👑', br_distance: '🎯', party: '🎉',
};

export default function Modes() {
  const { config, toast } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [streak, setStreak] = useState<null | 'streak_country' | 'streak_state'>(null);
  const [rules, setRules] = useState<GameRules>({ ...DEFAULT_RULES, timeLimit: 60 });

  const go = async (mode: string, extra: Record<string, unknown> = {}) => {
    setBusy(mode);
    try { nav(`/play/${await startGame({ mode, ...extra })}`); }
    catch (e) { toast(errorMessage(e), 'error'); }
    finally { setBusy(null); }
  };

  const solo = [
    { id: 'quick', title: 'Quick play', text: '3 rounds · World · 60 s each. Jump straight in.', action: () => go('quick') },
    { id: 'classic', title: 'Classic', text: 'Pick a map and your rules — 5 rounds, up to 25,000 points.', action: () => nav('/maps') },
    { id: 'daily', title: 'Daily challenge', text: 'Same five places for everyone today. Keep your streak alive.', action: () => nav('/daily') },
    { id: 'streak_country', title: 'Country streak', text: 'Click anywhere in the right country. One miss ends the run.', action: () => setStreak('streak_country') },
    { id: 'streak_state', title: 'US state streak', text: 'Name the US state. How long can you last?', action: () => setStreak('streak_state') },
    { id: 'explorer', title: 'Explorer', text: 'Earn bronze to platinum medals country by country.', action: () => nav('/explorer') },
  ];
  const multi = config!.modes.filter((m) => !m.solo);

  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Choose a mode</h1><p>Solo games run on your own. Multiplayer modes run in a private room with friends (up to {config!.maxRoomPlayers}).</p></div></div>
      <section>
        <h2>Solo</h2>
        <div className="grid cols-3">
          {solo.map((m) => (
            <button key={m.id} className="card hover mode-card" onClick={m.action} disabled={!!busy} data-testid={`mode-${m.id}`}>
              <span className="mode-icon" aria-hidden>{MODE_ICONS[m.id]}</span>
              <h3>{m.title}{busy === m.id ? '…' : ''}</h3>
              <p>{m.text}</p>
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className="row between"><h2>With friends</h2><Link className="btn sm" to="/rooms">Create or join a room →</Link></div>
        <div className="grid cols-3">
          {multi.map((m) => (
            <Link key={m.id} to={`/rooms?format=${m.id}`} className="card hover mode-card">
              <span className="mode-icon" aria-hidden>{MODE_ICONS[m.id]}</span>
              <h3>{m.name}</h3>
              <p>{m.blurb}</p>
            </Link>
          ))}
          <Link to="/maps" className="card hover mode-card">
            <span className="mode-icon" aria-hidden>{MODE_ICONS.challenge}</span>
            <h3>Challenge link</h3>
            <p>Play any map, then share a link so friends get your exact locations and rules.</p>
          </Link>
        </div>
      </section>

      {streak && (
        <Modal title={streak === 'streak_state' ? 'US state streak' : 'Country streak'} onClose={() => setStreak(null)}>
          <p className="text-2">Each round, place your pin anywhere inside the {streak === 'streak_state' ? 'state' : 'country'} you think you’re in. A wrong answer or running out of time ends the streak.</p>
          <RulesForm value={rules} onChange={setRules} hide={['rounds']} />
          <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setStreak(null)}>Cancel</button>
            <button className="btn primary" disabled={!!busy} onClick={() => go(streak, { rules })} data-testid="start-streak">Start streak</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
