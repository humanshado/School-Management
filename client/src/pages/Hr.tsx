import { useEffect, useState } from 'react';
import { api } from '../api';
import Files from '../components/Files';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Select, useAction, useApi, useMeta, usePerms } from '../components/ui';
import { fmtDate, fmtShort, money } from '../format';
import type { FileDoc } from '../types';

type PayItem = { name: string; kind: 'allowance' | 'deduction'; method: 'fixed' | 'percent'; amount: number | null };
interface Staff { id: number; name: string; position: string; department: string; phone: string; email: string; hireDate: string | null; status: string; teacherName: string | null; bankName: string; bankAccount: string; baseSalary: number | null; payItems: string | null; notes: string; leaveDaysThisYear: number; files: FileDoc[]; items: PayItem[] }
const LEAVE_TYPES = ['Annual', 'Sick', 'Maternity / paternity', 'Compassionate', 'Study', 'Unpaid', 'Other'];
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function Hr() {
  const [tab, setTab] = useState<'staff' | 'register' | 'leave' | 'payroll'>('staff');
  return (
    <>
      <PageHead title="Staff & payroll" sub="Private: only admins and the bursar can open this" />
      <div className="tabs" role="tablist">
        {([['staff', 'Staff'], ['register', 'Staff register'], ['leave', 'Leave'], ['payroll', 'Payroll']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'staff' ? <StaffTab /> : tab === 'register' ? <Register /> : tab === 'leave' ? <Leave /> : <Payroll />}
    </>
  );
}

// ------------------------------------------------------------ staff
function StaffTab() {
  const { meta } = useMeta();
  const s = meta.settings;
  const { data, error, reload } = useApi<Staff[]>('/staff');
  const [edit, setEdit] = useState<Partial<Staff> | null>(null);
  const { run } = useAction();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const active = data.filter((x) => x.status !== 'Left');
  return (
    <Card pad={false} title={`${active.length} staff · monthly base pay ${money(s, active.reduce((a, x) => a + (x.baseSalary ?? 0), 0))}`} actions={<>
      <button className="btn sm" onClick={() => run(async () => { const r = await api.post('/staff/from-teachers'); reload(); return r; }, 'Teachers added as staff')}>Add all teachers</button>
      <button className="btn sm primary" onClick={() => setEdit({ name: '', position: '', department: '', status: 'Active', baseSalary: null, payItems: null })}>+ Staff</button>
    </>}>
      {!data.length ? <Empty>No staff records yet. "Add all teachers" creates one for each teacher.</Empty> : (
        <div className="table-wrap">
          <table className="table compact hover">
            <thead><tr><th>Name</th><th>Position</th><th>Department</th><th>Started</th><th className="num">Base pay</th><th className="num">Leave this year</th><th>Status</th></tr></thead>
            <tbody>{data.map((x) => (
              <tr key={x.id} onClick={() => setEdit(x)} className={x.status === 'Left' ? 'muted' : ''}>
                <td><b>{x.name}</b></td><td>{x.position}</td><td>{x.department}</td><td>{fmtShort(x.hireDate)}</td>
                <td className="num">{x.baseSalary ? money(s, x.baseSalary) : <span className="muted">–</span>}</td><td className="num">{x.leaveDaysThisYear || ''}</td>
                <td><span className={`pill ${x.status === 'Active' ? 'ok' : x.status === 'Left' ? '' : 'warn'}`}>{x.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {edit && <StaffModal x={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </Card>
  );
}

function StaffModal({ x, onClose, onSaved }: { x: Partial<Staff>; onClose: () => void; onSaved: () => void }) {
  const { meta } = useMeta();
  const [f, setF] = useState(x);
  const [own, setOwn] = useState<PayItem[]>(() => { try { return x.payItems ? JSON.parse(x.payItems) : []; } catch { return []; } });
  const { busy, run } = useAction();
  const set = (p: Partial<Staff>) => setF((v) => ({ ...v, ...p }));
  const save = async () => { if (await run(() => { const b = { ...f, payItems: own.length ? own : null }; return f.id ? api.put(`/staff/${f.id}`, b) : api.post('/staff', b); }, 'Saved')) onSaved(); };
  const del = async () => { if (confirm(`Delete ${f.name}'s record? (Someone who has left: set the status to "Left" instead.)`) && (await run(() => api.del(`/staff/${f.id}`), 'Deleted'))) onSaved(); };
  const school = meta.settings.payItems ?? [];
  const setItem = (i: number, p: Partial<PayItem>) => setOwn(own.map((o, j) => (j === i ? { ...o, ...p } : o)));
  return (
    <Modal wide title={f.id ? x.name! : 'New staff member'} onClose={onClose} footer={<>
      {f.id && meta.perms.admin && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button>
    </>}>
      <div className="form-grid">
        <Field label="Name *"><input value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
        <Field label="Position"><input value={f.position ?? ''} onChange={(e) => set({ position: e.target.value })} placeholder="Teacher, Driver, Cook…" /></Field>
        <Field label="Department"><input value={f.department ?? ''} onChange={(e) => set({ department: e.target.value })} /></Field>
        <Field label="Status"><Select value={f.status ?? 'Active'} onChange={(v) => set({ status: v })} options={['Active', 'On leave', 'Left']} /></Field>
        <Field label="Phone"><input value={f.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="E-mail"><input value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Started"><input type="date" value={f.hireDate ?? ''} onChange={(e) => set({ hireDate: e.target.value })} /></Field>
        <Field label="Teacher record"><Select value={f.teacherName ?? ''} onChange={(v) => set({ teacherName: v || null })} options={meta.teachers} placeholder="–" /></Field>
        <h3 className="form-sec">Pay</h3>
        <Field label="Base pay (monthly)"><input type="number" min="0" step="any" value={f.baseSalary ?? ''} onChange={(e) => set({ baseSalary: e.target.value === '' ? null : +e.target.value })} /></Field>
        <Field label="Bank"><input value={f.bankName ?? ''} onChange={(e) => set({ bankName: e.target.value })} /></Field>
        <Field label="Account number"><input value={f.bankAccount ?? ''} onChange={(e) => set({ bankAccount: e.target.value })} /></Field>
        <Field label="Pay items" wide hint={`School items: ${school.map((i) => `${i.name} ${i.method === 'percent' ? `${i.amount}%` : i.amount}`).join(', ') || 'none (Payroll tab)'}. Add an item with the same name to change it for this person, or set its amount empty to leave it out.`}>
          <table className="table rows-editor">
            <tbody>{own.map((o, i) => (
              <tr key={i}>
                <td><input value={o.name} list="pay-items" onChange={(e) => setItem(i, { name: e.target.value })} aria-label="Item" /></td>
                <td><Select value={o.kind} onChange={(v) => setItem(i, { kind: v as PayItem['kind'] })} options={['allowance', 'deduction']} /></td>
                <td><Select value={o.method} onChange={(v) => setItem(i, { method: v as PayItem['method'] })} options={[{ value: 'fixed', label: 'fixed' }, { value: 'percent', label: '% of base' }]} /></td>
                <td><input type="number" min="0" step="any" value={o.amount ?? ''} placeholder="leave out" onChange={(e) => setItem(i, { amount: e.target.value === '' ? null : +e.target.value })} aria-label="Amount" /></td>
                <td><button className="icon-btn" onClick={() => setOwn(own.filter((_, j) => j !== i))} aria-label="Remove">×</button></td>
              </tr>
            ))}</tbody>
          </table>
          <datalist id="pay-items">{school.map((i) => <option key={i.name} value={i.name} />)}</datalist>
          <button className="btn sm" type="button" onClick={() => setOwn([...own, { name: '', kind: 'allowance', method: 'fixed', amount: 0 }])}>+ Pay item for this person</button>
        </Field>
        <Field label="Notes" wide><textarea rows={2} value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
      {f.id && <><h3 className="form-sec">Documents (contract, ID, certificates)</h3><Files ownerType="staff" ownerId={f.id} files={x.files ?? []} editable onChange={onSaved} /></>}
    </Modal>
  );
}

// ------------------------------------------------------------ staff register
function Register() {
  const { meta } = useMeta();
  const [date, setDate] = useState(meta.today);
  const { data, error, reload } = useApi<any>(`/staff-attendance?date=${date}`);
  const [marks, setMarks] = useState<Record<number, string>>({});
  const { busy, run } = useAction();
  const sum = useApi<any>(`/staff-attendance/summary?month=${date.slice(0, 7)}`);
  useEffect(() => { if (data) setMarks(Object.fromEntries(data.staff.map((x: any) => [x.id, x.mark]))); }, [data]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="grid g2">
      <Card title={`Staff register · ${fmtDate(date)}`} actions={<input type="date" value={date} max={meta.today} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 'auto' }} aria-label="Date" />} pad={false}>
        {data.holiday && <div className="callout">{data.holiday}</div>}
        {!data.staff.length ? <Empty>No staff records yet.</Empty> : <>
          <table className="table compact"><tbody>{data.staff.map((x: any) => (
            <tr key={x.id}><td><b>{x.name}</b><div className="muted small">{x.position}</div></td>
              <td><div className="mark-toggle">{['P', 'A', 'L', 'LV'].map((k) => (
                <button key={k} className={marks[x.id] === k ? `on ${k === 'P' ? 'm-p' : k === 'A' ? 'm-a' : k === 'L' ? 'm-l' : 'm-e'}` : ''} onClick={() => setMarks({ ...marks, [x.id]: k })} title={{ P: 'Present', A: 'Absent', L: 'Late', LV: 'On leave' }[k]}>{k}</button>
              ))}</div></td></tr>
          ))}</tbody></table>
          <div className="reg-actions pad-x"><span className="muted small" style={{ marginRight: 'auto' }}>{data.taken ? 'Taken' : 'Not taken yet'} · LV = on approved leave</span>
            <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post('/staff-attendance', { date, marks: Object.entries(marks).map(([id, mark]) => ({ staffId: +id, mark })) }); reload(); sum.reload(); }, 'Staff register saved')}>Save</button></div>
        </>}
      </Card>
      <Card title={`${monthName(date.slice(0, 7))} · ${sum.data?.days ?? 0} registers`} pad={false}>
        {!sum.data ? <Loading /> : (
          <table className="table compact"><thead><tr><th>Name</th><th className="num">Present</th><th className="num">Late</th><th className="num">Absent</th><th className="num">Leave</th></tr></thead>
            <tbody>{sum.data.staff.map((x: any) => <tr key={x.id}><td>{x.name}</td><td className="num">{x.present}</td><td className="num">{x.late || ''}</td><td className={`num ${x.absent ? 'bad-text' : ''}`}>{x.absent || ''}</td><td className="num">{x.leave || ''}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ leave
function Leave() {
  const { data, error, reload } = useApi<any[]>('/leave');
  const staff = useApi<Staff[]>('/staff');
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ staffId: '', type: 'Annual', fromDate: '', toDate: '', reason: '' });
  const { busy, run } = useAction();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const decide = (id: number, status: string) => run(async () => { await api.put(`/leave/${id}`, { status }); reload(); }, `Leave ${status.toLowerCase()}`);
  return (
    <Card pad={false} title="Leave" actions={<button className="btn sm primary" onClick={() => setAdd(true)}>+ Leave</button>}>
      {!data.length ? <Empty>No leave recorded.</Empty> : (
        <table className="table compact"><thead><tr><th>Who</th><th>Type</th><th>From</th><th>To</th><th className="num">Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
          <tbody>{data.map((l) => (
            <tr key={l.id}><td><b>{l.staffName}</b></td><td>{l.type}</td><td>{fmtShort(l.fromDate)}</td><td>{fmtShort(l.toDate)}</td><td className="num">{l.days}</td><td className="muted">{l.reason}</td>
              <td><span className={`pill ${l.status === 'Approved' ? 'ok' : l.status === 'Rejected' ? '' : 'warn'}`}>{l.status}</span>{l.decidedBy && <div className="muted small">{l.decidedBy}</div>}</td>
              <td className="right nowrap">{l.status === 'Pending' && <><button className="btn sm primary" onClick={() => decide(l.id, 'Approved')}>Approve</button><button className="btn sm ghost" onClick={() => decide(l.id, 'Rejected')}>Reject</button></>}
                <button className="btn sm ghost" onClick={() => run(async () => { if (confirm('Delete this leave record?')) { await api.del(`/leave/${l.id}`); reload(); } })}>Delete</button></td></tr>
          ))}</tbody></table>
      )}
      {add && (
        <Modal title="Record leave" onClose={() => setAdd(false)} footer={<><button className="btn" onClick={() => setAdd(false)}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => api.post('/leave', f), 'Leave recorded')) { setAdd(false); reload(); } }}>Save</button></>}>
          <div className="form-grid">
            <Field label="Who *"><Select value={f.staffId} onChange={(v) => setF({ ...f, staffId: v })} options={(staff.data ?? []).filter((x) => x.status !== 'Left').map((x) => ({ value: String(x.id), label: x.name }))} placeholder="Pick…" /></Field>
            <Field label="Type"><Select value={f.type} onChange={(v) => setF({ ...f, type: v })} options={LEAVE_TYPES} /></Field>
            <Field label="From *"><input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: f.toDate || e.target.value })} /></Field>
            <Field label="To *"><input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
            <Field label="Reason" wide><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          </div>
          <p className="muted small">Working days are counted without weekends and school holidays. Approved unpaid leave is deducted in payroll.</p>
        </Modal>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ payroll
function Payroll() {
  const { meta } = useMeta();
  const perms = usePerms();
  const s = meta.settings;
  const runs = useApi<any[]>('/payruns');
  const [month, setMonth] = useState(meta.today.slice(0, 7));
  const [open, setOpen] = useState<number | null>(null);
  const [items, setItems] = useState(false);
  const { busy, run } = useAction();
  if (runs.error) return <ErrorBox error={runs.error} retry={runs.reload} />;
  if (open) return <PayRun id={open} onBack={() => { setOpen(null); runs.reload(); }} />;
  return (
    <div className="grid g2">
      <Card title="Pay runs" pad={false} actions={<>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} aria-label="Month" />
        <button className="btn sm primary" disabled={busy} onClick={() => run(async () => { const r = await api.post('/payruns', { month }); runs.reload(); setOpen(r.id); }, 'Pay run prepared')}>Prepare</button>
      </>}>
        {!runs.data ? <Loading /> : !runs.data.length ? <Empty>No pay runs yet. Pick a month and press Prepare.</Empty> : (
          <table className="table compact hover"><thead><tr><th>Month</th><th>Status</th><th className="num">Staff</th><th className="num">Net pay</th></tr></thead>
            <tbody>{runs.data.map((p) => <tr key={p.id} onClick={() => setOpen(p.id)}><td><b>{monthName(p.month)}</b></td><td><span className={`pill ${p.status === 'Paid' ? 'ok' : p.status === 'Approved' ? 'info' : 'warn'}`}>{p.status}</span></td><td className="num">{p.count}</td><td className="num">{money({ ...s, currencyDecimals: 2 }, p.net)}</td></tr>)}</tbody></table>
        )}
      </Card>
      <Card title="School pay items" actions={perms.admin && <button className="btn sm" onClick={() => setItems(true)}>Edit</button>}>
        {!(s.payItems ?? []).length ? <Empty>None yet: base pay only.</Empty> : (
          <table className="table compact"><tbody>{(s.payItems ?? []).map((i) => <tr key={i.name}><td>{i.name}</td><td><span className={`pill ${i.kind === 'allowance' ? 'ok' : 'warn'}`}>{i.kind}</span></td><td className="num">{i.method === 'percent' ? `${i.amount}% of base` : money({ ...s, currencyDecimals: 2 }, i.amount)}</td></tr>)}</tbody></table>
        )}
        <p className="muted small">Taxes are pay items too (for example "PAYE 7.5%"): the app has no national tax tables, so set the rates your school uses. The bursar prepares a pay run; an admin approves it.</p>
      </Card>
      {items && <ItemsModal onClose={() => setItems(false)} />}
    </div>
  );
}

function ItemsModal({ onClose }: { onClose: () => void }) {
  const { meta, reload } = useMeta();
  const [list, setList] = useState<PayItem[]>(meta.settings.payItems ?? []);
  const { busy, run } = useAction();
  const set = (i: number, p: Partial<PayItem>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Modal wide title="School pay items" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => api.put('/payroll/items', { items: list }), 'Pay items saved')) { await reload(); onClose(); } }}>Save</button></>}>
      <table className="table rows-editor"><thead><tr><th>Item</th><th>Kind</th><th>Method</th><th>Amount</th><th /></tr></thead>
        <tbody>{list.map((x, i) => (
          <tr key={i}><td><input value={x.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Item" /></td>
            <td><Select value={x.kind} onChange={(v) => set(i, { kind: v as PayItem['kind'] })} options={['allowance', 'deduction']} /></td>
            <td><Select value={x.method} onChange={(v) => set(i, { method: v as PayItem['method'] })} options={[{ value: 'fixed', label: 'fixed amount' }, { value: 'percent', label: '% of base pay' }]} /></td>
            <td><input type="number" min="0" step="any" value={x.amount ?? 0} onChange={(e) => set(i, { amount: +e.target.value })} aria-label="Amount" /></td>
            <td><button className="icon-btn" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="Remove">×</button></td></tr>
        ))}</tbody></table>
      <button className="btn sm" onClick={() => setList([...list, { name: '', kind: 'deduction', method: 'percent', amount: 0 }])}>+ Item</button>
    </Modal>
  );
}

function PayRun({ id, onBack }: { id: number; onBack: () => void }) {
  const { meta } = useMeta();
  const perms = usePerms();
  const s = { ...meta.settings, currencyDecimals: 2 };
  const { data, error, reload } = useApi<any>(`/payruns/${id}`);
  const [slip, setSlip] = useState<any>(null);
  const { busy, run } = useAction();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const r = data.run;
  const act = (what: string, msg: string) => run(async () => { await api.post(`/payruns/${id}/${what}`); reload(); }, msg);
  return (
    <Card title={<>{monthName(r.month)} payroll <span className={`pill ${r.status === 'Paid' ? 'ok' : r.status === 'Approved' ? 'info' : 'warn'}`}>{r.status}</span></>} pad={false} actions={<>
      <button className="btn sm" onClick={onBack}>‹ All pay runs</button>
      {r.status === 'Draft' && <button className="btn sm" disabled={busy} onClick={() => act('recalculate', 'Recalculated')}>Recalculate</button>}
      {r.status === 'Draft' && perms.admin && <button className="btn sm primary" disabled={busy} onClick={() => confirm('Approve this payroll? The payslips are then frozen.') && act('approve', 'Payroll approved')}>Approve</button>}
      {r.status === 'Approved' && <button className="btn sm primary" disabled={busy} onClick={() => act('paid', 'Marked as paid')}>Mark paid</button>}
      <a className="btn sm" href={`/api/payruns/${id}/bank.csv`} download>Bank file (CSV)</a>
      {r.status === 'Draft' && <button className="btn sm danger" onClick={() => run(async () => { if (confirm('Delete this draft?')) { await api.del(`/payruns/${id}`); onBack(); } })}>Delete</button>}
    </>}>
      <p className="muted small pad-x">Prepared by {r.createdBy}{r.approvedBy ? ` · approved by ${r.approvedBy}` : r.status === 'Draft' ? ' · draft: recalculate after changing pay, pay items or unpaid leave; an admin approves it' : ''}{r.paidAt ? ` · paid ${fmtShort(r.paidAt.slice(0, 10))}` : ''}</p>
      <div className="table-wrap">
        <table className="table compact hover">
          <thead><tr><th>Name</th><th>Position</th><th className="num">Base</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net pay</th></tr></thead>
          <tbody>{data.payslips.map((p: any) => <tr key={p.id} onClick={() => setSlip(p)}><td><b>{p.staffName}</b></td><td>{p.position}</td><td className="num">{money(s, p.base)}</td><td className="num">{money(s, p.gross)}</td><td className="num">{money(s, p.deductions)}</td><td className="num"><b>{money(s, p.net)}</b></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={3}>{data.totals.count} payslips</td><td className="num">{money(s, data.totals.gross)}</td><td className="num">{money(s, data.totals.deductions)}</td><td className="num">{money(s, data.totals.net)}</td></tr></tfoot>
        </table>
      </div>
      {slip && (
        <Modal title="Payslip" onClose={() => setSlip(null)} footer={<><button className="btn" onClick={() => setSlip(null)}>Close</button><button className="btn primary" onClick={() => window.print()}>Print</button></>}>
          <div className="receipt print-area">
            <div className="receipt-head"><div><h3>{meta.settings.schoolName}</h3><div className="muted small">{meta.settings.schoolAddress}</div></div><div className="right"><div className="receipt-no">PAYSLIP</div><div className="muted small">{monthName(r.month)}</div></div></div>
            <dl className="receipt-dl"><dt>Name</dt><dd>{slip.staffName}</dd><dt>Position</dt><dd>{slip.position || '–'}</dd>{slip.bankAccount && <><dt>Paid to</dt><dd>{slip.bankName} · {slip.bankAccount}</dd></>}</dl>
            <table className="table compact"><tbody>
              <tr><td>Base pay</td><td className="num">{money(s, slip.base)}</td></tr>
              {slip.lines.filter((l: any) => l.kind === 'allowance').map((l: any) => <tr key={l.name}><td>{l.name} {l.note && <span className="muted small">({l.note})</span>}</td><td className="num">{money(s, l.amount)}</td></tr>)}
              <tr><td><b>Gross pay</b></td><td className="num"><b>{money(s, slip.gross)}</b></td></tr>
              {slip.lines.filter((l: any) => l.kind === 'deduction').map((l: any) => <tr key={l.name}><td>{l.name} {l.note && <span className="muted small">({l.note})</span>}</td><td className="num">−{money(s, l.amount)}</td></tr>)}
              <tr><td><b>Net pay</b></td><td className="num"><b>{money(s, slip.net)}</b></td></tr>
            </tbody></table>
            {r.status === 'Draft' && <p className="bad-text small">DRAFT: not approved yet</p>}
          </div>
        </Modal>
      )}
    </Card>
  );
}
