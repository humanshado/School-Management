import { useState } from 'react';
import { api } from '../api';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Select, useAction, useApi } from '../components/ui';
import { fmtShort } from '../format';

export interface Notice { id: number; title: string; body: string; audience: string; pinned: number; expires: string | null; postedBy: string; at: string; canEdit?: boolean; expired?: boolean }
export const audienceLabel = (a: string) => (a === 'everyone' ? 'Everyone' : a === 'staff' ? 'Staff only' : a === 'families' ? 'All families' : a.startsWith('class:') ? `Class ${a.slice(6)}` : a);

export function NoticeItem({ n, onEdit }: { n: Notice; onEdit?: () => void }) {
  return (
    <article className={`notice ${n.pinned ? 'pinned' : ''} ${n.expired ? 'expired' : ''}`}>
      <header>
        <h3>{n.pinned ? '📌 ' : ''}{n.title}</h3>
        {onEdit && <button className="btn sm ghost" onClick={onEdit}>Edit</button>}
      </header>
      {n.body && <p className="pre">{n.body}</p>}
      <footer className="muted small">{audienceLabel(n.audience)} · {n.postedBy} · {fmtShort(n.at.slice(0, 10))}{n.expires ? ` · until ${fmtShort(n.expires)}` : ''}{n.expired ? ' · expired' : ''}</footer>
    </article>
  );
}

export default function Notices() {
  const [all, setAll] = useState(false);
  const { data, error, reload } = useApi<{ items: Notice[]; audiences: string[] }>(`/announcements${all ? '?all=1' : ''}`);
  const [edit, setEdit] = useState<Partial<Notice> | null>(null);
  return (
    <>
      <PageHead title="Notice board" sub="Notices for staff, families or one class. Families see theirs in the portal.">
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show expired</label>
        {!!data?.audiences.length && <button className="btn primary" onClick={() => setEdit({ title: '', body: '', audience: data.audiences[0], pinned: 0, expires: null })}>+ Post notice</button>}
      </PageHead>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? <Loading /> : !data.items.length ? <Card><Empty>No notices.</Empty></Card> : (
        <div className="notices">{data.items.map((n) => <NoticeItem key={n.id} n={n} onEdit={n.canEdit ? () => setEdit(n) : undefined} />)}</div>
      )}
      {edit && data && <NoticeModal n={edit} audiences={data.audiences} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function NoticeModal({ n, audiences, onClose, onSaved }: { n: Partial<Notice>; audiences: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(n);
  const { busy, run } = useAction();
  const save = async () => { if (await run(() => (f.id ? api.put(`/announcements/${f.id}`, f) : api.post('/announcements', f)), 'Notice saved')) onSaved(); };
  const del = async () => { if (confirm('Delete this notice?') && (await run(() => api.del(`/announcements/${f.id}`), 'Notice deleted'))) onSaved(); };
  const opts = [...new Set([...(f.audience ? [f.audience] : []), ...audiences])];
  return (
    <Modal title={f.id ? 'Edit notice' : 'Post a notice'} onClose={onClose} footer={<>
      {f.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>{f.id ? 'Save' : 'Post'}</button>
    </>}>
      <div className="form-grid">
        <Field label="Title *" wide><input value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
        <Field label="Message" wide><textarea rows={6} value={f.body ?? ''} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="Who sees it"><Select value={f.audience ?? ''} onChange={(v) => setF({ ...f, audience: v })} options={opts.map((a) => ({ value: a, label: audienceLabel(a) }))} /></Field>
        <Field label="Show until" hint="Leave empty to keep it up"><input type="date" value={f.expires ?? ''} onChange={(e) => setF({ ...f, expires: e.target.value || null })} /></Field>
        <label className="check"><input type="checkbox" checked={!!f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked ? 1 : 0 })} /> Pin to the top</label>
      </div>
    </Modal>
  );
}
