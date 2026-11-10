import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { Card, ErrorBox, Loading, MessagesModal, PageHead, Select, useApi, useMeta, usePerms, useToast } from '../components/ui';
import { fmtDate, num1, pct, signed } from '../format';

export interface RC {
  student: { id: number; name: string; firstName: string; learnerNo: string; className: string; guardianName: string; guardianEmail: string };
  classLabel: string; classTeacher: string; term: string;
  subjects: { subject: string; mark: number | null; band: string; meaning: string; classAvg: number | null; prev: number | null }[];
  avg: number | null; band: string; chg: number | null; pos: number | null; classSize: number;
  attendance: { present: number; taken: number; absent: number; late: number; att: number | null };
  teacherComment: string; principalComment: string; nextTermStarts: string | null; canEditTeacher: boolean; canEditPrincipal: boolean; gpa?: number | null; gpaCumulative?: number | null;
}
export interface RCData { school: { name: string; address: string; contact: string; principal: string }; gradeBands: { band: string; from: number; meaning: string }[]; cards: RC[] }

export default function ReportCards() {
  const { meta } = useMeta();
  const { defaultClass } = usePerms();
  const [sp, setSp] = useSearchParams();
  const cls = sp.get('class') && meta.classes.includes(sp.get('class')!) ? sp.get('class')! : defaultClass;
  const term = sp.get('term') ?? meta.term;
  const learner = sp.get('learner') ?? '';
  const { data, error, reload } = useApi<RCData>(`/report-cards${qs({ class: cls, term })}`);
  const [mail, setMail] = useState<number[] | null>(null);
  const [printAll, setPrintAll] = useState(false);
  const set = (patch: Record<string, string>) => setSp(Object.fromEntries(Object.entries({ class: cls, term, learner, ...patch }).filter(([, v]) => v)), { replace: true });

  useEffect(() => {
    if (!printAll) return;
    const t = setTimeout(() => { window.print(); setPrintAll(false); }, 100);
    return () => clearTimeout(t);
  }, [printAll]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const card = data.cards.find((c) => String(c.student.id) === learner) ?? data.cards[0];

  return (
    <>
      <PageHead title="Report Cards" sub={`${data.cards.length} learners · ${term}`}>
        <Select value={cls} onChange={(v) => set({ class: v, learner: '' })} options={meta.classes} aria-label="Class" />
        <Select value={term} onChange={(v) => set({ term: v })} options={meta.settings.terms.map((t) => t.name)} aria-label="Term" />
      </PageHead>
      {!card ? <Card><p className="muted">No active learners in {cls}.</p></Card> : (
        <div className="rc-layout">
          <Card className="rc-side no-print" pad={false}>
            <div className="rc-actions">
              <button className="btn primary" onClick={() => window.print()}>Print this card</button>
              <button className="btn" onClick={() => setPrintAll(true)}>Print whole class</button>
              <button className="btn" onClick={() => setMail([card.student.id])}>E-mail guardian</button>
              <button className="btn" onClick={() => setMail(data.cards.map((c) => c.student.id))}>E-mail class</button>
              <p className="muted small">Tip: choose "Save as PDF" in the print dialog to keep a PDF copy.</p>
            </div>
            <ul className="rc-list">
              {data.cards.map((c) => (
                <li key={c.student.id}><button className={c === card ? 'on' : ''} onClick={() => set({ learner: String(c.student.id) })}>
                  <span>{c.student.name}</span><small>{c.avg === null ? 'no marks' : `${num1(c.avg)} · ${c.band}`}</small>
                </button></li>
              ))}
            </ul>
          </Card>
          <div className="print-area">
            {printAll ? data.cards.map((c) => <ReportCard key={c.student.id} rc={c} school={data.school} bands={data.gradeBands} readOnly />)
              : <ReportCard key={`${card.student.id}-${term}`} rc={card} school={data.school} bands={data.gradeBands} onSaved={reload} />}
          </div>
        </div>
      )}
      {mail && <MessagesModal kind="report" learnerIds={mail} term={term} title={`Report card e-mails · ${term}`} onClose={() => setMail(null)} />}
    </>
  );
}

export function ReportCard({ rc, school, bands, readOnly, onSaved }: { rc: RC; school: RCData['school']; bands: RCData['gradeBands']; readOnly?: boolean; onSaved?: () => void }) {
  const toast = useToast();
  const [tc, setTc] = useState(rc.teacherComment);
  const [pc, setPc] = useState(rc.principalComment);
  const saved = useRef({ teacherComment: rc.teacherComment, principalComment: rc.principalComment });
  const save = async (patch: Partial<typeof saved.current>) => {
    try { await api.put('/comments', { learnerId: rc.student.id, term: rc.term, ...patch }); saved.current = { ...saved.current, ...patch }; toast('Comment saved'); onSaved?.(); }
    catch (e: any) { toast(e.message, 'err'); }
  };
  const a = rc.attendance;
  return (
    <article className="report-card">
      <header className="rc-head">
        <div><h2>{school.name}</h2><div className="muted small">{school.address} · {school.contact}</div></div>
        <div className="rc-title">REPORT CARD<small>{rc.term}</small></div>
      </header>
      <div className="rc-meta">
        <div><span>Learner</span><b>{rc.student.name}</b></div>
        <div><span>Learner no</span><b>{rc.student.learnerNo}</b></div>
        <div><span>Class</span><b>{rc.classLabel}</b></div>
        <div><span>Class teacher</span><b>{rc.classTeacher}</b></div>
      </div>
      <table className="table rc-table">
        <thead><tr><th>Subject</th><th className="num">Mark</th><th className="num">Grade</th><th>Meaning</th><th className="num">Class avg</th><th className="num">Last term</th></tr></thead>
        <tbody>
          {rc.subjects.map((s) => (
            <tr key={s.subject}>
              <td>{s.subject}</td><td className="num"><b>{s.mark ?? '–'}</b></td><td className={`num band-${s.band}`}>{s.band}</td>
              <td className="muted">{s.meaning}</td><td className="num muted">{s.classAvg ?? '–'}</td><td className="num muted">{s.prev ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rc-summary">
        <div><span>Average</span><b>{num1(rc.avg)}</b><small>Grade {rc.band || '–'}</small></div>
        <div><span>Change</span><b>{signed(rc.chg)}</b><small>vs last term</small></div>
        <div><span>GPA</span><b>{rc.gpa ?? '–'}</b><small>{rc.gpaCumulative !== null && rc.gpaCumulative !== undefined ? `cumulative ${rc.gpaCumulative}` : 'this term'}</small></div>
        <div><span>Position</span><b>{rc.pos ?? '–'}</b><small>of {rc.classSize}</small></div>
        <div><span>Attendance</span><b>{pct(a.att)}</b><small>{a.present} of {a.taken} days · {a.late} late</small></div>
      </div>
      <div className="rc-comments">
        <label><span>Class teacher's comment</span>
          {readOnly || !rc.canEditTeacher ? <p>{tc || ' '}</p> : <textarea rows={3} value={tc} onChange={(e) => setTc(e.target.value)} onBlur={() => tc !== saved.current.teacherComment && save({ teacherComment: tc })} placeholder="Type a comment — it saves when you click away" />}
        </label>
        <label><span>Principal's comment · {school.principal}</span>
          {readOnly || !rc.canEditPrincipal ? <p>{pc || ' '}</p> : <textarea rows={2} value={pc} onChange={(e) => setPc(e.target.value)} onBlur={() => pc !== saved.current.principalComment && save({ principalComment: pc })} />}
        </label>
      </div>
      <footer className="rc-foot">
        <span>{bands.map((b) => `${b.band} ${b.from}+ ${b.meaning}`).join(' · ')}</span>
        {rc.nextTermStarts && <span>Next term starts {fmtDate(rc.nextTermStarts)}</span>}
      </footer>
    </article>
  );
}
