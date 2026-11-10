import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Select, useAction, useApi, useMeta, usePerms } from '../components/ui';
import { fmtDay, fmtLong } from '../format';

export interface Period { name: string; start: string; end: string }
interface Lesson { id: number; className: string; day: number; period: number; subject: string; teacher: string | null; room: string | null }
interface TT { days: string[]; periods: Period[]; teachers: string[]; classes: string[]; rooms: string[]; entries: Lesson[]; canEdit: boolean }

/** A days x periods grid. `cell` renders one slot. */
export function WeekGrid({ days, periods, cell }: { days: string[]; periods: Period[]; cell: (day: number, period: number) => React.ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="tt">
        <thead><tr><th />{days.map((d) => <th key={d}>{d}</th>)}</tr></thead>
        <tbody>
          {periods.map((p, i) => (
            <tr key={i}>
              <th><b>{p.name}</b><small>{p.start}–{p.end}</small></th>
              {days.map((_, d) => <td key={d}>{cell(d + 1, i)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Timetable() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') ?? 'week') as 'week' | 'cover' | 'exams';
  return (
    <>
      <PageHead title="Timetable" sub="Lessons, substitute cover and exams" />
      <div className="tabs" role="tablist">
        {([['week', 'Weekly timetable'], ['cover', 'Cover'], ['exams', 'Exams']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setSp({ tab: k }, { replace: true })}>{l}</button>
        ))}
      </div>
      {tab === 'week' ? <Week /> : tab === 'cover' ? <Cover /> : <Exams />}
    </>
  );
}

function Week() {
  const { meta } = useMeta();
  const perms = usePerms();
  const user = meta.user;
  const [view, setView] = useState<'class' | 'teacher' | 'room'>(user.role === 'teacher' && user.teacherName ? 'teacher' : 'class');
  const [who, setWho] = useState(view === 'teacher' ? user.teacherName ?? '' : perms.defaultClass);
  const { data, error, reload } = useApi<TT>(`/timetable${who ? qs({ [view]: who }) : ''}`);
  const [edit, setEdit] = useState<{ day: number; period: number; lesson?: Lesson } | null>(null);
  const [periods, setPeriods] = useState(false);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const options = view === 'class' ? data.classes : view === 'teacher' ? data.teachers : data.rooms;
  const at = (d: number, p: number) => data.entries.filter((e) => e.day === d && e.period === p);
  const editable = data.canEdit && view === 'class' && !!who;
  const lessons = data.entries.length;
  return (
    <Card title={`${view === 'class' ? 'Class' : view === 'teacher' ? 'Teacher' : 'Room'} ${who || ''}`} actions={<>
      <div className="seg">{(['class', 'teacher', 'room'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => { setView(v); setWho(''); }}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
      <Select value={who} onChange={setWho} options={options} placeholder={`Pick a ${view}…`} aria-label={view} />
      {data.canEdit && <button className="btn sm" onClick={() => setPeriods(true)}>Periods…</button>}
    </>}>
      {!who ? <Empty>Pick a {view}.</Empty> : (
        <>
          <WeekGrid days={data.days} periods={data.periods} cell={(d, p) => {
            const list = at(d, p);
            const body = list.map((l) => (
              <div key={l.id} className="tt-lesson">
                <b>{l.subject}</b>
                <small>{[view !== 'class' && l.className, view !== 'teacher' && l.teacher, view !== 'room' && l.room].filter(Boolean).join(' · ')}</small>
              </div>
            ));
            return editable
              ? <button className={`tt-cell ${list.length ? '' : 'empty'}`} onClick={() => setEdit({ day: d, period: p, lesson: list[0] })} aria-label={`${data.days[d - 1]} period ${data.periods[p].name}`}>{body.length ? body : <span>+</span>}</button>
              : <div className="tt-cell">{body}</div>;
          }} />
          <p className="muted small">{lessons} lesson{lessons === 1 ? '' : 's'} a week{editable ? ' · click a slot to set or clear it; the app refuses a teacher or room being in two places at once' : ''}.</p>
        </>
      )}
      {edit && <SlotModal tt={data} cls={who} {...edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {periods && <PeriodsModal periods={data.periods} onClose={() => setPeriods(false)} onSaved={() => { setPeriods(false); reload(); }} />}
    </Card>
  );
}

function SlotModal({ tt, cls, day, period, lesson, onClose, onSaved }: { tt: TT; cls: string; day: number; period: number; lesson?: Lesson; onClose: () => void; onSaved: () => void }) {
  const { meta } = useMeta();
  const room0 = lesson?.room ?? '';
  const [f, setF] = useState({ subject: lesson?.subject ?? '', teacher: lesson?.teacher ?? '', room: room0 });
  const { busy, run } = useAction();
  const save = async (clear = false) => {
    if (await run(() => api.put('/timetable/slot', { className: cls, day, period, ...(clear ? { subject: '' } : f) }), clear ? 'Lesson cleared' : 'Lesson saved') !== undefined) onSaved();
  };
  return (
    <Modal title={`${cls} · ${tt.days[day - 1]} · period ${tt.periods[period].name} (${tt.periods[period].start}–${tt.periods[period].end})`} onClose={onClose} footer={<>
      {lesson && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => save(true)}>Clear</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.subject} onClick={() => save()}>Save</button>
    </>}>
      <div className="form-grid">
        <Field label="Subject *"><Select value={f.subject} onChange={(v) => setF({ ...f, subject: v })} options={[...meta.settings.subjects, 'Break', 'Assembly', 'Study']} placeholder="Pick…" /></Field>
        <Field label="Teacher"><Select value={f.teacher} onChange={(v) => setF({ ...f, teacher: v })} options={tt.teachers} placeholder="–" /></Field>
        <Field label="Room"><input list="rooms" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} /></Field>
        <datalist id="rooms">{tt.rooms.map((r) => <option key={r} value={r} />)}</datalist>
      </div>
    </Modal>
  );
}

function PeriodsModal({ periods, onClose, onSaved }: { periods: Period[]; onClose: () => void; onSaved: () => void }) {
  const [list, setList] = useState(periods);
  const { busy, run } = useAction();
  const set = (i: number, p: Partial<Period>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Modal title="The school day's periods" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => api.put('/timetable/periods', { periods: list }), 'Periods saved')) onSaved(); }}>Save</button>
    </>}>
      <table className="table rows-editor">
        <thead><tr><th>Period</th><th>Starts</th><th>Ends</th><th /></tr></thead>
        <tbody>{list.map((p, i) => (
          <tr key={i}>
            <td><input value={p.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Period name" /></td>
            <td><input type="time" value={p.start} onChange={(e) => set(i, { start: e.target.value })} aria-label="Starts" /></td>
            <td><input type="time" value={p.end} onChange={(e) => set(i, { end: e.target.value })} aria-label="Ends" /></td>
            <td><button className="icon-btn" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="Remove">×</button></td>
          </tr>
        ))}</tbody>
      </table>
      <button className="btn sm" onClick={() => setList([...list, { name: String(list.length + 1), start: list[list.length - 1]?.end ?? '08:00', end: list[list.length - 1]?.end ?? '08:40' }])}>+ Add period</button>
      <p className="muted small">Breaks are simply gaps between periods.</p>
    </Modal>
  );
}

// ------------------------------------------------------------ cover
function Cover() {
  const { meta } = useMeta();
  const [date, setDate] = useState(meta.today);
  const { data, error, reload, setData } = useApi<any>(`/covers?date=${date}`);
  const [absent, setAbsent] = useState('');
  const { busy, run } = useAction();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const mark = () => run(async () => { setData(await api.post('/covers/absent', { date, teacher: absent })); setAbsent(''); }, `${absent} marked absent`);
  const assign = (id: number, sub: string) => run(async () => setData(await api.put(`/covers/${id}`, { substitute: sub })), sub ? `${sub} will cover` : 'Substitute removed');
  const unmark = (t: string) => run(async () => { if (confirm(`${t} is not absent after all?`)) setData(await api.del(`/covers/absent?date=${date}&teacher=${encodeURIComponent(t)}`)); });
  const missing = data.covers.filter((c: any) => !c.substitute).length;
  return (
    <Card title={`Cover · ${fmtLong(date)}`} actions={<>
      <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" style={{ width: 'auto' }} />
      {data.canEdit && <>
        <Select value={absent} onChange={setAbsent} options={data.teachers.filter((t: string) => !data.absent.includes(t))} placeholder="Teacher absent…" aria-label="Absent teacher" />
        <button className="btn primary sm" disabled={!absent || busy} onClick={mark}>Mark absent</button>
      </>}
    </>} pad={false}>
      {data.holiday && <div className="callout">{data.holiday}</div>}
      {data.day > 5 ? <Empty>That's a weekend.</Empty> : !data.covers.length ? <Empty>Nobody is marked absent{data.canEdit ? '. Pick a teacher above when someone is off' : ''}.</Empty> : (
        <>
          <div className="pad-x">{data.absent.map((t: string) => <span key={t} className="pill warn" style={{ marginRight: 6 }}>{t} absent{data.canEdit && <button className="icon-btn" aria-label={`${t} not absent`} onClick={() => unmark(t)}>×</button>}</span>)}
            {missing > 0 && <span className="pill bad">{missing} lesson{missing === 1 ? '' : 's'} still need cover</span>}</div>
          <table className="table compact">
            <thead><tr><th>Period</th><th>Class</th><th>Lesson</th><th>Absent</th><th>Covered by</th></tr></thead>
            <tbody>{data.covers.map((c: any) => (
              <tr key={c.id} className={c.substitute ? '' : 'needs'}>
                <td>{c.lesson ? `${data.periods[c.lesson.period]?.name} (${data.periods[c.lesson.period]?.start})` : '–'}</td>
                <td>{c.lesson?.className}</td><td>{c.lesson?.subject}{c.lesson?.room ? ` · ${c.lesson.room}` : ''}</td><td>{c.absentTeacher}</td>
                <td>{data.canEdit
                  ? <Select value={c.substitute ?? ''} onChange={(v) => assign(c.id, v)} options={c.free} placeholder="– needs cover –" aria-label="Substitute" />
                  : c.substitute ?? <span className="bad-text">needs cover</span>}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="muted small pad-x">Only teachers who are free in that period (not teaching, covering or absent) are offered.</p>
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ exams
interface Exam { id?: number; term: string; className: string; subject: string; title: string; date: string; start: string; end: string; room: string; invigilator: string; notes: string }
function Exams() {
  const { meta } = useMeta();
  const [term, setTerm] = useState(meta.term);
  const [cls, setCls] = useState('');
  const { data, error, reload } = useApi<{ items: Exam[]; canEdit: boolean; teachers: string[] }>(`/exams${qs({ term, class: cls })}`);
  const [edit, setEdit] = useState<Partial<Exam> | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const byDate = data.items.reduce<Record<string, Exam[]>>((a, e) => ((a[e.date] ??= []).push(e), a), {});
  return (
    <Card title={`Exams · ${term}`} pad={false} actions={<>
      <Select value={term} onChange={setTerm} options={meta.settings.terms.map((t) => t.name)} aria-label="Term" />
      <Select value={cls} onChange={setCls} options={meta.classes} placeholder="All classes" aria-label="Class" />
      <button className="btn sm" onClick={() => window.print()}>Print</button>
      {data.canEdit && <button className="btn primary sm" onClick={() => setEdit({ term, className: cls || meta.classes[0], subject: '', title: 'Term exam', date: '', start: '09:00', end: '10:30', room: '', invigilator: '', notes: '' })}>+ Exam</button>}
    </>}>
      {!data.items.length ? <Empty>No exams scheduled.</Empty> : (
        <div className="print-area">
          <table className="table compact">
            <thead><tr><th>Date</th><th>Time</th><th>Class</th><th>Subject</th><th>Room</th><th>Invigilator</th></tr></thead>
            <tbody>{Object.entries(byDate).flatMap(([d, list]) => list.map((e, i) => (
              <tr key={e.id} className={data.canEdit ? 'clickable' : ''} onClick={() => data.canEdit && setEdit(e)}>
                <td>{i === 0 ? <b>{fmtDay(d)}</b> : ''}</td><td className="nowrap">{e.start}–{e.end}</td><td>{e.className}</td>
                <td>{e.subject}{e.title ? <span className="muted"> · {e.title}</span> : ''}</td><td>{e.room}</td><td>{e.invigilator}</td>
              </tr>
            )))}</tbody>
          </table>
        </div>
      )}
      {edit && <ExamModal e={edit} teachers={data.teachers} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </Card>
  );
}

function ExamModal({ e, teachers, onClose, onSaved }: { e: Partial<Exam>; teachers: string[]; onClose: () => void; onSaved: () => void }) {
  const { meta } = useMeta();
  const [f, setF] = useState(e);
  const { busy, run } = useAction();
  const set = (p: Partial<Exam>) => setF((x) => ({ ...x, ...p }));
  const save = async () => { if (await run(() => (f.id ? api.put(`/exams/${f.id}`, f) : api.post('/exams', f)), 'Exam saved')) onSaved(); };
  const del = async () => { if (confirm('Cancel this exam?') && (await run(() => api.del(`/exams/${f.id}`), 'Exam cancelled'))) onSaved(); };
  return (
    <Modal title={f.id ? 'Edit exam' : 'Schedule an exam'} onClose={onClose} footer={<>
      {f.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Cancel exam</button>}
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn primary" disabled={busy} onClick={save}>Save</button>
    </>}>
      <div className="form-grid">
        <Field label="Term"><Select value={f.term ?? ''} onChange={(v) => set({ term: v })} options={meta.settings.terms.map((t) => t.name)} /></Field>
        <Field label="Class *"><Select value={f.className ?? ''} onChange={(v) => set({ className: v })} options={meta.classes} /></Field>
        <Field label="Subject *"><Select value={f.subject ?? ''} onChange={(v) => set({ subject: v })} options={meta.settings.subjects} placeholder="Pick…" /></Field>
        <Field label="Title"><input value={f.title ?? ''} onChange={(x) => set({ title: x.target.value })} /></Field>
        <Field label="Date *"><input type="date" value={f.date ?? ''} onChange={(x) => set({ date: x.target.value })} /></Field>
        <Field label="Starts *"><input type="time" value={f.start ?? ''} onChange={(x) => set({ start: x.target.value })} /></Field>
        <Field label="Ends *"><input type="time" value={f.end ?? ''} onChange={(x) => set({ end: x.target.value })} /></Field>
        <Field label="Room"><input value={f.room ?? ''} onChange={(x) => set({ room: x.target.value })} /></Field>
        <Field label="Invigilator"><Select value={f.invigilator ?? ''} onChange={(v) => set({ invigilator: v })} options={teachers} placeholder="–" /></Field>
        <Field label="Notes" wide><input value={f.notes ?? ''} onChange={(x) => set({ notes: x.target.value })} /></Field>
      </div>
      <p className="muted small">The app refuses a class, room or invigilator with two exams at the same time.</p>
    </Modal>
  );
}
