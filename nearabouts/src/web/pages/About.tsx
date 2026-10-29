import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MEDAL_THRESHOLDS, MAX_ROUND_SCORE, WORLD_SCALE_KM, scoreFromDistance, perfectRadiusKm } from '../../shared/scoring.ts';
import { MOVEMENT_HELP, MOVEMENT_LABELS, MAX_ROOM_PLAYERS, type Movement } from '../../shared/rules.ts';
import { FORMAT_INFO } from '../../shared/room.ts';
import { xpForLevel } from '../../shared/levels.ts';
import { Medal } from '../components/ui.tsx';
import { fmtInt } from '../lib/format.ts';
import './account.css';

const SECTIONS = [
  ['how', 'How to play'],
  ['scoring', 'Scoring'],
  ['modes', 'Game modes'],
  ['imagery', 'Imagery'],
  ['credits', 'Credits'],
  ['privacy', 'Privacy'],
] as const;

const WORLD_DISTANCES = [1, 10, 100, 500, 1000, 2000, 5000, 10000];
const CITY_DISTANCES = [0.1, 0.5, 1, 3, 10];
const CITY_SCALE = 30;
const kmLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toLocaleString('en-US')} km`);
const fmtRadius = (km: number) => (km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(1)} km`);

function ScoreTable({ rows, scale, caption }: { rows: number[]; scale: number; caption: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col">Distance</th><th scope="col" style={{ textAlign: 'right' }}>Score</th><th scope="col" className="muted">Of 5,000</th></tr></thead>
        <tbody>
          {rows.map((d) => {
            const s = scoreFromDistance(d, scale);
            return (
              <tr key={d}>
                <td className="num">{kmLabel(d)}</td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtInt(s)}</td>
                <td style={{ width: '40%' }}><div className="scorebar" style={{ width: '100%', height: 6 }}><div style={{ width: `${(s / MAX_ROUND_SCORE) * 100}%` }} /></div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function About() {
  const { hash } = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    if (!id) { window.scrollTo({ top: 0 }); return; }
    // Wait a frame so the section exists (lazy route) before scrolling.
    const h = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(h);
  }, [hash]);

  return (
    <div>
      <div className="page-head"><div><h1>About Nearabouts</h1><p>How the game works, how it scores, and where everything comes from.</p></div></div>
      <div className="about-layout">
        <nav className="about-toc" aria-label="On this page">
          {SECTIONS.map(([id, label]) => <Link key={id} to={{ hash: `#${id}` }} className={hash === `#${id}` ? 'active' : ''}>{label}</Link>)}
        </nav>
        <div className="about-body">
          <section id="how">
            <h2>How to play</h2>
            <p>You’re dropped somewhere in the world with nothing but what you can see. Look around, follow the road, read the signs, notice the sun and the vegetation — then place a pin on the map where you think you are. The closer your pin, the more points you score.</p>
            <ul>
              <li>A classic game is <b>5 rounds</b>, up to {fmtInt(MAX_ROUND_SCORE)} points each: a perfect game is {fmtInt(MAX_ROUND_SCORE * 5)}.</li>
              <li>Open the guess map in the corner, click to drop your pin (you can move it), then press <b>Guess</b>.</li>
              <li>Some games have a time limit. If the clock runs out before you guess, the round scores 0.</li>
              <li>No sign-up: pick a player name the first time you visit and you get a random avatar (change both any time in Settings). This browser remembers you.</li>
            </ul>
            <h3>Controls</h3>
            <div className="grid cols-2">
              <div className="card flat">
                <div className="kbd-grid" style={{ gridTemplateColumns: '1fr' }}>
                  <div><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> Look around</div>
                  <div><kbd>W</kbd><kbd>S</kbd> Travel forward / back</div>
                  <div><kbd>+</kbd><kbd>−</kbd> Zoom in / out</div>
                  <div><kbd>N</kbd> Face north &nbsp; <kbd>R</kbd> Return to start</div>
                </div>
              </div>
              <div className="card flat">
                <div className="kbd-grid" style={{ gridTemplateColumns: '1fr' }}>
                  <div><kbd>Space</kbd><kbd>Enter</kbd> Place your guess</div>
                  <div><kbd>M</kbd> Change map size &nbsp; <kbd>F</kbd> Fullscreen</div>
                  <div><kbd>?</kbd> Show help in a game</div>
                  <div className="muted small">On touch screens: drag to look, tap the arrows to travel, pinch to zoom.</div>
                </div>
              </div>
            </div>
          </section>

          <section id="scoring">
            <h2>Scoring</h2>
            <p>Every round is scored from the great-circle distance <i>d</i> between your pin and the real spot:</p>
            <div className="formula" role="math" aria-label="score equals 5000 times e to the power of minus 9 times d minus r0 over S">score = 5000 · e^(−9 · (d − r₀) / S)</div>
            <ul>
              <li><b>S</b> is the map’s scale: {fmtInt(WORLD_SCALE_KM)} km for the World map. Smaller maps (a country, a city) use their own size, so a guess 5 km off is judged very differently in a city than across the planet.</li>
              <li><b>r₀</b> is the “perfect radius”, S × 0.0002 — about {fmtRadius(perfectRadiusKm(WORLD_SCALE_KM))} on the World map. Land inside it and you get the full {fmtInt(MAX_ROUND_SCORE)}.</li>
              <li>Five rounds therefore cap at <b>{fmtInt(MAX_ROUND_SCORE * 5)}</b> points.</li>
            </ul>
            <div className="grid cols-2">
              <div>
                <h3>World map <span className="muted small">(S = {fmtInt(WORLD_SCALE_KM)} km)</span></h3>
                <ScoreTable rows={WORLD_DISTANCES} scale={WORLD_SCALE_KM} caption="Score by distance on the World map" />
              </div>
              <div>
                <h3>A {CITY_SCALE} km city map <span className="muted small">(r₀ = {fmtRadius(perfectRadiusKm(CITY_SCALE))})</span></h3>
                <ScoreTable rows={CITY_DISTANCES} scale={CITY_SCALE} caption="Score by distance on a 30 kilometre city map" />
              </div>
            </div>
          </section>

          <section id="modes">
            <h2>Game modes</h2>
            <h3>Movement rules</h3>
            <p>Most games let you choose how much you can move:</p>
            <ul>
              {(Object.keys(MOVEMENT_LABELS) as Movement[]).map((m) => <li key={m}><b>{MOVEMENT_LABELS[m]}</b> — {MOVEMENT_HELP[m]}</li>)}
            </ul>

            <h3>Solo modes</h3>
            <ul>
              <li><b>Classic</b> — five rounds on any map, with the movement and time rules you pick. <Link to="/maps">Browse maps</Link>.</li>
              <li><b>Quick play</b> — three World rounds, 60 seconds each.</li>
              <li><b>Daily challenge</b> — the same five places for everyone, <b>Moving</b>, <b>3 minutes</b> per round, <b>one attempt per day</b>. A new challenge starts at 00:00 UTC. Play on consecutive days to build a daily streak. <Link to="/daily">Play today’s</Link>.</li>
              <li><b>Country streak / US state streak</b> — click inside the right country (or state). Every correct answer extends your streak by one; one wrong answer or a timeout ends the run. Your score is the length of the streak.</li>
              <li><b>Explorer</b> — play a single country and earn a medal for your 5-round score:
                <span className="row" style={{ margin: '8px 0 2px', gap: 16 }}>
                  {(Object.keys(MEDAL_THRESHOLDS) as (keyof typeof MEDAL_THRESHOLDS)[]).map((m) => (
                    <span key={m} className="row tight"><Medal medal={m} /><span style={{ textTransform: 'capitalize' }}>{m}</span> <span className="num muted">{fmtInt(MEDAL_THRESHOLDS[m])}+</span></span>
                  ))}
                </span>
              </li>
              <li><b>Challenge a friend</b> — after a game, share a link so others play your exact locations and rules.</li>
            </ul>

            <h3>Multiplayer</h3>
            <p>Multiplayer runs in private rooms of up to <b>{MAX_ROOM_PLAYERS} players</b>: create a room from <Link to="/rooms">With friends</Link>, share the code or invite friends. If a player disconnects mid-match they have a <b>45 second</b> grace period to come back; after that they leave the match and count as a forfeit.</p>
            <div className="grid cols-2">
              {Object.entries(FORMAT_INFO).map(([id, f]) => (
                <div className="card flat" key={id}>
                  <div className="row between"><h3 style={{ margin: 0 }}>{f.name}</h3><span className="chip">{f.min === f.max ? `${f.min} players` : `${f.min}–${f.max} players`}</span></div>
                  <p style={{ margin: '6px 0' }}>{f.summary}</p>
                  <ul style={{ marginBottom: 0 }}>{f.rules.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              ))}
            </div>

            <h3>XP and levels</h3>
            <p>Finishing games earns XP: about 10 per game plus 1 for every 250 points scored (the daily challenge adds a bonus, and every correct streak answer is worth 8). Multiplayer matches pay out more for wins. XP builds your level — reaching level <i>L</i> takes 100 · (<i>L</i>−1)<sup>1.6</sup> XP in total:</p>
            <div className="row" style={{ gap: 8 }}>
              {[2, 5, 10, 20, 30].map((l) => <span className="chip" key={l}>Lv {l} · {fmtInt(xpForLevel(l))} XP</span>)}
            </div>
            <p style={{ marginTop: 10 }}>Along the way you can unlock achievements, shown on your profile page.</p>
          </section>

          <section id="imagery">
            <h2>Imagery</h2>
            <p><b>Demo mode.</b> When no street-level provider is configured, Nearabouts shows <i>illustrated procedural scenes</i> — drawn by the game, not photographs — so the whole game can be played anywhere. Demo games carry a “Demo scenes” badge.</p>
            <p><b>Live mode.</b> With a provider configured, rounds use <a href="https://www.mapillary.com" target="_blank" rel="noreferrer noopener">Mapillary</a> community-contributed street-level imagery, licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer noopener">CC BY-SA 4.0</a>. The photographer’s attribution is shown in the corner of the view during the game.</p>
            <div className="callout warn">
              <b>Not cheat-proof.</b> The imagery viewer necessarily loads image data in your browser, so a determined player could find a location with developer tools. Nearabouts can’t prevent that. What the server does guarantee: guesses, scores and timers are all checked on the server, so nobody can submit a fake score or extend the clock.
            </div>
          </section>

          <section id="credits">
            <h2>Credits</h2>
            <ul>
              <li><b>Boundaries</b> — <a href="https://www.naturalearthdata.com" target="_blank" rel="noreferrer noopener">Natural Earth</a> (public domain), via the <code>world-atlas</code> and <code>us-atlas</code> packages.</li>
              <li><b>Country metadata</b> — the <code>world-countries</code> dataset.</li>
              <li><b>Maps</b> — <a href="https://leafletjs.com" target="_blank" rel="noreferrer noopener">Leaflet</a>.</li>
              <li><b>Street-level viewer</b> — <a href="https://github.com/mapillary/mapillary-js" target="_blank" rel="noreferrer noopener">MapillaryJS</a>, used in live mode.</li>
              <li><b>Satellite imagery</b> — <a href="https://s2maps.eu" target="_blank" rel="noreferrer noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data), unless the site owner configured another provider.</li>
              <li><b>Street map &amp; labels</b> — © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap contributors</a>, © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer noopener">CARTO</a>. Each map shows its current credits in the corner.</li>
              <li><b>Everything else</b> — including the demo scenes, avatars and the logo — is original Nearabouts code.</li>
            </ul>
          </section>

          <section id="privacy">
            <h2>Privacy</h2>
            <p>Nearabouts keeps what it needs to run the game and nothing else.</p>
            <ul>
              <li><b>Stored:</b> the player name you picked, your avatar and bio, your game and match history, and your friends and blocked players. No email addresses or passwords are ever collected.</li>
              <li><b>Cookies:</b> one cookie identifies your browser so you stay the same player. Clearing cookies or switching browsers starts a new player. Preferences like units are also saved in your browser.</li>
              <li><b>No ads, no third-party trackers.</b></li>
              <li><b>Chat:</b> room chat messages are kept only in memory while the room exists and are never written to the database.</li>
              <li>Other players can see your username, avatar, level, bio and public stats on your profile.</li>
            </ul>
            <p>Questions or want something removed? Contact whoever runs this Nearabouts site.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
