import { useCallback, useEffect, useRef, useState } from 'react';

/** Load async data with loading / error state and a reload function. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => { if (id === seq.current) setState({ data, error: null, loading: false }); })
      .catch((e) => { if (id === seq.current) setState((s) => ({ ...s, error: e?.message ?? 'Something went wrong.', loading: false })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run, setData: (d: T) => setState((s) => ({ ...s, data: d })) };
}

/** Keeps a server-clock offset so countdowns agree with the server, not the device clock. */
export function useServerClock(serverNow: number | null | undefined) {
  const offset = useRef(0);
  useEffect(() => { if (serverNow) offset.current = serverNow - Date.now(); }, [serverNow]);
  return useCallback(() => Date.now() + offset.current, []);
}

/** Re-render every `ms` while active. */
export function useTick(active: boolean, ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(h);
  }, [active, ms]);
}

/** Global keyboard shortcuts, ignored while typing in inputs. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const fn = ref.current[e.key] ?? ref.current[e.key.toLowerCase()];
      if (fn) { fn(e); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [enabled]);
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}
