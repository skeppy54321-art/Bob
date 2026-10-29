import { api } from './api.ts';
import type { GameRules } from './types.ts';

export interface StartBody { mode: string; mapSlug?: string; rules?: Partial<GameRules>; countryCode?: string; challengeCode?: string }
/** Create a solo game on the server and return its id. */
export async function startGame(body: StartBody): Promise<string> {
  const g = await api<{ id: string }>('/api/games', { body });
  return g.id;
}

export function scoreEmoji(score: number, max = 5000): string {
  const f = score / max;
  return f >= 0.9 ? '🟩' : f >= 0.6 ? '🟨' : f >= 0.2 ? '🟧' : '🟥';
}

export async function shareText(text: string, url?: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) { await navigator.share({ text, url }); return 'shared'; }
  } catch { /* user cancelled or unsupported */ }
  try { await navigator.clipboard.writeText(url ? `${text}\n${url}` : text); return 'copied'; } catch { return 'failed'; }
}
