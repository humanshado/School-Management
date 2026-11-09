import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { fmtLong, fmtShort, markClass, pct } from '../format';
import { Empty, ErrorBox, Loading, MessagesModal, useAction, useApi, useMeta } from './ui';

interface RegLearner {
  id: number; name: string; learnerNo: string; mark: string; note: string; termAtt: number | null;
  last5: { date: string; mark: string }[]; guardianEmail: string;
}
interface RegData {
  className: string; date: string; taken: boolean; takenBy: string; holiday: string; weekend: boolean; schoolDay: boolean;
  learners: RegLearner[]; prevDay: string; nextDay: string; today: string; teacher: string; canEdit: boolean;
}

const MARKS = [
  { k: 'P', label: 'Present' }, { k: 'A', label: 'Absent' }, { k: 'L', label: 'Late' }, { k: 'E', label: 'Excused' },
] as const;

export default function Register({ className, date, onDate, compact = false, onSaved }: {
  className: string; date: string; onDate?: (d: string) => void; compact?: boolean; onSaved?: () => void;
}) {
  const { meta, reload: reloadMeta } = useMeta();
  const { data, error, loading, reload } = useApi<RegData>(className ? `/register${qs({ class: className, date })}` : null);
  const [marks, setMarks] = useState<Record<number, { mark: string; note: string }>>({});
  const [msg, setMsg] = useState<number[] | null>(null);
  const { busy, run } = useAction();

  useEffect(() => {
    if (data) setMarks(Object.fromEntries(data.learners.map((l) => [l.id, { mark: l.mark, note: l.note }])));
  }, [data]);

  const dirty = useMemo(() => !!data && data.learners.some((l) => marks[l.id] && (marks[l.id].mark !== l.mark || marks[l.id].note !== l.note)), [data, marks]);
  const counts = useMemo(() => {
    const c = { P: 0, A: 0, L: 0, E: 0 } as Record<string, number>;
    for (const m of Object.values(marks)) c[m.mark] = (c[m.mark] ?? 0) + 1;
    return c;
  }, [marks]);

  if (!className) return <Empty>Pick a class.</Empty>;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || loading && !data) return <Loading />;

  const future = data.date > data.today;
  const locked = future || !data.canEdit;
  const set = (id: number, patch: Partial<{ mark: string; note: string }>) => setMarks((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  const go = (d: string) => {
    if (dirty && !confirm('The register has changes that are not saved. Leave without saving?')) return;
    onDate?.(d);
  };
  const save = () => run(async () => {
    if (data.holiday && !confirm(`${fmtLong(data.date)} is a holiday: ${data.holiday}. Save this register anyway?`)) return;
    const r = await api.post('/register', { className, date: data.date, marks: data.learners.map((l) => ({ learnerId: l.id, ...marks[l.id] })) });
    await Promise.all([reload(), reloadMeta()]);
    onSaved?.();
    return r;
  }, `Register saved · ${className} · ${fmtShort(data.date)}`);
  const absentIds = data.learners.filter((l) => marks[l.id]?.mark === 'A').map((l) => l.id);

  return (
    <div className="register">
      <div className="reg-bar">
        {onDate && (
          <div className="day-nav">
            <button className="btn sm" onClick={() => go(data.prevDay)} title="Previous school day">‹</button>
            <input type="date" value={data.date} max={data.today} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Register date" />
            <button className="btn sm" onClick={() => go(data.nextDay)} disabled={data.nextDay > data.today} title="Next school day">›</button>
            {data.date !== data.today && <button className="btn sm ghost" onClick={() => go(data.today)}>Today</button>}
          </div>
        )}
        <div className="reg-status">
          {data.taken ? <span className="pill ok">Taken{data.takenBy ? ` · ${data.takenBy}` : ''}</span> : <span className={`pill ${data.schoolDay ? 'warn' : ''}`}>Not taken yet</span>}
          {data.holiday && <span className="pill">{data.holiday}</span>}
          {data.weekend && <span className="pill">Weekend</span>}
          {!data.canEdit && <span className="pill info" title={`Only ${data.teacher || 'the class teacher'} or an admin can change this register`}>View only</span>}
          <span className="muted small">{counts.P + counts.L} present · {counts.A} absent · {counts.L} late · {counts.E} excused · {data.learners.length} enrolled</span>
        </div>
      </div>

      {data.learners.length === 0 ? <Empty>No active learners in {className}. <Link to="/students">Add learners</Link></Empty> : (
        <div className="table-wrap">
          <table className="table reg-table">
            <thead>
              <tr>
                <th>Learner</th>
                <th>Today</th>
                {!compact && <th>Note</th>}
                <th className="hide-sm">Last 5 days</th>
                <th className="num">Term</th>
              </tr>
            </thead>
            <tbody>
              {data.learners.map((l) => {
                const m = marks[l.id] ?? { mark: 'P', note: '' };
                return (
                  <tr key={l.id}>
                    <td><Link to={`/students/${l.id}`}>{l.name}</Link></td>
                    <td>
                      <div className="mark-toggle" role="radiogroup" aria-label={`${l.name} attendance`}>
                        {MARKS.map((x) => (
                          <button key={x.k} role="radio" aria-checked={m.mark === x.k} title={x.label} disabled={locked}
                            className={m.mark === x.k ? `on ${markClass(x.k)}` : ''} onClick={() => set(l.id, { mark: x.k })}>{x.k}</button>
                        ))}
                      </div>
                    </td>
                    {!compact && <td><input className="note-input" value={m.note} placeholder={m.mark === 'P' ? '' : 'Reason…'} onChange={(e) => set(l.id, { note: e.target.value })} disabled={locked} /></td>}
                    <td className="hide-sm">
                      <div className="last5">{l.last5.map((d) => <span key={d.date} className={`dot ${markClass(d.mark)}`} title={`${fmtShort(d.date)}: ${d.mark}`}>{d.mark}</span>)}</div>
                    </td>
                    <td className={`num ${l.termAtt !== null && l.termAtt < meta.settings.riskAttendance ? 'bad-text' : ''}`}>{pct(l.termAtt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.canEdit && <div className="reg-actions">
        <button className="btn ghost" disabled={future || busy} onClick={() => setMarks((mk) => Object.fromEntries(Object.entries(mk).map(([k, v]) => [k, { ...v, mark: 'P' }])))}>All present</button>
        <button className="btn" disabled={!absentIds.length} onClick={() => setMsg(absentIds)}>Message guardians ({absentIds.length})</button>
        <button className="btn primary" disabled={future || busy || !data.learners.length} onClick={save}>{busy ? 'Saving…' : data.taken ? (dirty ? 'Save changes' : 'Save register') : 'Save register'}</button>
      </div>}
      {future && <p className="muted small">A register cannot be taken for a future date.</p>}
      <p className="muted small legend">P present · A absent · L late · E excused{meta.settings.lateCountsPresent ? ' · late counts as present' : ''}</p>
      {msg && <MessagesModal kind="absent" learnerIds={msg} date={data.date} title={`Absence messages · ${className}`} onClose={() => setMsg(null)} />}
    </div>
  );
}
