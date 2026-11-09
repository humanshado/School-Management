import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Message, Meta } from '../types';

// ------------------------------------------------------------ data
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api.get<T>(path);
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e: any) {
      if (my === seq.current) setError(e.message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

export const MetaContext = createContext<{ meta: Meta; reload: () => Promise<void> } | null>(null);
export const useMeta = () => {
  const m = useContext(MetaContext);
  if (!m) throw new Error('MetaContext missing');
  return m;
};

/** What the logged-in person may do, and the class a teacher should land on. */
export const usePerms = () => {
  const { meta } = useMeta();
  const p = meta.perms;
  const mine = p.classes ?? [];
  return {
    ...p,
    /** may take this class's register / enter its marks */
    canTeach: (cls: string) => p.teach && (!p.classes || p.classes.includes(cls)),
    defaultClass: mine[0] ?? meta.classes[0] ?? '',
    showFees: p.fees && meta.settings.useFees,
  };
};

// ------------------------------------------------------------ toasts
type Toast = { id: number; text: string; kind: 'ok' | 'err' };
const ToastContext = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'err' ? 6000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

/** Run an async action with a busy flag and an error toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r;
    } catch (e: any) {
      toast(e.message, 'err');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}

// ------------------------------------------------------------ layout bits
export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="head-actions">{children}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'bad' | 'good' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export const Loading = () => <div className="loading">Loading…</div>;
export const ErrorBox = ({ error, retry }: { error: string; retry?: () => void }) => (
  <div className="error-box">{error} {retry && <button className="btn sm" onClick={retry}>Try again</button>}</div>
);
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">×</button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, wide, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Select({ value, onChange, options, placeholder, ...rest }: { value: string; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; placeholder?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'>) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Flags({ n, max, reasons }: { n: number; max: number; reasons?: string[] }) {
  if (!n) return <span className="muted">–</span>;
  return <span className={`flag ${n >= 2 ? 'bad' : 'warn'}`} title={reasons?.join(', ')}>{n} of {max}</span>;
}

// ------------------------------------------------------------ charts (plain SVG)
export function BarChart({ data, height = 150, min, max = 100, unit = '%', threshold, showValues = true }: { data: { label: string; value: number; title?: string }[]; height?: number; min?: number; max?: number; unit?: string; threshold?: number; showValues?: boolean }) {
  if (!data.length) return <Empty>No data yet.</Empty>;
  const lo = min ?? Math.max(0, Math.floor((Math.min(...data.map((d) => d.value), threshold ?? max) - 5) / 5) * 5);
  const h = (v: number) => `${Math.max(0, Math.min(1, (v - lo) / (max - lo || 1))) * 100}%`;
  return (
    <div className="bars" style={{ height }} role="img" aria-label={data.map((d) => `${d.label} ${d.value}${unit}`).join(', ')}>
      {threshold !== undefined && <div className="bars-threshold" style={{ bottom: h(threshold) }} title={`target ${threshold}${unit}`} />}
      {data.map((d) => (
        <div className="bars-col" key={d.label} title={d.title ?? `${d.label}: ${d.value}${unit}`}>
          <div className="bars-track">
            {showValues && <span className="bars-val" style={{ bottom: h(d.value) }}>{d.value}</span>}
            <div className={`bars-bar ${threshold !== undefined && d.value < threshold ? 'low' : ''}`} style={{ height: h(d.value) }} />
          </div>
          <span className="bars-label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Meter({ value, tone }: { value: number | null; tone?: string }) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  return <span className={`meter ${tone ?? ''}`}><span style={{ width: `${v * 100}%` }} /></span>;
}

// ------------------------------------------------------------ e-mail messages
export const mailto = (m: Message) => `mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;

export function MessagesModal({ kind, learnerIds, date, term, title, onClose }: { kind: 'absent' | 'risk' | 'report' | 'fees'; learnerIds: number[]; date?: string; term?: string; title: string; onClose: () => void }) {
  const [list, setList] = useState<Message[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(0);
  const toast = useToast();
  useEffect(() => {
    api.post<Message[]>('/messages', { kind, learnerIds, date, term }).then(setList).catch((e) => setErr(e.message));
  }, [kind, learnerIds, date, term]);
  const copyAll = async () => {
    if (!list) return;
    await navigator.clipboard.writeText(list.map((m) => `To: ${m.to}\nSubject: ${m.subject}\n\n${m.body}`).join('\n\n-----\n\n'));
    toast('All messages copied');
  };
  return (
    <Modal title={title} onClose={onClose} wide footer={<>
      <span className="muted small">Each e-mail opens in your mail app for you to check and send — nothing is sent automatically.</span>
      <button className="btn" onClick={copyAll} disabled={!list?.length}>Copy all</button>
      <button className="btn primary" onClick={onClose}>Done</button>
    </>}>
      {err && <ErrorBox error={err} />}
      {!list && !err && <Loading />}
      {list && !list.length && <Empty>No one to message.</Empty>}
      {list && list.length > 0 && (
        <div className="msg-list">
          {list.map((m, i) => (
            <details key={m.learnerId} open={i === open} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setOpen(i)}>
              <summary>
                <b>{m.name}</b> <span className="muted">{m.to || 'no e-mail on file'}</span>
                <a className={`btn sm ${m.to ? 'primary' : ''}`} href={mailto(m)} onClick={(e) => e.stopPropagation()}>Open e-mail</a>
              </summary>
              <div className="msg-subject">{m.subject}</div>
              <pre className="msg-body">{m.body}</pre>
            </details>
          ))}
        </div>
      )}
    </Modal>
  );
}
