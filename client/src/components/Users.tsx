import { useState } from 'react';
import { api } from '../api';
import { ROLE_LABEL } from '../format';
import type { Role, User } from '../types';
import { Card, Empty, ErrorBox, Field, Loading, Modal, Select, useAction, useApi, useMeta } from './ui';

const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including settings, users and backups.',
  teacher: 'Registers, gradebook and report-card comments for their own class. Sees learners, but no fees.',
  bursar: 'Fees, receipts, payment plans, fee reminders and payroll. Sees learners; no registers or marks.',
  librarian: 'The library: books, loans and returns. Sees learners and classes.',
  parent: 'The family portal only: grades, report cards, attendance, homework, notices and fees of their own children.',
  student: 'The portal only, for their own record: grades, report cards, attendance, homework and notices.',
};

type Draft = Partial<User> & { password?: string; learnerIds?: number[] };

export default function UsersCard() {
  const { meta } = useMeta();
  const { data: learners } = useApi<{ id: number; firstName: string; lastName: string; className: string }[]>('/students');
  const nameOf = (id: number) => { const l = learners?.find((x) => x.id === id); return l ? `${l.firstName} ${l.lastName} (${l.className})` : `#${id}`; };
  const { data, error, reload } = useApi<User[]>('/users');
  const [edit, setEdit] = useState<Draft | null>(null);
  return (
    <Card title="Users & roles" className="span-2" pad={false} actions={<button className="btn sm primary" onClick={() => setEdit({ username: '', name: '', role: 'teacher', teacherName: '', password: '' })}>+ Add user</button>}>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? <Loading /> : !data.length ? <Empty>No users.</Empty> : (
        <div className="table-wrap">
          <table className="table compact hover">
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Class / learners</th><th>Status</th></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} onClick={() => setEdit({ ...u, password: '' })}>
                  <td><b>{u.name}</b>{u.id === meta.user.id && <span className="muted small"> (you)</span>}</td>
                  <td className="muted">{u.username}</td>
                  <td><span className={`pill role-${u.role}`}>{ROLE_LABEL[u.role]}</span></td>
                  <td>{u.role === 'teacher' ? (u.teacherName ? `${u.teacherName}` : <span className="muted">every class (not linked)</span>)
                    : (u as any).learnerIds?.length ? (u as any).learnerIds.map(nameOf).join(', ') : <span className="muted">–</span>}</td>
                  <td>{u.active ? <span className="pill ok">Active</span> : <span className="pill">Disabled</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small pad-x">{(Object.keys(ROLE_HELP) as Role[]).map((r) => <span key={r}><b>{ROLE_LABEL[r]}:</b> {ROLE_HELP[r]} </span>)}</p>
      {edit && <UserModal u={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </Card>
  );
}

export function UserModal({ u, onClose, onSaved }: { u: Draft; onClose: () => void; onSaved: () => void }) {
  const { meta } = useMeta();
  const [f, setF] = useState<Draft>(u);
  const { busy, run } = useAction();
  const set = (patch: Draft) => setF((x) => ({ ...x, ...patch }));
  const isNew = !f.id;
  const save = async () => {
    const body: any = { username: f.username, name: f.name, role: f.role, teacherName: f.role === 'teacher' ? f.teacherName ?? '' : '', active: !!f.active || isNew };
    if (f.role === 'parent' || f.role === 'student') body.learnerIds = f.learnerIds ?? [];
    if (f.password) body.password = f.password;
    if (await run(() => (isNew ? api.post('/users', body) : api.put(`/users/${f.id}`, body)), isNew ? `${f.name} can now log in` : 'User saved')) onSaved();
  };
  const del = async () => {
    if (!confirm(`Delete the account of ${f.name}? They will no longer be able to log in. (Their registers, marks and receipts stay.)`)) return;
    if (await run(() => api.del(`/users/${f.id}`), 'User deleted')) onSaved();
  };
  const linked = meta.teachers.includes(f.teacherName ?? '');
  return (
    <Modal title={isNew ? 'New user' : `Edit ${u.name}`} onClose={onClose} footer={<>
      {!isNew && f.id !== meta.user.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>{isNew ? 'Create user' : 'Save'}</button>
    </>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Name *"><input value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
        <Field label="Username *" hint="Letters, digits, . - _"><input value={f.username ?? ''} onChange={(e) => set({ username: e.target.value.toLowerCase() })} autoCapitalize="none" /></Field>
        <Field label="Role *" wide hint={ROLE_HELP[(f.role ?? 'teacher') as Role]}>
          <Select value={f.role ?? 'teacher'} onChange={(v) => set({ role: v as Role })} options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
        </Field>
        {f.role === 'teacher' && (
          <Field label="Teacher" wide hint={linked ? 'Can work on the classes where this teacher is class teacher.' : 'Not linked: can take registers and enter marks for every class.'}>
            <Select value={f.teacherName ?? ''} onChange={(v) => set({ teacherName: v })} options={meta.teachers} placeholder="Not linked (every class)" />
          </Field>
        )}
        {(f.role === 'parent' || f.role === 'student') && (
          <Field label={f.role === 'parent' ? 'Their children *' : 'Which learner *'} wide>
            <LearnerPicker value={f.learnerIds ?? []} single={f.role === 'student'} onChange={(ids) => set({ learnerIds: ids })} />
          </Field>
        )}
        <Field label={isNew ? 'Password *' : 'New password'} hint={isNew ? 'At least 8 characters. Tell them to change it after logging in.' : 'Leave empty to keep the current one. Setting one logs them out everywhere.'}>
          <input type="password" autoComplete="new-password" value={f.password ?? ''} onChange={(e) => set({ password: e.target.value })} />
        </Field>
        {!isNew && (
          <Field label="Status">
            <Select value={f.active ? 'Active' : 'Disabled'} onChange={(v) => set({ active: v === 'Active' ? 1 : 0 })} options={['Active', 'Disabled']} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Search learners by name, learner no or guardian, and pick one (student) or several (parent). */
export function LearnerPicker({ value, onChange, single }: { value: number[]; onChange: (ids: number[]) => void; single?: boolean }) {
  const { data } = useApi<{ id: number; firstName: string; lastName: string; className: string; learnerNo: string; guardianName: string }[]>('/students');
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const hits = t.length < 2 ? [] : (data ?? []).filter((l) => !value.includes(l.id) && [`${l.firstName} ${l.lastName}`, l.learnerNo, l.guardianName].some((v) => v?.toLowerCase().includes(t))).slice(0, 8);
  const pick = (id: number) => { onChange(single ? [id] : [...value, id]); setQ(''); };
  return (
    <div className="picker">
      <div className="picker-chips">
        {value.map((id) => { const l = data?.find((x) => x.id === id); return (
          <span key={id} className="pill info">{l ? `${l.firstName} ${l.lastName} · ${l.className}` : `#${id}`} <button type="button" className="icon-btn" aria-label="Remove" onClick={() => onChange(value.filter((x) => x !== id))}>×</button></span>
        ); })}
      </div>
      {(!single || !value.length) && <input placeholder="Type a learner's or guardian's name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a learner" />}
      {hits.length > 0 && <ul className="picker-list">{hits.map((l) => <li key={l.id}><button type="button" onClick={() => pick(l.id)}>{l.firstName} {l.lastName} <span className="muted">· {l.className} · guardian {l.guardianName || '–'}</span></button></li>)}</ul>}
    </div>
  );
}
