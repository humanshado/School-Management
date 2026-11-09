import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Select, useAction, useApi, useMeta } from '../components/ui';
import { bandOf, fmtShort, num1, pct, signed } from '../format';

interface GB {
  className: string; term: string; subjects: string[]; classAvg: Record<string, number | null>; assessmentCounts: Record<string, number>;
  learners: { id: number; name: string; marks: Record<string, number>; avg: number | null; chg: number | null; pos: number | null; att: number | null; flags: number }[];
}
interface Assessment { id: number; term: string; className: string; subject: string; name: string; weight: number; outOf: number; date: string | null }
interface AS { assessments: Assessment[]; learners: { id: number; name: string; marks: Record<number, number>; termMark: number | null }[] }

export default function Gradebook() {
  const { meta } = useMeta();
  const s = meta.settings;
  const [sp, setSp] = useSearchParams();
  const cls = sp.get('class') && meta.classes.includes(sp.get('class')!) ? sp.get('class')! : meta.classes[0] ?? '';
  const term = sp.get('term') ?? meta.term;
  const subject = sp.get('subject') ?? '';
  const set = (patch: Record<string, string>) => setSp(Object.fromEntries(Object.entries({ class: cls, term, subject, ...patch }).filter(([, v]) => v)), { replace: true });

  return (
    <>
      <PageHead title="Gradebook" sub={subject ? `${subject} · assessments and marks` : 'Term mark per subject = the weighted assessments'}>
        <Select value={cls} onChange={(v) => set({ class: v })} options={meta.classes} aria-label="Class" />
        <Select value={term} onChange={(v) => set({ term: v })} options={s.terms.map((t) => t.name)} aria-label="Term" />
        <Select value={subject} onChange={(v) => set({ subject: v })} options={s.subjects} placeholder="All subjects (term marks)" aria-label="Subject" />
      </PageHead>
      {subject ? <SubjectMarks cls={cls} term={term} subject={subject} /> : <TermMarks cls={cls} term={term} onSubject={(x) => set({ subject: x })} />}
    </>
  );
}

function TermMarks({ cls, term, onSubject }: { cls: string; term: string; onSubject: (s: string) => void }) {
  const { meta, reload: reloadMeta } = useMeta();
  const s = meta.settings;
  const { data, error, reload } = useApi<GB>(`/gradebook${qs({ class: cls, term })}`);
  const { busy, run } = useAction();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const noAssessments = Object.keys(data.assessmentCounts).length === 0;
  const color = (m: number | undefined) => (m === undefined ? '' : `band-${bandOf(s, m)}`);
  return (
    <Card pad={false} actions={noAssessments ? undefined : <span className="muted small">Click a subject to enter marks</span>} title={`${cls} · ${term}`}>
      {noAssessments && (
        <div className="callout">
          No assessments for {cls} in {term} yet.
          <button className="btn primary sm" disabled={busy} onClick={() => run(async () => { const r = await api.post('/assessments/defaults', { className: cls, term }); await reload(); reloadMeta(); return r; }, 'Default assessments added for every subject')}>
            Add the default assessments ({s.assessmentTypes.map((a) => `${a.name} ${a.weight}%`).join(', ')})
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table gb">
          <thead>
            <tr>
              <th>#</th><th>Learner</th>
              {data.subjects.map((x) => <th key={x} className="num subj"><button className="link" onClick={() => onSubject(x)}>{x}</button><small>{data.assessmentCounts[x] ?? 0} assess.</small></th>)}
              <th className="num">Average</th><th className="num">Change</th><th className="num">Pos.</th><th className="num">Attend.</th><th />
            </tr>
          </thead>
          <tbody>
            {data.learners.map((l, i) => (
              <tr key={l.id}>
                <td className="muted">{i + 1}</td>
                <td><Link to={`/students/${l.id}`}>{l.name}</Link></td>
                {data.subjects.map((x) => <td key={x} className={`num ${color(l.marks[x])}`}>{l.marks[x] ?? ''}</td>)}
                <td className="num"><b>{num1(l.avg)}</b></td>
                <td className={`num ${l.chg !== null && l.chg <= -s.riskDrop ? 'bad-text' : l.chg !== null && l.chg > 0 ? 'good-text' : ''}`}>{signed(l.chg)}</td>
                <td className="num">{l.pos ?? '–'}</td>
                <td className="num">{pct(l.att)}</td>
                <td><Link className="btn sm ghost" to={`/report-cards?learner=${l.id}&class=${encodeURIComponent(cls)}&term=${encodeURIComponent(term)}`}>Report</Link></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td /><td>Class average</td>{data.subjects.map((x) => <td key={x} className="num">{num1(data.classAvg[x])}</td>)}<td colSpan={5} /></tr>
          </tfoot>
        </table>
      </div>
      <div className="legend-bands pad-x">{s.gradeBands.map((b) => <span key={b.band} className={`band-${b.band}`}>{b.band} {b.from}+ · {b.meaning}</span>)}</div>
    </Card>
  );
}

function SubjectMarks({ cls, term, subject }: { cls: string; term: string; subject: string }) {
  const { meta, reload: reloadMeta } = useMeta();
  const { data, error, reload } = useApi<AS>(`/assessments${qs({ class: cls, term, subject })}`);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editA, setEditA] = useState<Partial<Assessment> | null>(null);
  const { busy, run } = useAction();
  useEffect(() => setEdits({}), [data]);
  const dirty = Object.keys(edits).length > 0;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const totalW = useMemo(() => data?.assessments.reduce((a, x) => a + x.weight, 0) ?? 0, [data]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const key = (aid: number, lid: number) => `${aid}:${lid}`;
  const val = (aid: number, lid: number, cur?: number) => edits[key(aid, lid)] ?? (cur === undefined ? '' : String(cur));
  const save = () => run(async () => {
    const marks = Object.entries(edits).map(([k, v]) => { const [a, l] = k.split(':').map(Number); return { assessmentId: a, learnerId: l, mark: v.trim() === '' ? null : Number(v) }; });
    await api.put('/marks', { marks });
    await reload(); reloadMeta();
  }, 'Marks saved');
  const invalid = (aid: number, v: string) => { if (v.trim() === '') return false; const n = Number(v); const a = data.assessments.find((x) => x.id === aid)!; return !Number.isFinite(n) || n < 0 || n > a.outOf; };
  const anyInvalid = Object.entries(edits).some(([k, v]) => invalid(+k.split(':')[0], v));
  // Enter moves down the column, like a spreadsheet
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, col: number, row: number) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(`[data-cell="${col}:${row + (e.key === 'ArrowUp' ? -1 : 1)}"]`);
      next?.focus(); next?.select();
    }
  };

  return (
    <Card title={`${subject} · ${cls} · ${term}`} pad={false} actions={<>
      <button className="btn" onClick={() => setEditA({ className: cls, term, subject, name: '', weight: 0, outOf: 100, date: meta.today })}>+ Assessment</button>
      {data.assessments.length === 0 && <button className="btn" onClick={() => run(async () => { await api.post('/assessments/defaults', { className: cls, term, subject }); await reload(); }, 'Default assessments added')}>Add defaults</button>}
      <button className="btn primary" disabled={!dirty || busy || anyInvalid} onClick={save}>{busy ? 'Saving…' : dirty ? `Save marks (${Object.keys(edits).length})` : 'Saved'}</button>
    </>}>
      {data.assessments.length === 0 ? <Empty>No {subject} assessments for {cls} in {term} yet.</Empty> : (
        <div className="table-wrap">
          {totalW !== 100 && <div className="callout warn">Weights add up to {totalW}%. The term mark still works (it divides by the total weight), but check this is what you meant.</div>}
          <table className="table gb marks-entry">
            <thead>
              <tr>
                <th>Learner</th>
                {data.assessments.map((a) => (
                  <th key={a.id} className="num">
                    <button className="link" onClick={() => setEditA(a)} title="Edit assessment">{a.name}</button>
                    <small>{a.weight}% · out of {a.outOf}{a.date ? ` · ${fmtShort(a.date)}` : ''}</small>
                  </th>
                ))}
                <th className="num">Term mark</th>
              </tr>
            </thead>
            <tbody>
              {data.learners.map((l, row) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  {data.assessments.map((a, col) => {
                    const v = val(a.id, l.id, l.marks[a.id]);
                    return (
                      <td key={a.id} className="num">
                        <input className={`mark-input ${invalid(a.id, v) ? 'invalid' : ''} ${edits[key(a.id, l.id)] !== undefined ? 'changed' : ''}`} inputMode="decimal" value={v}
                          data-cell={`${col}:${row}`} aria-label={`${l.name} ${a.name}`} onKeyDown={(e) => onKey(e, col, row)}
                          onChange={(e) => setEdits((x) => ({ ...x, [key(a.id, l.id)]: e.target.value }))} />
                      </td>
                    );
                  })}
                  <td className="num"><b>{l.termMark ?? '–'}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editA && <AssessmentModal a={editA} onClose={() => setEditA(null)} onSaved={() => { setEditA(null); reload(); reloadMeta(); }} />}
    </Card>
  );
}

function AssessmentModal({ a, onClose, onSaved }: { a: Partial<Assessment>; onClose: () => void; onSaved: () => void }) {
  const { meta } = useMeta();
  const [f, setF] = useState(a);
  const { busy, run } = useAction();
  const save = async () => { if (await run(() => (f.id ? api.put(`/assessments/${f.id}`, f) : api.post('/assessments', f)), 'Assessment saved')) onSaved(); };
  const del = async () => { if (confirm(`Delete ${f.name} and all of its marks?`) && (await run(() => api.del(`/assessments/${f.id}`), 'Assessment deleted'))) onSaved(); };
  return (
    <Modal title={f.id ? `Edit ${a.name}` : `New ${a.subject} assessment`} onClose={onClose} footer={<>
      {f.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>Save</button>
    </>}>
      <div className="form-grid">
        <Field label="Name *"><input list="atypes" value={f.name ?? ''} onChange={(e) => {
          const t = meta.settings.assessmentTypes.find((x) => x.name === e.target.value);
          setF({ ...f, name: e.target.value, ...(t && !f.id ? { weight: t.weight } : {}) });
        }} autoFocus /></Field>
        <datalist id="atypes">{meta.settings.assessmentTypes.map((t) => <option key={t.name} value={t.name} />)}</datalist>
        <Field label="Weight (%)"><input type="number" min="0" value={f.weight ?? 0} onChange={(e) => setF({ ...f, weight: +e.target.value })} /></Field>
        <Field label="Out of"><input type="number" min="1" value={f.outOf ?? 100} onChange={(e) => setF({ ...f, outOf: +e.target.value })} /></Field>
        <Field label="Date"><input type="date" value={f.date ?? ''} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
