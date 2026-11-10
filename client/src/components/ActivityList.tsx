import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { ROLE_LABEL } from '../format';
import { Empty, ErrorBox, Loading } from './ui';

export interface ActivityItem {
  id: number; at: string; userId: number | null; userName: string; role: keyof typeof ROLE_LABEL | null; ip: string | null;
  category: string; action: string; summary: string; learnerId: number | null; details: any;
}
export interface ActivityPage { items: ActivityItem[]; hasMore: boolean; users: { userId: number | null; userName: string }[]; categories: Record<string, string> }
export type ActivityFilter = Record<string, string | undefined>;

const dayLabel = (iso: string) => {
  const d = new Date(iso), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const label = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/** { field: [before, after] } pairs show as a before → after table; anything else as labelled values. */
function Details({ d }: { d: any }) {
  if (d === null || d === undefined) return null;
  const isDiff = d && typeof d === 'object' && !Array.isArray(d) && Object.values(d).every((v) => Array.isArray(v) && v.length === 2);
  if (isDiff) {
    return (
      <table className="table compact act-diff">
        <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
        <tbody>{Object.entries(d).map(([k, [a, b]]: any) => <tr key={k}><td>{label(k)}</td><td className="was">{show(a)}</td><td className="now">{show(b)}</td></tr>)}</tbody>
      </table>
    );
  }
  if (Array.isArray(d) && d.length && typeof d[0] === 'object') {
    const keys = Object.keys(d[0]);
    return (
      <table className="table compact act-diff">
        <thead><tr>{keys.map((k) => <th key={k}>{label(k)}</th>)}</tr></thead>
        <tbody>{d.map((r: any, i: number) => <tr key={i}>{keys.map((k) => <td key={k}>{show(r[k])}</td>)}</tr>)}</tbody>
      </table>
    );
  }
  return <pre className="act-json">{JSON.stringify(d, null, 2)}</pre>;
}

/** The log, newest first, grouped by day, with "Load older". */
export default function ActivityList({ filter, compact }: { filter: ActivityFilter; compact?: boolean }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const key = JSON.stringify(filter);

  const load = useCallback(async (before?: number) => {
    setBusy(true);
    try {
      const page = await api.get<ActivityPage>(`/activity${qs({ ...filter, before, limit: 100 })}`);
      setItems((cur) => (before && cur ? [...cur, ...page.items] : page.items));
      setHasMore(page.hasMore);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { setItems(null); load(); }, [load]);

  if (err) return <ErrorBox error={err} retry={() => load()} />;
  if (!items) return <Loading />;
  if (!items.length) return <Empty>Nothing recorded{Object.values(filter).some(Boolean) ? ' that matches' : ' yet'}.</Empty>;

  let lastDay = '';
  return (
    <div className={`act-list ${compact ? 'compact' : ''}`}>
      {items.map((e) => {
        const day = dayLabel(e.at);
        const head = day !== lastDay ? <div className="act-day">{day}</div> : null;
        lastDay = day;
        const expandable = e.details !== null && e.details !== undefined;
        return (
          <div key={e.id}>
            {head}
            <div className={`act-row cat-${e.category} ${e.action.includes('delete') || e.action.includes('failed') || e.action.includes('locked') || e.action.includes('clear') ? 'act-warn' : ''}`}>
              <span className="act-time" title={new Date(e.at).toLocaleString()}>{time(e.at)}</span>
              <span className="act-who">
                <b>{e.userName}</b>
                {e.role && <span className={`pill role-${e.role}`}>{ROLE_LABEL[e.role] ?? e.role}</span>}
              </span>
              <span className="act-what">
                {e.summary}
                {!compact && e.learnerId && <> · <Link to={`/students/${e.learnerId}`}>learner</Link></>}
              </span>
              {expandable && <button className="btn sm ghost" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>{open === e.id ? 'Hide' : 'Details'}</button>}
            </div>
            {open === e.id && <div className="act-details"><Details d={e.details} />{e.ip && <p className="muted small">From address {e.ip}</p>}</div>}
          </div>
        );
      })}
      {hasMore && <div className="act-more"><button className="btn" disabled={busy} onClick={() => load(items[items.length - 1].id)}>{busy ? 'Loading…' : 'Load older'}</button></div>}
    </div>
  );
}
