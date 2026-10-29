import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import type { AppConfig, Me } from './types.ts';

type ToastKind = 'info' | 'error' | 'success';
interface Toast { id: number; text: string; kind: ToastKind; action?: { label: string; onClick: () => void } }
interface Settings { units: 'km' | 'mi'; reducedMotion: boolean; mapStyle: 'auto' | 'vector' | 'tiles' }

interface Ctx {
  user: Me | null;
  config: AppConfig | null;
  settings: Settings;
  ready: boolean;
  bootError: string | null;
  setUser: (u: Me) => void;
  refreshUser: () => Promise<void>;
  updateSettings: (s: Partial<Settings>) => void;
  toast: (text: string, kind?: ToastKind, action?: Toast['action']) => void;
}
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const LOCAL_KEY = 'nearabouts:settings';
const loadLocal = (): Partial<Settings> => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}'); } catch { return {}; } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const [settings, setSettings] = useState<Settings>(() => ({ units: 'km', reducedMotion: false, mapStyle: 'auto', ...loadLocal() }));

  const toast = useCallback((text: string, kind: ToastKind = 'info', action?: Toast['action']) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 9000 : 4200);
  }, []);

  const refreshUser = useCallback(async () => {
    const r = await api<{ user: Me }>('/api/me');
    setUser(r.user);
    if (r.user.settings) setSettings((s) => ({ ...s, ...r.user.settings } as Settings));
  }, []);

  useEffect(() => {
    Promise.all([api<AppConfig>('/api/config').then(setConfig), refreshUser()]).catch((e) => setBootError(e.message));
  }, [refreshUser]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  }, [settings]);

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings((cur) => ({ ...cur, ...s }));
    api('/api/me', { method: 'PATCH', body: { settings: s } }).catch(() => {});
  }, []);

  const value = useMemo(() => ({ user, config, settings, ready: !!user && !!config, bootError, setUser, refreshUser, updateSettings, toast }),
    [user, config, settings, bootError, refreshUser, updateSettings, toast]);

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            {t.action && <button className="btn sm primary" onClick={() => { t.action!.onClick(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
