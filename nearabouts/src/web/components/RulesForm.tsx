import type { GameRules } from '../lib/types.ts';
import { Segmented } from './ui.tsx';
import { MOVEMENT_HELP, TIME_PRESETS } from '../../shared/rules.ts';
import { fmtTimeLimit } from '../lib/format.ts';

/** Editor for movement / time / rounds / difficulty. `hide` drops fields a mode fixes. */
export function RulesForm({ value, onChange, hide = [], allowUntimed = true }: { value: GameRules; onChange: (r: GameRules) => void; hide?: (keyof GameRules)[]; allowUntimed?: boolean }) {
  const set = (p: Partial<GameRules>) => onChange({ ...value, ...p });
  const times = TIME_PRESETS.filter((t) => allowUntimed || t > 0);
  return (
    <div className="col" style={{ gap: 14 }}>
      {!hide.includes('movement') && (
        <div className="col" style={{ gap: 6 }}>
          <span className="small text-2" style={{ fontWeight: 650 }}>Movement</span>
          <Segmented label="Movement" value={value.movement} onChange={(movement) => set({ movement })}
            options={[{ value: 'moving', label: 'Moving' }, { value: 'nomove', label: 'No Move' }, { value: 'nmpz', label: 'NMPZ', title: 'No Move, Pan or Zoom' }]} />
          <span className="hint">{MOVEMENT_HELP[value.movement]}</span>
        </div>
      )}
      {!hide.includes('timeLimit') && (
        <div className="col" style={{ gap: 6 }}>
          <span className="small text-2" style={{ fontWeight: 650 }}>Time per round</span>
          <Segmented label="Time per round" value={value.timeLimit} onChange={(timeLimit) => set({ timeLimit })}
            options={times.map((t) => ({ value: t, label: t === 0 ? 'Untimed' : fmtTimeLimit(t) }))} />
        </div>
      )}
      {!hide.includes('rounds') && (
        <label className="field">Rounds: {value.rounds}
          <input type="range" min={1} max={20} value={value.rounds} onChange={(e) => set({ rounds: Number(e.target.value) })} />
        </label>
      )}
      {!hide.includes('difficulty') && (
        <div className="col" style={{ gap: 6 }}>
          <span className="small text-2" style={{ fontWeight: 650 }}>Difficulty</span>
          <Segmented label="Difficulty" value={value.difficulty} onChange={(difficulty) => set({ difficulty })}
            options={[{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }]} />
          <span className="hint">{value.difficulty === 'easy' ? 'Favours well-known, easier places; map shows labels when available.' : value.difficulty === 'hard' ? 'Favours remote places; the guess map has no labels.' : 'A balanced mix of places.'}</span>
        </div>
      )}
    </div>
  );
}
