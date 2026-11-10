import { useState } from 'react';
import { api } from '../api';
import Files from '../components/Files';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Select, useAction, useApi, useMeta } from '../components/ui';
import { fmtDate } from '../format';
import type { FileDoc } from '../types';

interface App {
  id: number; ref: string; status: string; firstName: string; lastName: string; dob: string | null; gender: string; gradeApplying: string;
  guardianName: string; relationship: string; guardianPhone: string; guardianEmail: string; address: string; previousSchool: string;
  notes: string; submittedAt: string; updatedAt: string; interviewAt: string | null; decisionNotes: string; studentId: number | null; files: FileDoc[];
}
interface Data { stages: string[]; counts: Record<string, number>; open: boolean; intro: string; items: App[] }
const tone = (s: string) => (['Enrolled', 'Accepted', 'Offered'].includes(s) ? 'ok' : ['Declined', 'Withdrawn'].includes(s) ? '' : s === 'Interview' ? 'info' : 'warn');

export default function Admissions() {
  const { meta } = useMeta();
  const [status, setStatus] = useState('');
  const { data, error, reload } = useApi<Data>(`/applications${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  const [open, setOpen] = useState<App | null>(null);
  const [settings, setSettings] = useState(false);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const link = `${location.origin}/apply`;
  return (
    <>
      <PageHead title="Admissions" sub={<>Online applications are <b className={data.open ? 'good-text' : 'bad-text'}>{data.open ? 'open' : 'closed'}</b>{data.open && <> · form: <a href="/apply" target="_blank" rel="noreferrer">{link}</a></>}</>}>
        {meta.perms.admin && <button className="btn" onClick={() => setSettings(true)}>{data.open ? 'Close / edit form…' : 'Open applications…'}</button>}
      </PageHead>
      <div className="stage-bar">
        <button className={!status ? 'on' : ''} onClick={() => setStatus('')}>All <b>{Object.values(data.counts).reduce((a, b) => a + b, 0)}</b></button>
        {data.stages.map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s} <b>{data.counts[s] ?? 0}</b></button>)}
      </div>
      <Card pad={false}>
        {!data.items.length ? <Empty>No applications{status ? ` at "${status}"` : ''} yet.</Empty> : (
          <div className="table-wrap">
            <table className="table hover">
              <thead><tr><th>Ref</th><th>Child</th><th>Grade</th><th>Guardian</th><th>Applied</th><th>Stage</th><th className="num">Files</th></tr></thead>
              <tbody>{data.items.map((a) => (
                <tr key={a.id} onClick={() => setOpen(a)}>
                  <td className="muted">{a.ref}</td><td><b>{a.firstName} {a.lastName}</b></td><td>{a.gradeApplying}</td>
                  <td>{a.guardianName}<div className="muted small">{a.guardianPhone} {a.guardianEmail}</div></td>
                  <td>{fmtDate(a.submittedAt.slice(0, 10))}</td><td><span className={`pill ${tone(a.status)}`}>{a.status}</span></td><td className="num">{a.files.length || ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <AppModal a={open} stages={data.stages} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
      {settings && <FormSettings open={data.open} intro={data.intro} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); reload(); }} />}
    </>
  );
}

function AppModal({ a, stages, onClose, onSaved }: { a: App; stages: string[]; onClose: () => void; onSaved: () => void }) {
  const { meta } = useMeta();
  const [f, setF] = useState(a);
  const [cls, setCls] = useState('');
  const { busy, run } = useAction();
  const set = (p: Partial<App>) => setF((x) => ({ ...x, ...p }));
  const enrolled = a.status === 'Enrolled';
  const save = async () => { if (await run(() => api.put(`/applications/${a.id}`, f), 'Application saved')) onSaved(); };
  const enrol = async () => {
    if (!confirm(`Enrol ${a.firstName} ${a.lastName} into ${cls}? This creates their learner record.`)) return;
    if (await run(() => api.post(`/applications/${a.id}/enrol`, { className: cls }), `${a.firstName} enrolled into ${cls}`)) onSaved();
  };
  const del = async () => { if (confirm(`Delete application ${a.ref} and its documents?`) && (await run(() => api.del(`/applications/${a.id}`), 'Application deleted'))) onSaved(); };
  const mail = `mailto:${encodeURIComponent(a.guardianEmail ?? '')}?subject=${encodeURIComponent(`${meta.settings.schoolName}: application ${a.ref} for ${a.firstName}`)}&body=${encodeURIComponent(`Dear ${a.guardianName},\n\n\n\nKind regards,\n${meta.settings.schoolName}\n${meta.settings.schoolContact}`)}`;
  const gradeClasses = meta.classes.filter((c) => c.startsWith(a.gradeApplying.replace(/\D/g, '')));
  return (
    <Modal wide title={`${a.ref} · ${a.firstName} ${a.lastName}`} onClose={onClose} footer={<>
      {meta.perms.admin && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}
      {a.guardianEmail && <a className="btn" href={mail}>E-mail guardian</a>}
      <button className="btn" onClick={onClose}>Close</button>
      {!enrolled && <button className="btn primary" disabled={busy} onClick={save}>Save</button>}
    </>}>
      <div className="form-grid">
        <Field label="Stage"><Select value={f.status} onChange={(v) => set({ status: v })} options={stages.filter((s) => s !== 'Enrolled' || enrolled)} disabled={enrolled} /></Field>
        <Field label="Interview"><input type="datetime-local" value={f.interviewAt ?? ''} onChange={(e) => set({ interviewAt: e.target.value || null })} disabled={enrolled} /></Field>
        <Field label="Decision notes" wide><textarea rows={2} value={f.decisionNotes ?? ''} onChange={(e) => set({ decisionNotes: e.target.value })} disabled={enrolled} /></Field>
        <h3 className="form-sec">Child</h3>
        <Field label="First name"><input value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} disabled={enrolled} /></Field>
        <Field label="Last name"><input value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} disabled={enrolled} /></Field>
        <Field label="Date of birth"><input type="date" value={f.dob ?? ''} onChange={(e) => set({ dob: e.target.value })} disabled={enrolled} /></Field>
        <Field label="Grade applying for"><Select value={f.gradeApplying} onChange={(v) => set({ gradeApplying: v })} options={meta.settings.grades.map((g) => g.name)} disabled={enrolled} /></Field>
        <Field label="Previous school" wide><input value={f.previousSchool ?? ''} onChange={(e) => set({ previousSchool: e.target.value })} disabled={enrolled} /></Field>
        <h3 className="form-sec">Guardian</h3>
        <Field label="Name"><input value={f.guardianName} onChange={(e) => set({ guardianName: e.target.value })} disabled={enrolled} /></Field>
        <Field label="Phone"><input value={f.guardianPhone ?? ''} onChange={(e) => set({ guardianPhone: e.target.value })} disabled={enrolled} /></Field>
        <Field label="E-mail"><input value={f.guardianEmail ?? ''} onChange={(e) => set({ guardianEmail: e.target.value })} disabled={enrolled} /></Field>
        <Field label="Address" wide><input value={f.address ?? ''} onChange={(e) => set({ address: e.target.value })} disabled={enrolled} /></Field>
        {f.notes && <Field label="From the family" wide><p className="pre">{f.notes}</p></Field>}
      </div>
      <h3 className="form-sec">Documents</h3>
      <Files ownerType="application" ownerId={a.id} files={a.files} editable={!enrolled} onChange={onSaved} />
      {enrolled ? <p className="callout">Enrolled · the learner record has the documents. <a href={`/students/${a.studentId}`}>Open learner</a></p> : (
        <div className="callout">
          <span>Enrol into</span>
          <Select value={cls} onChange={setCls} options={[...gradeClasses, ...meta.classes.filter((c) => !gradeClasses.includes(c))]} placeholder="Pick a class…" style={{ width: 'auto' }} />
          <button className="btn primary sm" disabled={!cls || busy} onClick={enrol}>Enrol</button>
        </div>
      )}
    </Modal>
  );
}

function FormSettings({ open, intro, onClose, onSaved }: { open: boolean; intro: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ open, intro });
  const { busy, run } = useAction();
  return (
    <Modal title="Online application form" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => api.put('/applications/settings', f), 'Saved')) onSaved(); }}>Save</button>
    </>}>
      <label className="check"><input type="checkbox" checked={f.open} onChange={(e) => setF({ ...f, open: e.target.checked })} /> Accept applications at <b>{location.origin}/apply</b></label>
      <Field label="Message at the top of the form" wide><textarea rows={4} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} placeholder="e.g. Applications for the 2027 school year close on 31 January." /></Field>
      <p className="muted small">Anyone with the link can apply while it is open. Each connection may send 5 applications an hour; documents can be added only on the day of applying.</p>
    </Modal>
  );
}
