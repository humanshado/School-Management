import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { PaymentModal, PlanModal, ReceiptModal } from '../components/Payments';
import { BarChart, Card, Empty, ErrorBox, Field, Flags, Loading, MessagesModal, PageHead, Select, useAction, useApi, useMeta, usePerms } from '../components/ui';
import { fmtDate, fmtShort, markClass, money, num1, pct, signed } from '../format';
import type { Student, StudentStats } from '../types';

const BLANK: Partial<Student> = {
  learnerNo: '', firstName: '', lastName: '', className: '', dob: '', gender: '', status: 'Active', enrolmentDate: '', optionalFees: '',
  guardianName: '', relationship: '', guardianPhone: '', guardianEmail: '', address: '', medicalNote: '', notes: '',
};

export default function Students() {
  const { id } = useParams();
  const nav = useNavigate();
  const { meta } = useMeta();
  const perms = usePerms();
  const { data, error, reload } = useApi<Student[]>('/students');
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('');
  const [status, setStatus] = useState('Active');
  const [adding, setAdding] = useState(false);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data ?? []).filter((s) =>
      (!cls || s.className === cls) && (!status || (s.status || 'Active') === status) &&
      (!t || [s.firstName, s.lastName, `${s.firstName} ${s.lastName}`, s.learnerNo, s.guardianName, s.guardianPhone, s.notes].some((v) => v?.toLowerCase().includes(t))));
  }, [data, q, cls, status]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const selected = id ? +id : null;

  return (
    <>
      <PageHead title="Students" sub={`${data.filter((s) => (s.status || 'Active') === 'Active').length} active learners`}>
        {perms.admin && <button className="btn primary" onClick={() => { setAdding(true); nav('/students'); }}>+ Add learner</button>}
      </PageHead>
      <div className="split">
        <Card className="list-card" pad={false}>
          <div className="filters">
            <input type="search" placeholder="Search name, learner no, guardian…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <Select value={cls} onChange={setCls} options={meta.classes} placeholder="All classes" aria-label="Class" />
            <Select value={status} onChange={setStatus} options={meta.settings.studentStatuses} placeholder="Any status" aria-label="Status" />
          </div>
          <div className="table-wrap list-scroll">
            <table className="table compact hover">
              <thead><tr><th>Name</th><th>Class</th><th className="num">Att.</th><th className="num">Avg</th>{perms.showFees && <th className="num">Balance</th>}<th>Flags</th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className={s.id === selected ? 'sel' : ''} onClick={() => { setAdding(false); nav(`/students/${s.id}`); }}>
                    <td><b>{s.firstName} {s.lastName}</b><div className="muted small">{s.learnerNo}</div></td>
                    <td>{s.className}</td>
                    <td className="num">{pct(s.stats?.att)}</td>
                    <td className="num">{s.stats?.avg == null ? '–' : Math.round(s.stats.avg)}</td>
                    {perms.showFees && <td className={`num ${s.stats?.overdue ? 'bad-text' : ''}`}>{s.stats?.balance ? money(meta.settings, s.stats.balance) : '–'}</td>}
                    <td><Flags n={s.stats?.flags ?? 0} max={meta.settings.useFees ? 3 : 2} reasons={s.stats?.reasons} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <Empty>No learners match.</Empty>}
          </div>
          <div className="list-foot muted small">{list.length} shown</div>
        </Card>
        <div className="detail">
          {adding && perms.admin ? <StudentForm initial={{ ...BLANK, className: cls || meta.classes[0] || '', enrolmentDate: meta.today }} onDone={(s) => { setAdding(false); reload(); if (s) nav(`/students/${s.id}`); }} />
            : selected ? <Profile key={selected} id={selected} onChanged={reload} onDeleted={() => { reload(); nav('/students'); }} />
            : <Card><Empty>Pick a learner on the left{perms.admin ? ', or add a new one' : ''}.</Empty></Card>}
        </div>
      </div>
    </>
  );
}

function StudentForm({ initial, onDone }: { initial: Partial<Student>; onDone: (s?: Student) => void }) {
  const { meta, reload: reloadMeta } = useMeta();
  const s = meta.settings;
  const [f, setF] = useState<Partial<Student>>(initial);
  const { busy, run } = useAction();
  const set = (patch: Partial<Student>) => setF((x) => ({ ...x, ...patch }));
  const toggleFee = (name: string) => {
    const cur = (f.optionalFees ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const has = cur.some((x) => x.toLowerCase() === name.toLowerCase());
    set({ optionalFees: (has ? cur.filter((x) => x.toLowerCase() !== name.toLowerCase()) : [...cur, name]).join(', ') });
  };
  const save = async () => {
    const r = await run<Student>(() => (f.id ? api.put(`/students/${f.id}`, f) : api.post('/students', f)), f.id ? 'Learner saved' : 'Learner added');
    if (r) { reloadMeta(); onDone(r); }
  };
  const fees = (f.optionalFees ?? '').toLowerCase().split(',').map((x) => x.trim());
  return (
    <Card title={f.id ? 'Edit learner' : 'New learner'} actions={<>
      <button className="btn" onClick={() => onDone()}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="First name *"><input value={f.firstName ?? ''} onChange={(e) => set({ firstName: e.target.value })} autoFocus required /></Field>
        <Field label="Last name *"><input value={f.lastName ?? ''} onChange={(e) => set({ lastName: e.target.value })} required /></Field>
        <Field label="Class *"><Select value={f.className ?? ''} onChange={(v) => set({ className: v })} options={meta.classes} placeholder="Pick…" /></Field>
        <Field label="Learner no" hint={f.id ? undefined : 'Left blank: made from the class'}><input value={f.learnerNo ?? ''} onChange={(e) => set({ learnerNo: e.target.value })} /></Field>
        <Field label="Date of birth"><input type="date" value={f.dob ?? ''} onChange={(e) => set({ dob: e.target.value })} /></Field>
        <Field label="Gender"><Select value={f.gender ?? ''} onChange={(v) => set({ gender: v })} options={s.genders} placeholder="–" /></Field>
        <Field label="Status"><Select value={f.status ?? 'Active'} onChange={(v) => set({ status: v })} options={s.studentStatuses} /></Field>
        <Field label="Enrolment date"><input type="date" value={f.enrolmentDate ?? ''} onChange={(e) => set({ enrolmentDate: e.target.value })} /></Field>
        {s.useFees && s.optionalFees.length > 0 && (
          <Field label="Optional fees" wide>
            <div className="checks">{s.optionalFees.map((o) => (
              <label key={o.name} className="check"><input type="checkbox" checked={fees.includes(o.name.toLowerCase())} onChange={() => toggleFee(o.name)} /> {o.name} <span className="muted">({money(s, o.amount)})</span></label>
            ))}</div>
          </Field>
        )}
        <h3 className="form-sec">Guardian</h3>
        <Field label="Guardian name"><input value={f.guardianName ?? ''} onChange={(e) => set({ guardianName: e.target.value })} /></Field>
        <Field label="Relationship"><Select value={f.relationship ?? ''} onChange={(v) => set({ relationship: v })} options={s.relationships} placeholder="–" /></Field>
        <Field label="Phone"><input type="tel" value={f.guardianPhone ?? ''} onChange={(e) => set({ guardianPhone: e.target.value })} /></Field>
        <Field label="E-mail"><input type="email" value={f.guardianEmail ?? ''} onChange={(e) => set({ guardianEmail: e.target.value })} /></Field>
        <Field label="Address" wide><input value={f.address ?? ''} onChange={(e) => set({ address: e.target.value })} /></Field>
        <h3 className="form-sec">Other</h3>
        <Field label="Medical note" wide><input value={f.medicalNote ?? ''} onChange={(e) => set({ medicalNote: e.target.value })} /></Field>
        <Field label="Notes" wide><textarea rows={3} value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <button type="submit" hidden />
      </form>
    </Card>
  );
}

interface ProfileData {
  student: Student; stats: StudentStats; subjects: { subject: string; mark: number | null; classAvg: number | null }[];
  weeks: { label: string; pct: number }[]; lastDays: { date: string; mark: string; note: string }[];
  absences: { id: number; date: string; mark: string; note: string }[];
  payments: any[]; plans: any[]; comments: any[];
}

function Profile({ id, onChanged, onDeleted }: { id: number; onChanged: () => void; onDeleted: () => void }) {
  const { meta, reload: reloadMeta } = useMeta();
  const s = meta.settings;
  const perms = usePerms();
  const { data, error, reload } = useApi<ProfileData>(`/students/${id}`);
  const [tabPick, setTab] = useState<'glance' | 'details' | 'attendance' | 'fees'>(() => { try { return (localStorage.getItem('student.tab') as any) || 'glance'; } catch { return 'glance'; } });
  const [editing, setEditing] = useState(false);
  const [pay, setPay] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [receipt, setReceipt] = useState<number | null>(null);
  const [mail, setMail] = useState(false);
  const { run } = useAction();
  const tab = tabPick === 'fees' && !perms.showFees ? 'glance' : tabPick;
  useEffect(() => { try { localStorage.setItem('student.tab', tabPick); } catch { /* ignore */ } }, [tabPick]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const st = data.student, x = data.stats;
  const refresh = () => { reload(); onChanged(); reloadMeta(); };
  if (editing) return <StudentForm initial={st} onDone={(r) => { setEditing(false); if (r) refresh(); }} />;
  const del = () => run(async () => {
    if (!confirm(`Delete ${st.firstName} ${st.lastName} and all of their attendance, marks, payments and comments? This cannot be undone.\n\nTip: to keep the history, set their status to "Left" instead.`)) return;
    await api.del(`/students/${st.id}`);
    reloadMeta();
    onDeleted();
  }, 'Learner deleted');

  return (
    <>
      <Card className="profile-card">
        <div className="profile">
          <div className="avatar" aria-hidden>{(st.firstName?.[0] ?? '') + (st.lastName?.[0] ?? '')}</div>
          <div className="profile-main">
            <h2>{st.firstName} {st.lastName} {st.status !== 'Active' && <span className="pill">{st.status}</span>}</h2>
            <div className="muted">{st.learnerNo} · <Link to="/classes">{st.className}</Link>{x.pos ? ` · position ${x.pos} in class` : ''}</div>
            {st.medicalNote && <div className="pill warn" style={{ marginTop: 6 }}>Medical: {st.medicalNote}</div>}
          </div>
          <div className="profile-actions">
            {perms.admin && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
            {x.active && <button className="btn" onClick={() => setMail(true)}>E-mail guardian</button>}
            {perms.teach && <Link className="btn" to={`/report-cards?learner=${st.id}&class=${encodeURIComponent(st.className)}`}>Report card</Link>}
          </div>
        </div>
        <div className="mini-kpis">
          <div><span>Attendance</span><b className={x.reasons.includes('attendance') ? 'bad-text' : ''}>{pct(x.att)}</b><small>{x.absent} absent · {x.late} late</small></div>
          <div><span>Term average</span><b>{num1(x.avg)}</b><small className={x.reasons.includes('grades') ? 'bad-text' : ''}>{signed(x.chg)} vs last term</small></div>
          {perms.showFees && <div><span>Balance</span><b className={x.overdue ? 'bad-text' : ''}>{money(s, x.balance)}</b><small>{x.feeStatus || '–'}</small></div>}
          <div><span>Flags</span><b><Flags n={x.flags} max={s.useFees ? 3 : 2} /></b><small>{x.reasons.join(', ') || 'none'}</small></div>
        </div>
      </Card>

      <div className="tabs" role="tablist">
        {([['glance', 'Term at a glance'], ['details', 'Details'], ['attendance', 'Attendance'], ...(perms.showFees ? [['fees', 'Fees']] : [])] as [typeof tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'glance' && (
        <div className="grid g2">
          <Card title="Marks by subject" pad={false}>
            <table className="table compact">
              <thead><tr><th>Subject</th><th className="num">Mark</th><th className="num">Class avg</th><th style={{ width: '40%' }} /></tr></thead>
              <tbody>
                {data.subjects.map((r) => (
                  <tr key={r.subject}>
                    <td>{r.subject}</td>
                    <td className="num"><b>{r.mark ?? '–'}</b></td>
                    <td className="num muted">{num1(r.classAvg)}</td>
                    <td>{r.mark !== null && <div className="cmp-bar"><span style={{ width: `${r.mark}%` }} className={r.classAvg !== null && r.mark < r.classAvg ? 'below' : ''} />{r.classAvg !== null && <i style={{ left: `${r.classAvg}%` }} title="class average" />}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Attendance by week">
            <BarChart data={data.weeks.map((w) => ({ label: w.label, value: w.pct }))} threshold={s.riskAttendance * 100} min={0} />
            <h3 className="sub-h">Last 10 school days</h3>
            <div className="last10">{data.lastDays.map((d) => <span key={d.date} className={`day ${markClass(d.mark)}`} title={d.note}><b>{d.mark}</b><small>{fmtShort(d.date)}</small></span>)}</div>
          </Card>
        </div>
      )}

      {tab === 'details' && (
        <Card title="Details" actions={perms.admin ? <><button className="btn" onClick={() => setEditing(true)}>Edit</button><button className="btn danger" onClick={del}>Delete</button></> : undefined}>
          <dl className="dl">
            <dt>Date of birth</dt><dd>{fmtDate(st.dob) || '–'}</dd>
            <dt>Gender</dt><dd>{st.gender || '–'}</dd>
            <dt>Enrolled</dt><dd>{fmtDate(st.enrolmentDate) || '–'}</dd>
            <dt>Optional fees</dt><dd>{st.optionalFees || '–'}</dd>
            <dt>Guardian</dt><dd>{st.guardianName || '–'}{st.relationship ? ` (${st.relationship})` : ''}</dd>
            <dt>Phone</dt><dd>{st.guardianPhone ? <a href={`tel:${st.guardianPhone}`}>{st.guardianPhone}</a> : '–'}</dd>
            <dt>E-mail</dt><dd>{st.guardianEmail ? <a href={`mailto:${st.guardianEmail}`}>{st.guardianEmail}</a> : '–'}</dd>
            <dt>Address</dt><dd>{st.address || '–'}</dd>
            <dt>Medical</dt><dd>{st.medicalNote || '–'}</dd>
            <dt>Notes</dt><dd className="pre">{st.notes || '–'}</dd>
          </dl>
        </Card>
      )}

      {tab === 'attendance' && (
        <Card title={`Absences and lates · ${meta.term}`} pad={false}>
          {data.absences.length === 0 ? <Empty>Present every day this term.</Empty> : (
            <table className="table compact">
              <thead><tr><th>Date</th><th>Mark</th><th>Note</th></tr></thead>
              <tbody>{data.absences.map((a) => <tr key={a.id}><td>{fmtDate(a.date)}</td><td><span className={`dot ${markClass(a.mark)}`}>{a.mark}</span></td><td>{a.note || <span className="muted">–</span>}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'fees' && perms.showFees && (
        <div className="grid g2">
          <Card title="Payments" pad={false} actions={<button className="btn sm primary" onClick={() => setPay({ studentId: st.id, paidBy: st.guardianName ? `Guardian · ${st.guardianName.split(' ')[0]}` : '' })}>Record payment</button>}>
            <div className="fee-sum muted small pad-x">{meta.term}: billed {money(s, x.billed)} · paid {money(s, x.paid)} · balance <b>{money(s, x.balance)}</b></div>
            {data.payments.length === 0 ? <Empty>No payments yet.</Empty> : (
              <table className="table compact hover">
                <thead><tr><th>Receipt</th><th>Date</th><th>Term</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>{data.payments.map((p) => (
                  <tr key={p.id} onClick={() => setReceipt(p.id)}>
                    <td>{p.receiptNo}</td><td>{fmtDate(p.date)}</td><td>{p.term}</td><td className="num">{money(s, p.amount)}</td>
                    <td className="right"><button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setPay(p); }}>Edit</button></td>
                  </tr>))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Payment plans" pad={false} actions={<button className="btn sm" onClick={() => setPlan({ studentId: st.id })}>New plan</button>}>
            {data.plans.length === 0 ? <Empty>No payment plan.</Empty> : (
              <table className="table compact">
                <thead><tr><th>Term</th><th>Agreed</th><th className="num">Instalment</th><th>Next due</th><th /></tr></thead>
                <tbody>{data.plans.map((p) => (
                  <tr key={p.id}><td>{p.term}</td><td>{fmtDate(p.agreedOn)}</td><td className="num">{money(s, p.instalment)}</td><td>{fmtDate(p.nextDue)}</td>
                    <td className="right"><button className="btn sm ghost" onClick={() => setPlan(p)}>Edit</button>
                      <button className="btn sm ghost" onClick={() => run(async () => { if (confirm('Delete this payment plan?')) { await api.del(`/paymentPlans/${p.id}`); refresh(); } })}>Delete</button></td></tr>))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {pay && <PaymentModal initial={pay} onClose={() => setPay(null)} onSaved={(p) => { setPay(null); refresh(); if (!pay.id) setReceipt(p.id); }} />}
      {plan && <PlanModal initial={plan} onClose={() => setPlan(null)} onSaved={() => { setPlan(null); refresh(); }} />}
      {receipt && <ReceiptModal id={receipt} onClose={() => setReceipt(null)} />}
      {mail && <MessagesModal kind="risk" learnerIds={[st.id]} title={`E-mail ${st.guardianName || 'guardian'}`} onClose={() => setMail(false)} />}
    </>
  );
}
