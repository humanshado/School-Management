import { useState } from 'react';
import { api, qs } from '../api';
import { LearnerPicker } from '../components/Users';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Select, useAction, useApi, useMeta, usePerms } from '../components/ui';
import { fmtDate, fmtShort } from '../format';

interface Book { id: number; title: string; author: string; isbn: string; category: string; copies: number; shelf: string; notes: string; out: number; available: number }
interface Loan { id: number; bookId: number; book: string; author: string; borrowerType: 'learner' | 'staff'; borrowerId: number; borrowerName: string; borrowedOn: string; dueOn: string; returnedOn: string | null; daysLate: number; fine: number; overdue: boolean; className: string | null; guardianName: string | null; guardianEmail: string | null }

export default function Library() {
  const [tab, setTab] = useState<'books' | 'loans'>('loans');
  return (
    <>
      <PageHead title="Library" sub="Catalogue, loans and returns" />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'loans'} className={tab === 'loans' ? 'on' : ''} onClick={() => setTab('loans')}>Loans</button>
        <button role="tab" aria-selected={tab === 'books'} className={tab === 'books' ? 'on' : ''} onClick={() => setTab('books')}>Catalogue</button>
      </div>
      {tab === 'books' ? <Catalogue /> : <Loans />}
    </>
  );
}

function Catalogue() {
  const perms = usePerms();
  const [q, setQ] = useState('');
  const { data, error, reload } = useApi<{ items: Book[]; canEdit: boolean; loanDays: number; finePerDay: number }>(`/books${qs({ q })}`);
  const [edit, setEdit] = useState<Partial<Book> | null>(null);
  const [lend, setLend] = useState<Book | null>(null);
  const [settings, setSettings] = useState(false);
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <Card pad={false} actions={data?.canEdit && <>
      <button className="btn sm" onClick={() => setSettings(true)}>Loan rules…</button>
      <button className="btn sm primary" onClick={() => setEdit({ title: '', author: '', isbn: '', category: '', copies: 1, shelf: '', notes: '' })}>+ Book</button>
    </>} title={data ? `${data.items.length} titles · loans last ${data.loanDays} days${data.finePerDay ? ` · fine ${data.finePerDay}/day late` : ''}` : 'Catalogue'}>
      <div className="filters"><input type="search" placeholder="Search title, author, ISBN, category, shelf…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search books" /></div>
      {!data ? <Loading /> : !data.items.length ? <Empty>{q ? 'No books match.' : 'No books yet.'}</Empty> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Title</th><th>Author</th><th>Category</th><th>Shelf</th><th className="num">Copies</th><th className="num">Available</th><th /></tr></thead>
            <tbody>{data.items.map((b) => (
              <tr key={b.id}>
                <td><b>{b.title}</b>{b.isbn && <div className="muted small">ISBN {b.isbn}</div>}</td><td>{b.author}</td><td>{b.category}</td><td>{b.shelf}</td>
                <td className="num">{b.copies}</td><td className={`num ${b.available ? 'good-text' : 'bad-text'}`}>{b.available}</td>
                <td className="right nowrap">{perms.library && <>
                  <button className="btn sm primary" disabled={!b.available} onClick={() => setLend(b)}>Lend</button>
                  <button className="btn sm ghost" onClick={() => setEdit(b)}>Edit</button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {edit && <BookModal b={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {lend && <LendModal book={lend} onClose={() => setLend(null)} onSaved={() => { setLend(null); reload(); }} />}
      {settings && data && <RulesModal loanDays={data.loanDays} finePerDay={data.finePerDay} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); reload(); }} />}
    </Card>
  );
}

function BookModal({ b, onClose, onSaved }: { b: Partial<Book>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(b);
  const { busy, run } = useAction();
  const set = (p: Partial<Book>) => setF((x) => ({ ...x, ...p }));
  const save = async () => { if (await run(() => (f.id ? api.put(`/books/${f.id}`, f) : api.post('/books', f)), 'Book saved')) onSaved(); };
  const del = async () => { if (confirm(`Remove "${f.title}" from the catalogue?`) && (await run(() => api.del(`/books/${f.id}`), 'Book removed'))) onSaved(); };
  return (
    <Modal title={f.id ? 'Edit book' : 'Add a book'} onClose={onClose} footer={<>
      {f.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Remove</button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button>
    </>}>
      <div className="form-grid">
        <Field label="Title *" wide><input value={f.title ?? ''} onChange={(e) => set({ title: e.target.value })} autoFocus /></Field>
        <Field label="Author"><input value={f.author ?? ''} onChange={(e) => set({ author: e.target.value })} /></Field>
        <Field label="ISBN"><input value={f.isbn ?? ''} onChange={(e) => set({ isbn: e.target.value })} /></Field>
        <Field label="Category"><input value={f.category ?? ''} onChange={(e) => set({ category: e.target.value })} placeholder="Fiction, Science, Reference…" /></Field>
        <Field label="Shelf"><input value={f.shelf ?? ''} onChange={(e) => set({ shelf: e.target.value })} /></Field>
        <Field label="Copies *"><input type="number" min="1" value={f.copies ?? 1} onChange={(e) => set({ copies: +e.target.value })} /></Field>
        <Field label="Notes" wide><input value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function LendModal({ book, onClose, onSaved }: { book: Book; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'learner' | 'staff'>('learner');
  const [learner, setLearner] = useState<number[]>([]);
  const [staff, setStaff] = useState('');
  const [dueOn, setDue] = useState('');
  const { data: teachers } = useApi<{ id: number; name: string }[]>('/teachers');
  const { busy, run } = useAction();
  const save = async () => {
    const borrowerId = type === 'learner' ? learner[0] : Number(staff);
    if (await run(() => api.post('/loans', { bookId: book.id, borrowerType: type, borrowerId, dueOn: dueOn || undefined }), `"${book.title}" lent`)) onSaved();
  };
  return (
    <Modal title={`Lend "${book.title}"`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (type === 'learner' ? !learner.length : !staff)} onClick={save}>Lend</button></>}>
      <div className="seg" style={{ marginBottom: 12 }}><button className={type === 'learner' ? 'on' : ''} onClick={() => setType('learner')}>Learner</button><button className={type === 'staff' ? 'on' : ''} onClick={() => setType('staff')}>Staff</button></div>
      <div className="form-grid">
        <Field label="Borrower *" wide>{type === 'learner'
          ? <LearnerPicker value={learner} single onChange={setLearner} />
          : <Select value={staff} onChange={setStaff} options={(teachers ?? []).map((t) => ({ value: String(t.id), label: t.name }))} placeholder="Pick…" />}</Field>
        <Field label="Due back" hint="Leave empty for the usual loan length"><input type="date" value={dueOn} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function RulesModal({ loanDays, finePerDay, onClose, onSaved }: { loanDays: number; finePerDay: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ loanDays, finePerDay });
  const { busy, run } = useAction();
  return (
    <Modal title="Loan rules" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => api.put('/library/settings', f), 'Saved')) onSaved(); }}>Save</button></>}>
      <div className="form-grid">
        <Field label="Loans last (days)"><input type="number" min="1" value={f.loanDays} onChange={(e) => setF({ ...f, loanDays: +e.target.value })} /></Field>
        <Field label="Fine per day late" hint="0 = no fines. Fines are shown, not added to the fees."><input type="number" min="0" step="any" value={f.finePerDay} onChange={(e) => setF({ ...f, finePerDay: +e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Loans() {
  const { meta } = useMeta();
  const perms = usePerms();
  const [status, setStatus] = useState<'open' | 'overdue' | 'returned'>('open');
  const { data, error, reload } = useApi<Loan[]>(`/loans?status=${status}`);
  const { run } = useAction();
  const [remind, setRemind] = useState(false);
  if (error) return <ErrorBox error={error} retry={reload} />;
  const act = (l: Loan, what: 'return' | 'renew') => run(async () => { await api.post(`/loans/${l.id}/${what}`, {}); reload(); }, what === 'return' ? `"${l.book}" returned` : `"${l.book}" renewed`);
  const overdueLearners = (data ?? []).filter((l) => l.overdue && l.borrowerType === 'learner' && l.guardianEmail);
  return (
    <Card pad={false} actions={<>
      <div className="seg">{(['open', 'overdue', 'returned'] as const).map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s === 'open' ? 'Out now' : s === 'overdue' ? 'Overdue' : 'Returned'}</button>)}</div>
      {status === 'overdue' && overdueLearners.length > 0 && <button className="btn sm" onClick={() => setRemind(true)}>Reminders ({overdueLearners.length})</button>}
    </>} title="Loans">
      {!data ? <Loading /> : !data.length ? <Empty>{status === 'overdue' ? 'Nothing overdue. 🎉' : 'No loans.'} Lend books from the Catalogue tab.</Empty> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Book</th><th>Borrower</th><th>Borrowed</th><th>Due</th>{status === 'returned' && <th>Returned</th>}<th>Late</th><th /></tr></thead>
            <tbody>{data.map((l) => (
              <tr key={l.id} className={l.overdue ? 'needs' : ''}>
                <td><b>{l.book}</b><div className="muted small">{l.author}</div></td>
                <td>{l.borrowerName}{l.borrowerType === 'staff' && <span className="pill" style={{ marginLeft: 6 }}>staff</span>}</td>
                <td>{fmtShort(l.borrowedOn)}</td><td>{fmtShort(l.dueOn)}</td>{status === 'returned' && <td>{fmtShort(l.returnedOn)}</td>}
                <td className={l.daysLate ? 'bad-text' : 'muted'}>{l.daysLate ? `${l.daysLate} days${l.fine ? ` · fine ${l.fine}` : ''}` : '–'}</td>
                <td className="right nowrap">{perms.library && !l.returnedOn && <>
                  <button className="btn sm primary" onClick={() => act(l, 'return')}>Returned</button>
                  <button className="btn sm ghost" onClick={() => act(l, 'renew')}>Renew</button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {remind && (
        <Modal wide title="Overdue book reminders" onClose={() => setRemind(false)} footer={<button className="btn primary" onClick={() => setRemind(false)}>Done</button>}>
          <p className="muted small">Each e-mail opens in your mail app for you to check and send.</p>
          <div className="msg-list">{overdueLearners.map((l) => {
            const body = `Dear ${l.guardianName || 'Parent / Guardian'},\n\nOur records show that ${l.borrowerName.replace(/ \(.*\)$/, '')} still has the library book "${l.book}", which was due back on ${fmtDate(l.dueOn)}. Please help them return it as soon as possible.\n\nKind regards,\n${meta.settings.schoolName} library\n${meta.settings.schoolContact}`;
            return <details key={l.id}><summary><b>{l.borrowerName}</b> <span className="muted">{l.guardianEmail}</span>
              <a className="btn sm primary" href={`mailto:${encodeURIComponent(l.guardianEmail!)}?subject=${encodeURIComponent(`Library book overdue: ${l.book}`)}&body=${encodeURIComponent(body)}`}>Open e-mail</a></summary>
              <pre className="msg-body">{body}</pre></details>;
          })}</div>
        </Modal>
      )}
    </Card>
  );
}
