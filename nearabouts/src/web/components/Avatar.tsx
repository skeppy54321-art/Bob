/** Original procedural avatars: a rounded "traveller" blob with a face and pattern. */
import type { AvatarConfig } from '../lib/types.ts';

const SHAPES = [
  'M50 8c22 0 38 16 38 40s-14 44-38 44S12 72 12 48 28 8 50 8z',
  'M50 6l34 18v40L50 94 16 64V24z',
  'M50 10c26 0 40 12 40 38 0 30-18 44-40 44S10 78 10 48C10 22 24 10 50 10z',
  'M20 18h60a8 8 0 018 8v52a8 8 0 01-8 8H20a8 8 0 01-8-8V26a8 8 0 018-8z',
  'M50 4c8 10 22 10 32 20s4 30 4 40-14 30-36 30S14 74 14 64 8 34 18 24 42 14 50 4z',
  'M50 8a42 42 0 110 84 42 42 0 010-84z',
];
const FACES = [
  <g key="0"><circle cx="38" cy="46" r="5" /><circle cx="62" cy="46" r="5" /><path d="M38 64q12 10 24 0" fill="none" strokeWidth="4" strokeLinecap="round" /></g>,
  <g key="1"><rect x="32" y="42" width="10" height="4" rx="2" /><rect x="58" y="42" width="10" height="4" rx="2" /><circle cx="50" cy="64" r="5" /></g>,
  <g key="2"><circle cx="40" cy="46" r="6" /><circle cx="60" cy="46" r="6" /><circle cx="41.5" cy="44.5" r="2" fill="#fff" /><circle cx="61.5" cy="44.5" r="2" fill="#fff" /><path d="M42 64h16" strokeWidth="4" strokeLinecap="round" /></g>,
  <g key="3"><path d="M32 46q6-6 12 0M56 46q6-6 12 0" fill="none" strokeWidth="4" strokeLinecap="round" /><path d="M40 62q10 8 20 0" fill="none" strokeWidth="4" strokeLinecap="round" /></g>,
  <g key="4"><circle cx="38" cy="48" r="4" /><circle cx="62" cy="48" r="4" /><path d="M44 62l6 4 6-4" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><rect x="28" y="38" width="44" height="6" rx="3" opacity=".9" /></g>,
  <g key="5"><circle cx="50" cy="46" r="9" /><circle cx="50" cy="46" r="3" fill="#fff" /><path d="M42 66q8 4 16 0" fill="none" strokeWidth="4" strokeLinecap="round" /></g>,
];

export function Avatar({ avatar, size = 36, title }: { avatar: AvatarConfig | undefined; size?: number; title?: string }) {
  const a = { shape: 0, hue: 200, accent: 30, face: 0, pattern: 0, ...(avatar ?? {}) };
  const main = `hsl(${a.hue} 70% 58%)`, dark = `hsl(${a.hue} 55% 32%)`, acc = `hsl(${a.accent} 85% 62%)`;
  const id = `av${a.shape}${a.hue}${a.accent}${a.pattern}`;
  return (
    <span className="avatar" style={{ width: size, height: size }} title={title}>
      <svg viewBox="0 0 100 100" role="img" aria-label={title ?? 'avatar'}>
        <defs>
          <clipPath id={id}><path d={SHAPES[a.shape % SHAPES.length]} /></clipPath>
        </defs>
        <rect width="100" height="100" fill={dark} />
        <g clipPath={`url(#${id})`}>
          <rect width="100" height="100" fill={main} />
          {a.pattern === 1 && [0, 1, 2, 3].map((i) => <rect key={i} x="0" y={10 + i * 24} width="100" height="9" fill={acc} opacity=".55" />)}
          {a.pattern === 2 && [0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={(i * 37) % 100} cy={(i * 53) % 100} r="9" fill={acc} opacity=".55" />)}
          {a.pattern === 3 && <path d="M0 70 L100 40 L100 100 L0 100z" fill={acc} opacity=".6" />}
          {a.pattern === 4 && <circle cx="80" cy="20" r="26" fill={acc} opacity=".6" />}
        </g>
        <g fill="#141a24" stroke="#141a24">{FACES[a.face % FACES.length]}</g>
      </svg>
    </span>
  );
}
