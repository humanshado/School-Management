import { useState } from 'react';
import { api } from '../api';
import { fmtDate, money } from '../format';
import { ErrorBox, Field, Loading, Modal, Select, useAction, useApi, useMeta } from './ui';

export interface Payment {
  id?: number; studentId: number | ''; receiptNo?: string; date: string; term: string; amount: number | ''; method: string;
  reference: string; paidBy: string; note: string;
}

/** Record or edit a payment. `learners` limits the learner picker (e.g. a class); omit when the learner is fixed. */
export function PaymentModal({ initial, learners, onClose, onSaved }: {
  initial: Partial<Payment>; learners?: { id: number; name: string; className?: string; balance?: number }[];
  onClose: () => void; onSaved: (p: any) => void;
}) {
  const { meta } = useMeta();
  const s = meta.settings;
  const [p, setP] = useState<Payment>({
    studentId: '', date: meta.today, term: meta.term, amount: '', method: s.payMethods[0] ?? '', reference: '', paidBy: '', note: '', ...initial,
  });
  const { busy, run } = useAction();
  const set = (patch: Partial<Payment>) => setP((x) => ({ ...x, ...patch }));
  const save = async () => {
    const r = await run(() => (p.id ? api.put(`/payments/${p.id}`, p) : api.post('/payments', p)), p.id ? 'Payment updated' : 'Payment recorded');
    if (r) onSaved(r);
  };
  const owing = learners?.find((l) => l.id === p.studentId)?.balance;
  return (
    <Modal title={p.id ? `Edit payment ${p.receiptNo}` : 'Record payment'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save payment'}</button>
    </>}>
      <div className="form-grid">
        {learners && (
          <Field label="Learner *" wide>
            <Select value={String(p.studentId)} onChange={(v) => set({ studentId: v ? +v : '' })} placeholder="Pick a learner…"
              options={learners.map((l) => ({ value: String(l.id), label: `${l.name}${l.className ? ` · ${l.className}` : ''}${l.balance ? ` · owes ${money(s, l.balance)}` : ''}` }))} />
          </Field>
        )}
        <Field label="Amount *" hint={owing ? `Balance ${money(s, owing)}` : undefined}>
          <div className="input-group">
            <input type="number" min="0" step="any" value={p.amount} onChange={(e) => set({ amount: e.target.value === '' ? '' : +e.target.value })} autoFocus />
            {owing ? <button type="button" className="btn sm" onClick={() => set({ amount: owing })}>Full</button> : null}
          </div>
        </Field>
        <Field label="Payment date *"><input type="date" value={p.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label="Term *"><Select value={p.term} onChange={(v) => set({ term: v })} options={s.terms.map((t) => t.name)} /></Field>
        <Field label="Method"><Select value={p.method} onChange={(v) => set({ method: v })} options={s.payMethods} /></Field>
        <Field label="Reference"><input value={p.reference ?? ''} onChange={(e) => set({ reference: e.target.value })} /></Field>
        <Field label="Paid by"><input value={p.paidBy ?? ''} onChange={(e) => set({ paidBy: e.target.value })} /></Field>
        <Field label="Note" wide><input value={p.note ?? ''} onChange={(e) => set({ note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function ReceiptModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { meta } = useMeta();
  const s = meta.settings;
  const { data, error } = useApi<any>(`/payments/${id}`);
  return (
    <Modal title="Receipt" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn primary" onClick={() => window.print()}>Print</button>
    </>}>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="receipt print-area">
          <div className="receipt-head">
            <div><h3>{data.school.name}</h3><div className="muted small">{data.school.address}<br />{data.school.contact}</div></div>
            <div className="right"><div className="receipt-no">{data.payment.receiptNo}</div><div className="muted small">{fmtDate(data.payment.date)}</div></div>
          </div>
          <h4>OFFICIAL RECEIPT</h4>
          <dl className="receipt-dl">
            <dt>Received for</dt><dd>{data.student?.name} · {data.student?.className} · {data.student?.learnerNo}</dd>
            <dt>Term</dt><dd>{data.payment.term}</dd>
            <dt>Method</dt><dd>{data.payment.method}{data.payment.reference ? ` · ${data.payment.reference}` : ''}</dd>
            {data.payment.paidBy && <><dt>Paid by</dt><dd>{data.payment.paidBy}</dd></>}
            {data.payment.note && <><dt>Note</dt><dd>{data.payment.note}</dd></>}
          </dl>
          <div className="receipt-amount">{money(s, data.payment.amount)}</div>
          <table className="table compact">
            <tbody>
              <tr><td>{data.payment.term} fees</td><td className="num">{money(s, data.billed)}</td></tr>
              <tr><td>Paid to date (incl. this receipt)</td><td className="num">{money(s, data.paidToDate)}</td></tr>
              <tr><td><b>Balance</b></td><td className="num"><b>{money(s, Math.max(0, data.balanceAfter))}</b></td></tr>
            </tbody>
          </table>
          <p className="muted small">Thank you.</p>
        </div>
      )}
    </Modal>
  );
}

export interface Plan { id?: number; studentId: number | ''; term: string; agreedOn: string; instalment: number | ''; nextDue: string; note: string }

export function PlanModal({ initial, learners, onClose, onSaved }: {
  initial: Partial<Plan>; learners?: { id: number; name: string; className?: string; balance?: number }[]; onClose: () => void; onSaved: () => void;
}) {
  const { meta } = useMeta();
  const [p, setP] = useState<Plan>({ studentId: '', term: meta.term, agreedOn: meta.today, instalment: '', nextDue: '', note: 'Instalments agreed', ...initial });
  const { busy, run } = useAction();
  const set = (patch: Partial<Plan>) => setP((x) => ({ ...x, ...patch }));
  const save = async () => {
    const r = await run(() => (p.id ? api.put(`/paymentPlans/${p.id}`, p) : api.post('/paymentPlans', p)), 'Payment plan saved');
    if (r) onSaved();
  };
  return (
    <Modal title={p.id ? 'Edit payment plan' : 'New payment plan'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={busy}>Save plan</button>
    </>}>
      <p className="muted small">While the next instalment date has not passed, the learner's fees do not count as overdue.</p>
      <div className="form-grid">
        {learners && (
          <Field label="Learner *" wide>
            <Select value={String(p.studentId)} onChange={(v) => set({ studentId: v ? +v : '' })} placeholder="Pick a learner…"
              options={learners.map((l) => ({ value: String(l.id), label: `${l.name}${l.className ? ` · ${l.className}` : ''}${l.balance ? ` · owes ${money(meta.settings, l.balance)}` : ''}` }))} />
          </Field>
        )}
        <Field label="Term *"><Select value={p.term} onChange={(v) => set({ term: v })} options={meta.settings.terms.map((t) => t.name)} /></Field>
        <Field label="Agreed on"><input type="date" value={p.agreedOn} onChange={(e) => set({ agreedOn: e.target.value })} /></Field>
        <Field label="Instalment *"><input type="number" min="0" step="any" value={p.instalment} onChange={(e) => set({ instalment: e.target.value === '' ? '' : +e.target.value })} /></Field>
        <Field label="Next due *"><input type="date" value={p.nextDue} onChange={(e) => set({ nextDue: e.target.value })} /></Field>
        <Field label="Note" wide><input value={p.note ?? ''} onChange={(e) => set({ note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
