import { useEffect, useRef, type ReactNode } from 'react';
import { useApp } from '../lib/store.tsx';

export const Spinner = ({ small }: { small?: boolean }) => <div className={`spinner ${small ? 'sm' : ''}`} role="status" aria-label="Loading" />;

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="center-state"><Spinner /><span>{label}</span></div>;
}
export function Empty({ icon = '🧭', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return <div className="center-state"><div className="icon" aria-hidden>{icon}</div><h3>{title}</h3>{children && <div className="muted">{children}</div>}</div>;
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="center-state" role="alert">
      <div className="icon" aria-hidden>⚠️</div>
      <h3>Something went wrong</h3>
      <div className="muted">{message}</div>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn ghost icon sm" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={String(o.value)} aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <label className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export function DemoBadge() {
  const { config } = useApp();
  if (!config?.demo) return null;
  return <span className="chip demo" title="No live imagery provider is configured. Scenes are drawn by Nearabouts and are illustrations, not photographs.">Demo scenes</span>;
}

export function Medal({ medal }: { medal: string }) {
  const label = medal === 'none' ? '–' : medal[0].toUpperCase();
  return <span className={`medal ${medal}`} title={medal === 'none' ? 'No medal yet' : `${medal} medal`} aria-label={`${medal} medal`}>{label}</span>;
}
