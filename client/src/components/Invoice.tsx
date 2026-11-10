import { useState } from 'react';
import { fmtDate, money, type MoneySettings } from '../format';
import { ErrorBox, Loading, Modal, Select, useApi } from './ui';

export interface InvoiceData {
  invoiceNo: string; term: string; issued: string | null; due: string | null;
  learner: { name: string; learnerNo: string; className: string; guardianName: string; address: string };
  lines: { item: string; amount: number }[]; total: number; payments: { receiptNo: string; date: string; amount: number; method: string }[]; paid: number; balance: number;
  school: { name: string; address: string; contact: string };
}
export interface StatementData {
  learner: InvoiceData['learner']; rows: { date: string; what: string; charge: number; payment: number; balance: number }[]; balance: number; asOf: string;
  school: InvoiceData['school']; note: string;
}

function Head({ school, title, sub }: { school: InvoiceData['school']; title: string; sub: string }) {
  return <div className="receipt-head"><div><h3>{school.name}</h3><div className="muted small">{school.address}<br />{school.contact}</div></div><div className="right"><div className="receipt-no">{title}</div><div className="muted small">{sub}</div></div></div>;
}
function To({ l }: { l: InvoiceData['learner'] }) {
  return <dl className="receipt-dl"><dt>Learner</dt><dd>{l.name} · {l.className} · {l.learnerNo}</dd>{l.guardianName && <><dt>To</dt><dd>{l.guardianName}{l.address ? `, ${l.address}` : ''}</dd></>}</dl>;
}

export function InvoiceView({ inv, s }: { inv: InvoiceData; s: MoneySettings }) {
  return (
    <article className="receipt invoice">
      <Head school={inv.school} title="INVOICE" sub={`${inv.invoiceNo} · ${inv.term}`} />
      <To l={inv.learner} />
      <table className="table compact">
        <thead><tr><th>Item</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {inv.lines.map((l) => <tr key={l.item}><td>{l.item}</td><td className="num">{money(s, l.amount)}</td></tr>)}
          <tr><td><b>Total for {inv.term}</b></td><td className="num"><b>{money(s, inv.total)}</b></td></tr>
          {inv.payments.map((p) => <tr key={p.receiptNo}><td className="muted">Paid {fmtDate(p.date)} · {p.receiptNo}</td><td className="num muted">−{money(s, p.amount)}</td></tr>)}
          <tr><td><b>Balance due{inv.due ? ` by ${fmtDate(inv.due)}` : ''}</b></td><td className="num"><b>{money(s, Math.max(0, inv.balance))}</b></td></tr>
        </tbody>
      </table>
      {inv.balance <= 0.005 && <p className="good-text">Paid in full. Thank you.</p>}
    </article>
  );
}

export function StatementView({ st, s }: { st: StatementData; s: MoneySettings }) {
  return (
    <article className="receipt invoice">
      <Head school={st.school} title="STATEMENT" sub={`as of ${fmtDate(st.asOf)}`} />
      <To l={st.learner} />
      <table className="table compact">
        <thead><tr><th>Date</th><th>Description</th><th className="num">Charge</th><th className="num">Payment</th><th className="num">Balance</th></tr></thead>
        <tbody>{st.rows.map((r, i) => <tr key={i}><td className="nowrap">{fmtDate(r.date)}</td><td>{r.what}</td><td className="num">{r.charge ? money(s, r.charge) : ''}</td><td className="num">{r.payment ? money(s, r.payment) : ''}</td><td className="num">{money(s, r.balance)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4}>{st.balance >= 0 ? 'Balance owed' : 'In credit'}</td><td className="num"><b>{money(s, Math.abs(st.balance))}</b></td></tr></tfoot>
      </table>
      <p className="muted small">{st.note}</p>
    </article>
  );
}


/** Invoices (one learner, or a whole class) or a statement, ready to print. `path` is the API to load. */
export function FeeDocModal({ path, kind, title, s, terms, term, classes, onClose }: {
  path: (o: { term: string; cls: string }) => string; kind: 'invoices' | 'invoice' | 'statement'; title: string; s: MoneySettings;
  terms?: string[]; term?: string; classes?: string[]; onClose: () => void;
}) {
  const [t, setT] = useState(term ?? '');
  const [cls, setCls] = useState(classes?.[0] ?? '');
  const { data, error } = useApi<any>(path({ term: t, cls }));
  const list: InvoiceData[] = kind === 'statement' || !data ? [] : Array.isArray(data) ? data : [data];
  return (
    <Modal wide title={title} onClose={onClose} footer={<>
      {terms && kind !== 'statement' && <Select value={t} onChange={setT} options={terms} aria-label="Term" style={{ width: 'auto', marginRight: 'auto' }} />}
      {classes && <Select value={cls} onChange={setCls} options={classes} aria-label="Class" style={{ width: 'auto' }} />}
      <button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => window.print()}>Print</button>
    </>}>
      {error && <ErrorBox error={error} />}
      {!data ? !error && <Loading /> : (
        <div className="print-area docs">
          {kind === 'statement' ? <StatementView st={data} s={s} /> : list.map((inv) => <InvoiceView key={inv.invoiceNo} inv={inv} s={s} />)}
        </div>
      )}
    </Modal>
  );
}
