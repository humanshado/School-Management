import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import Files from '../components/Files';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Select, useAction, useApi, useMeta, usePerms } from '../components/ui';
import { daysBetween, fmtDay, fmtShort } from '../format';
import type { FileDoc } from '../types';

interface Item { id: number; className: string; subject: string; title: string; details: string; setOn?: string; dueOn?: string; link?: string; postedBy: string; at: string; files: FileDoc[]; canEdit: boolean }

/** Homework and study materials for a class: teachers post for their own classes, families see them in the portal. */
export default function Homework() {
  const { meta } = useMeta();
  const perms = usePerms();
  const [sp, setSp] = useSearchParams();
  const cls = sp.get('class') ?? perms.defaultClass;
  const tab = sp.get('tab') === 'materials' ? 'materials' : 'homework';
  const set = (patch: Record<string, string>) => setSp({ class: cls, tab, ...patch }, { replace: true });
  const { data, error, reload } = useApi<Item[]>(`/${tab}${qs({ class: cls })}`);
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const canPost = perms.canTeach(cls);
  return (
    <>
      <PageHead title="Homework & materials" sub="Families see these in the portal">
        <Select value={cls} onChange={(v) => set({ class: v })} options={meta.classes} aria-label="Class" />
        {canPost && <button className="btn primary" onClick={() => setEdit({ className: cls, subject: '', title: '', details: '', dueOn: '', link: '' })}>+ {tab === 'homework' ? 'Set homework' : 'Add material'}</button>}
      </PageHead>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'homework'} className={tab === 'homework' ? 'on' : ''} onClick={() => set({ tab: 'homework' })}>Homework</button>
        <button role="tab" aria-selected={tab === 'materials'} className={tab === 'materials' ? 'on' : ''} onClick={() => set({ tab: 'materials' })}>Study materials</button>
      </div>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? <Loading /> : !data.length ? <Card><Empty>Nothing for {cls} yet.</Empty></Card> : (
        <div className="hw-list">
          {data.map((x) => {
            const due = x.dueOn ? daysBetween(meta.today, x.dueOn) : null;
            return (
              <Card key={x.id} className="hw-card" title={<>{x.subject && <span className="pill">{x.subject}</span>} {x.title}</>} actions={<>
                {tab === 'homework' && x.dueOn && <span className={`pill ${due! < 0 ? '' : due! <= 1 ? 'warn' : 'info'}`}>due {fmtDay(x.dueOn)}{due! < 0 ? ' · past' : ''}</span>}
                {x.canEdit && <button className="btn sm ghost" onClick={() => setEdit(x)}>Edit</button>}
              </>}>
                {x.details && <p className="pre hw-details">{x.details}</p>}
                {x.link && <p><a href={x.link} target="_blank" rel="noopener noreferrer">{x.link}</a></p>}
                <Files ownerType={tab === 'homework' ? 'homework' : 'material'} ownerId={x.id} files={x.files} editable={x.canEdit} onChange={reload} />
                <p className="muted small">Posted by {x.postedBy} · {fmtShort(x.at.slice(0, 10))}</p>
              </Card>
            );
          })}
        </div>
      )}
      {edit && <ItemModal kind={tab} item={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function ItemModal({ kind, item, onClose, onSaved }: { kind: 'homework' | 'materials'; item: Partial<Item>; onClose: () => void; onSaved: () => void }) {
  const { meta } = useMeta();
  const perms = usePerms();
  const [f, setF] = useState(item);
  const { busy, run } = useAction();
  const set = (p: Partial<Item>) => setF((x) => ({ ...x, ...p }));
  const save = async () => { if (await run(() => (f.id ? api.put(`/${kind}/${f.id}`, f) : api.post(`/${kind}`, f)), 'Saved')) onSaved(); };
  const del = async () => { if (confirm(`Delete "${f.title}" and its files?`) && (await run(() => api.del(`/${kind}/${f.id}`), 'Deleted'))) onSaved(); };
  const classes = perms.classes ?? meta.classes;
  return (
    <Modal title={f.id ? 'Edit' : kind === 'homework' ? 'Set homework' : 'Add study material'} onClose={onClose} footer={<>
      {f.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>Save</button>
    </>}>
      <div className="form-grid">
        <Field label="Class *"><Select value={f.className ?? ''} onChange={(v) => set({ className: v })} options={classes} /></Field>
        <Field label="Subject"><Select value={f.subject ?? ''} onChange={(v) => set({ subject: v })} options={meta.settings.subjects} placeholder="General" /></Field>
        <Field label="Title *" wide><input value={f.title ?? ''} onChange={(e) => set({ title: e.target.value })} autoFocus /></Field>
        <Field label={kind === 'homework' ? 'What to do' : 'Description'} wide><textarea rows={5} value={f.details ?? ''} onChange={(e) => set({ details: e.target.value })} /></Field>
        {kind === 'homework'
          ? <Field label="Due"><input type="date" value={f.dueOn ?? ''} onChange={(e) => set({ dueOn: e.target.value })} /></Field>
          : <Field label="Link (video, website, Zoom / Teams class…)" wide><input type="url" placeholder="https://" value={f.link ?? ''} onChange={(e) => set({ link: e.target.value })} /></Field>}
      </div>
      {!f.id && <p className="muted small">You can attach files after saving.</p>}
    </Modal>
  );
}
