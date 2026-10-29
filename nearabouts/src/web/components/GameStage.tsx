import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PanoPayload, Movement } from '../lib/types.ts';
import { PanoViewer, type PanoHandle } from './PanoViewer.tsx';
import { GuessMap, type GuessPoint } from './GuessMap.tsx';
import { Modal } from './ui.tsx';
import { allowedActions, MOVEMENT_LABELS } from '../../shared/rules.ts';
import { useHotkeys, useMediaQuery, useTick } from '../lib/hooks.ts';
import { fmtClock } from '../lib/format.ts';

interface Props {
  pano: PanoPayload;
  movement: Movement;
  roundKey: string;
  hud?: ReactNode;
  hudRight?: ReactNode;
  now: () => number;
  startedAt?: number | null;
  deadline?: number | null;
  countdownEndsAt?: number | null;
  onExpire?: () => void;
  onGuess: (p: GuessPoint) => Promise<unknown> | void;
  guessLocked?: boolean;
  lockedLabel?: string;
  guessLabel?: string;
  mapBounds?: [number, number, number, number] | null;
  others?: { lat: number; lng: number; color: string; label: string }[];
  labels?: boolean;
  onPanoError?: (msg: string) => void;
  onExit?: () => void;
  overlay?: ReactNode;
}

const SIZES = { s: [260, 170], m: [380, 270], l: [560, 400] } as const;
type Size = keyof typeof SIZES;

export function GameStage(p: Props) {
  const pano = useRef<PanoHandle>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [guess, setGuess] = useState<GuessPoint | null>(null);
  const [heading, setHeading] = useState(p.pano.heading);
  const [size, setSize] = useState<Size>(() => (localStorage.getItem('nearabouts:mapsize') as Size) || 'm');
  const [pinned, setPinned] = useState(() => localStorage.getItem('nearabouts:mappinned') === '1');
  const [custom, setCustom] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState(false);
  const [mobileMap, setMobileMap] = useState(false);
  const [help, setHelp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fs, setFs] = useState(false);
  const mobile = useMediaQuery('(max-width: 700px)');
  const allowed = allowedActions(p.movement);
  const expired = useRef(false);

  useEffect(() => { setGuess(null); setSubmitting(false); expired.current = false; setMobileMap(false); setHeading(p.pano.heading); }, [p.roundKey, p.pano.heading]);
  useEffect(() => { try { localStorage.setItem('nearabouts:mapsize', size); localStorage.setItem('nearabouts:mappinned', pinned ? '1' : '0'); } catch { /* ignore */ } }, [size, pinned]);
  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const timed = !!(p.deadline || p.countdownEndsAt);
  useTick(timed, 250);
  const end = Math.min(p.deadline ?? Infinity, p.countdownEndsAt ?? Infinity);
  const remaining = timed ? end - p.now() : null;
  useEffect(() => {
    if (remaining !== null && remaining <= -400 && !expired.current) { expired.current = true; p.onExpire?.(); }
  });

  const submit = async () => {
    if (!guess || submitting || p.guessLocked) return;
    setSubmitting(true);
    try { await p.onGuess(guess); } finally { setSubmitting(false); }
  };
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else stage.current?.requestFullscreen?.().catch(() => {});
  };
  const cycleSize = () => setSize((s) => (s === 's' ? 'm' : s === 'm' ? 'l' : 's'));

  useHotkeys({
    ArrowLeft: (e) => { e.preventDefault(); pano.current?.look(-10, 0); },
    ArrowRight: (e) => { e.preventDefault(); pano.current?.look(10, 0); },
    ArrowUp: (e) => { e.preventDefault(); pano.current?.look(0, 6); },
    ArrowDown: (e) => { e.preventDefault(); pano.current?.look(0, -6); },
    w: () => pano.current?.move(1),
    s: () => pano.current?.move(-1),
    '+': () => pano.current?.zoom(0.85), '=': () => pano.current?.zoom(0.85), '-': () => pano.current?.zoom(1.18),
    n: () => pano.current?.faceNorth(),
    r: () => pano.current?.reset(),
    ' ': (e) => { e.preventDefault(); submit(); },
    Enter: () => submit(),
    m: () => (mobile ? setMobileMap((x) => !x) : cycleSize()),
    f: () => toggleFs(),
    '?': () => setHelp(true),
  });

  // Drag the top-left corner of the map to resize it.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const [w0, h0] = custom ?? SIZES[size];
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => setCustom([Math.max(220, Math.min(window.innerWidth - 40, w0 - (ev.clientX - x0))), Math.max(150, Math.min(window.innerHeight - 140, h0 - (ev.clientY - y0)))]);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const expanded = pinned || hover || !!custom;
  const [w, h] = custom ?? (expanded || mobile ? SIZES[size] : [240, 160]);
  const low = remaining !== null && remaining < 10_000;
  const total = p.countdownEndsAt ? null : p.deadline && p.startedAt ? p.deadline - p.startedAt : null;

  return (
    <div className="stage" ref={stage} data-testid="stage">
      <PanoViewer ref={pano} pano={p.pano} movement={p.movement} onHeading={setHeading} onError={p.onPanoError} />
      {timed && remaining !== null && (
        <div className={`timer-bar ${p.countdownEndsAt ? 'countdown' : ''}`} aria-hidden>
          <div style={{ width: `${total ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 100}%` }} />
        </div>
      )}

      <div className="hud-top">
        <div className="row tight" style={{ alignItems: 'flex-start' }}>
          <div className="hud-pill">
            {p.hud}
            {timed && remaining !== null && (
              <div className="kv"><span className="k">{p.countdownEndsAt ? 'Hurry!' : 'Time'}</span><span className={`v timer ${low ? 'low' : ''}`} data-testid="timer">{fmtClock(remaining)}</span></div>
            )}
          </div>
          {p.pano.demo && <span className="chip demo" style={{ marginTop: 8 }} title="Illustrative scene drawn by Nearabouts — not a photograph of the location.">Demo scene</span>}
        </div>
        <div className="row tight" style={{ alignItems: 'flex-start' }}>
          {p.hudRight}
          <button className="compass" onClick={() => pano.current?.faceNorth()} title="Face north (N)" aria-label={`Compass: heading ${Math.round(heading)} degrees. Click to face north.`}>
            <span className="needle" style={{ transform: `rotate(${-heading}deg)` }}>
              <svg viewBox="0 0 40 40"><path d="M20 3l5 17h-10z" fill="#ff6b4a" /><path d="M20 37l-5-17h10z" fill="#c9d2df" /><text x="20" y="13.5" textAnchor="middle" fontSize="7" fontWeight="800" fill="#0b0e14">N</text></svg>
            </span>
          </button>
        </div>
      </div>

      <div className="hud-btns">
        <button className="hud-btn" onClick={() => pano.current?.reset()} title="Return to start (R)" aria-label="Return to start">⟲</button>
        {allowed.zoom && <button className="hud-btn zoom" onClick={() => pano.current?.zoom(0.8)} title="Zoom in (+)" aria-label="Zoom in">＋</button>}
        {allowed.zoom && <button className="hud-btn zoom" onClick={() => pano.current?.zoom(1.25)} title="Zoom out (−)" aria-label="Zoom out">－</button>}
        <button className="hud-btn" onClick={toggleFs} title="Fullscreen (F)" aria-label={fs ? 'Exit fullscreen' : 'Fullscreen'}>{fs ? '⤡' : '⤢'}</button>
        <button className="hud-btn" onClick={() => setHelp(true)} title="Controls (?)" aria-label="Controls and shortcuts">?</button>
        {p.onExit && <button className="hud-btn" onClick={p.onExit} title="Leave" aria-label="Leave game">✕</button>}
      </div>

      {p.pano.attribution?.text && (
        <div className="attribution">
          {p.pano.attribution.url ? <a href={p.pano.attribution.url} target="_blank" rel="noreferrer">{p.pano.attribution.text}</a> : p.pano.attribution.text}
          {p.pano.attribution.license ? ` · ${p.pano.attribution.license}` : ''}
        </div>
      )}
      {p.overlay}

      <div className={`guess-panel ${!expanded && !mobile ? 'collapsed' : ''} ${mobile && !mobileMap ? 'mobile-hidden' : ''}`}
        style={{ ['--gm-w' as any]: `${w}px`, ['--gm-h' as any]: `${h}px` }}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <div className="map-box">
          <div className="resize-handle" onPointerDown={startResize} title="Drag to resize" />
          <div className="map-tools size-tools">
            <button onClick={() => { setCustom(null); cycleSize(); }} title="Change map size (M)" aria-label="Change map size">⇲</button>
            <button onClick={() => setPinned((x) => !x)} title={pinned ? 'Unpin map' : 'Keep map open'} aria-pressed={pinned} aria-label="Pin map open">{pinned ? '📌' : '📍'}</button>
          </div>
          <GuessMap value={guess} onChange={setGuess} disabled={p.guessLocked} bounds={p.mapBounds} others={p.others} labels={p.labels} resizeKey={`${w}x${h}${mobileMap}${expanded}`} />
        </div>
        {mobile && !mobileMap && !p.guessLocked ? (
          <button className="btn primary block" onClick={() => setMobileMap(true)}>{guess ? 'Map · ready to guess' : 'Open map'}</button>
        ) : (
          <div className="row tight">
            {mobile && <button className="btn" onClick={() => setMobileMap(false)} aria-label="Hide map">▾</button>}
            <button className="btn primary block grow" data-testid="guess-btn" disabled={!guess || submitting || p.guessLocked} onClick={submit}>
              {p.guessLocked ? (p.lockedLabel ?? 'Guess locked in') : submitting ? 'Submitting…' : guess ? (p.guessLabel ?? 'Guess') : 'Place your pin on the map'}
            </button>
          </div>
        )}
      </div>

      {help && (
        <Modal title="Controls" onClose={() => setHelp(false)}>
          <p className="text-2">Rules this round: <b>{MOVEMENT_LABELS[p.movement]}</b>.</p>
          <table className="table"><tbody>
            {[
              ['Look around', 'Drag the view · Arrow keys'], ['Zoom', 'Scroll / pinch · + and −'], ['Travel (Moving only)', 'Arrows in the view · W / S'],
              ['Face north', 'Click compass · N'], ['Return to start', '⟲ · R'], ['Place guess', 'Click / tap the map, drag the pin to adjust'],
              ['Submit guess', 'Guess button · Space or Enter'], ['Map size', 'Hover to enlarge · ⇲ · drag top-left corner · M'], ['Fullscreen', '⤢ · F'],
            ].map(([a, b]) => <tr key={a}><td>{a}</td><td className="text-2">{b}</td></tr>)}
          </tbody></table>
        </Modal>
      )}
    </div>
  );
}
