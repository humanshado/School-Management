import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { PaymentModal, PlanModal, ReceiptModal } from '../components/Payments';
import { Card, Empty, ErrorBox, Kpi, Loading, MessagesModal, Meter, PageHead, useAction, useApi, useMeta } from '../components/ui';
import { fmtDate, fmtShort, money, pct } from '../format';
import type { ClassStats, Kpis } from '../types';

interface FeeLearner { id: number; name: string; className: string; learnerNo: string; billed: number; paid: number; balance: number; overdue: number; feeStatus: string; hasPlan: boolean; planNext: string | null }
interface FeesData {
  useFees: boolean; term: string; feesDue: string | null; today: string; kpis: Kpis; classes: ClassStats[]; learners: FeeLearner[];
  recent: any[]; plans: any[]; nextReceipt: string;
}

export default function Fees() {
  const { meta, reload: reloadMeta } = useMeta();
  const s = meta.settings;
  const [cls, setCls] = useState('');
  const [show, setShow] = useState<'owing' | 'overdue' | 'all'>('owing');
  const { data, error, reload } = useApi<FeesData>(`/fees${qs({ class: cls })}`);
  const [pay, setPay] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [receipt, setReceipt] = useState<number | null>(null);
  const [remind, setRemind] = useState<number[] | null>(null);
  const { run } = useAction();

  const learners = useMemo(() => (data?.learners ?? []).filter((l) => show === 'all' || (show === 'overdue' ? l.overdue > 0 : l.balance > 0.005)).sort((a, b) => b.overdue - a.overdue || b.balance - a.balance), [data, show]);

  if (!s.useFees) return <><PageHead title="Fees & Receipts" /><Card><Empty>Fees are switched off. Turn them on in <Link to="/admin">Admin</Link>.</Empty></Card></>;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const refresh = () => { reload(); reloadMeta(); };
  const allLearners = data.learners.map((l) => ({ id: l.id, name: l.name, className: l.className, balance: l.balance }));
  const overdueIds = data.learners.filter((l) => l.overdue > 0).map((l) => l.id);

  return (
    <>
      <PageHead title="Fees & Receipts" sub={`${data.term}${data.feesDue ? ` · fees due ${fmtDate(data.feesDue)}` : ''}`}>
        <button className="btn" disabled={!overdueIds.length} onClick={() => setRemind(overdueIds)}>Send reminders ({overdueIds.length})</button>
        <button className="btn primary" onClick={() => setPay({})}>Record payment</button>
      </PageHead>
      <div className="kpis">
        <Kpi label="Billed this term" value={money(s, k.billed)} sub={`${k.learners} learners`} />
        <Kpi label="Collected" value={pct(k.billed ? k.paid / k.billed : null)} sub={money(s, k.paid)} tone="good" />
        <Kpi label="Still to pay" value={money(s, k.balance)} />
        <Kpi label="Overdue" value={k.overdueCount} sub={money(s, k.overdueAmount)} tone={k.overdueCount ? 'bad' : undefined} />
        <Kpi label="On a payment plan" value={k.plans} />
        <Kpi label="Receipts today" value={k.receiptsToday} sub={money(s, k.receiptsTodayAmount)} />
      </div>

      <div className="grid g-fees">
        <Card title="Every class" pad={false}>
          <table className="table compact hover">
            <thead><tr><th>Class</th><th className="num">Balance</th><th>Collected</th><th className="num">Overdue</th></tr></thead>
            <tbody>
              <tr className={!cls ? 'sel' : ''} onClick={() => setCls('')}><td><b>All classes</b></td><td className="num">{money(s, k.balance)}</td><td /><td className="num">{k.overdueCount}</td></tr>
              {data.classes.map((c) => {
                const coll = c.billed ? c.paid / c.billed : null;
                return (
                  <tr key={c.id} className={cls === c.name ? 'sel' : ''} onClick={() => setCls(c.name)}>
                    <td><b>{c.name}</b></td><td className="num">{money(s, c.balance)}</td>
                    <td><div className="meter-cell"><Meter value={coll} />{pct(coll)}</div></td>
                    <td className={`num ${c.overdue ? 'bad-text' : ''}`}>{c.overdue}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title={`Who owes what · ${cls || 'all classes'}`} pad={false} className="span-2" actions={
          <div className="seg">
            {(['owing', 'overdue', 'all'] as const).map((x) => <button key={x} className={show === x ? 'on' : ''} onClick={() => setShow(x)}>{x === 'owing' ? 'Owing' : x === 'overdue' ? 'Overdue' : 'Everyone'}</button>)}
          </div>
        }>
          {learners.length === 0 ? <Empty>Nobody {show === 'overdue' ? 'is overdue' : 'owes anything'} here.</Empty> : (
            <div className="table-wrap list-scroll">
              <table className="table compact">
                <thead><tr><th>Learner</th><th>Class</th><th className="num">Billed</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {learners.map((l) => (
                    <tr key={l.id}>
                      <td><Link to={`/students/${l.id}`}>{l.name}</Link></td><td>{l.className}</td>
                      <td className="num">{money(s, l.billed)}</td><td className="num">{money(s, l.paid)}</td>
                      <td className="num"><b>{money(s, l.balance)}</b></td>
                      <td><span className={`pill ${l.overdue ? 'bad' : l.balance <= 0.005 ? 'ok' : l.hasPlan ? 'info' : ''}`}>{l.feeStatus || '–'}</span></td>
                      <td className="right nowrap">
                        {l.balance > 0.005 && <button className="btn sm primary" onClick={() => setPay({ studentId: l.id, amount: l.balance })}>Pay</button>}
                        {l.balance > 0.005 && !l.hasPlan && <button className="btn sm ghost" onClick={() => setPlan({ studentId: l.id })}>Plan</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Recent payments" pad={false} className="span-2">
          {data.recent.length === 0 ? <Empty>No payments yet.</Empty> : (
            <div className="table-wrap">
              <table className="table compact hover">
                <thead><tr><th>Receipt</th><th>Date</th><th>Learner</th><th>Term</th><th>Method</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>
                  {data.recent.map((p) => (
                    <tr key={p.id} onClick={() => setReceipt(p.id)}>
                      <td>{p.receiptNo}</td><td>{fmtShort(p.date)}</td><td>{p.name} <span className="muted small">{p.className}</span></td><td>{p.term}</td><td className="muted">{p.method}</td>
                      <td className="num"><b>{money(s, p.amount)}</b></td>
                      <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                        <button className="btn sm ghost" onClick={() => setPay(p)}>Edit</button>
                        <button className="btn sm ghost" onClick={() => run(async () => { if (confirm(`Delete receipt ${p.receiptNo}?`)) { await api.del(`/payments/${p.id}`); refresh(); } }, undefined)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={`Payment plans · ${data.term}`} pad={false} actions={<button className="btn sm" onClick={() => setPlan({})}>New plan</button>}>
          {data.plans.length === 0 ? <Empty>No payment plans.</Empty> : (
            <table className="table compact hover">
              <thead><tr><th>Learner</th><th className="num">Instalment</th><th>Next due</th></tr></thead>
              <tbody>
                {data.plans.map((p) => (
                  <tr key={p.id} onClick={() => setPlan(p)}>
                    <td>{p.name}<div className="muted small">owes {money(s, p.balance)}</div></td>
                    <td className="num">{money(s, p.instalment)}</td>
                    <td className={p.nextDue < data.today ? 'bad-text' : ''}>{fmtShort(p.nextDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {pay && <PaymentModal initial={pay} learners={pay.id ? undefined : allLearners} onClose={() => setPay(null)} onSaved={(p) => { setPay(null); refresh(); if (!pay.id) setReceipt(p.id); }} />}
      {plan && <PlanModal initial={plan} learners={plan.id || plan.studentId ? undefined : allLearners} onClose={() => setPlan(null)} onSaved={() => { setPlan(null); refresh(); }} />}
      {receipt && <ReceiptModal id={receipt} onClose={() => setReceipt(null)} />}
      {remind && <MessagesModal kind="fees" learnerIds={remind} title={`Fee reminders · ${remind.length} overdue`} onClose={() => setRemind(null)} />}
    </>
  );
}
