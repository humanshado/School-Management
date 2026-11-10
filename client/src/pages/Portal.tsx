import { useEffect, useState } from 'react';
import { api } from '../api';
import Files from '../components/Files';
import { BarChart, Card, Empty, ErrorBox, Kpi, Loading, Modal, Select, useApi } from '../components/ui';
import { daysBetween, fmtDate, fmtDay, fmtShort, markClass, money, num1, pct, ROLE_LABEL, signed, type MoneySettings } from '../format';
import type { FileDoc, Settings, User } from '../types';
import { NoticeItem, type Notice } from './Notices';
import { ReportCard, type RCData } from './ReportCards';
import { WeekGrid } from './Timetable';

interface Me {
  user: User; today: string; term: string; termStart: string | null; termEnd: string | null;
  school: { name: string; address: string; contact: string; principal: string };
  settings: Pick<Settings, 'currencySymbol' | 'currencyDecimals' | 'useFees' | 'gradeBands' | 'subjects' | 'lateCountsPresent'> & { terms: string[] };
  learners: { id: number; name: string; firstName: string; className: string; learnerNo: string }[];
}
type Tab = 'overview' | 'report' | 'attendance' | 'homework' | 'timetable' | 'fees' | 'notices';

/** Parents and students: their own learners only. */
export default function Portal({ onLogout }: { onLogout: () => void }) {
  const { data: me, error, reload } = useApi<Me>('/portal/me');
  const [learnerId, setLearnerId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => { if (me && !learnerId && me.learners[0]) setLearnerId(me.learners[0].id); }, [me, learnerId]);
  if (error) return <div className="boot"><ErrorBox error={error} retry={reload} /></div>;
  if (!me) return <div className="boot"><Loading /></div>;
  const logout = async () => { await api.post('/auth/logout').catch(() => {}); onLogout(); };
  const learner = me.learners.find((l) => l.id === learnerId);
  const tabs: [Tab, string][] = [['overview', 'Overview'], ['report', 'Report card'], ['attendance', 'Attendance'], ['homework', 'Homework'], ['timetable', 'Timetable'], ...(me.settings.useFees ? [['fees', 'Fees'] as [Tab, string]] : []), ['notices', 'Notices']];
  return (
    <div className="portal">
      <header className="portal-bar">
        <div className="brand"><div className="logo" aria-hidden>▲</div><div><b>{me.school.name}</b><small>{me.term} · {fmtDay(me.today)}</small></div></div>
        <div className="portal-user">
          <span>{me.user.name} <small>{ROLE_LABEL[me.user.role]}</small></span>
          <button className="btn sm" onClick={logout}>Log out</button>
        </div>
      </header>
      <main className="portal-main">
        {!me.learners.length ? <Card><Empty>Your login is not linked to a learner yet. Please contact the school office: {me.school.contact}</Empty></Card> : <>
          <div className="portal-head">
            {me.learners.length > 1
              ? <Select value={String(learnerId ?? '')} onChange={(v) => setLearnerId(+v)} options={me.learners.map((l) => ({ value: String(l.id), label: `${l.name} · ${l.className}` }))} aria-label="Child" />
              : <h1>{learner?.name}</h1>}
            <span className="muted">{learner?.className} · {learner?.learnerNo}</span>
          </div>
          <div className="tabs" role="tablist">
            {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {learnerId && (tab === 'notices' ? <Notices /> : tab === 'timetable' ? <ScheduleTab id={learnerId} /> : tab === 'homework' ? <HomeworkTab id={learnerId} today={me.today} />
            : tab === 'report' ? <ReportTab id={learnerId} terms={me.settings.terms} term={me.term} />
            : <LearnerTabs key={learnerId} id={learnerId} me={me} tab={tab} go={setTab} />)}
        </>}
      </main>
      <footer className="portal-foot muted small">{me.school.name} · {me.school.address} · {me.school.contact}</footer>
    </div>
  );
}

function LearnerTabs({ id, me, tab, go }: { id: number; me: Me; tab: Tab; go: (t: Tab) => void }) {
  const { data, error, reload } = useApi<any>(`/portal/learners/${id}`);
  const [receipt, setReceipt] = useState<number | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const s = me.settings;
  const a = data.attendance, g = data.grades, f = data.fees;
  if (tab === 'overview') return (
    <>
      <div className="kpis">
        <Kpi label="Attendance this term" value={pct(a.att)} sub={`${a.absent} absent · ${a.late} late`} />
        <Kpi label="Term average" value={num1(g.avg)} sub={g.chg !== null ? `${signed(g.chg)} on last term` : 'first term'} />
        {g.pos && <Kpi label="Position in class" value={g.pos} sub={`of ${g.classSize}`} />}
        {f && <Kpi label="Fees to pay" value={money(s, Math.max(0, f.balance))} sub={f.status || '–'} tone={f.overdue ? 'bad' : undefined} />}
      </div>
      <div className="grid g2">
        <Card title="Homework due" actions={<button className="btn sm" onClick={() => go('homework')}>All homework</button>}>
          {!data.homeworkDue.length ? <Empty>Nothing due. 🎉</Empty> : (
            <ul className="events">{data.homeworkDue.map((w: any) => <li key={w.id}><span className="ev-date">{w.dueOn ? fmtShort(w.dueOn) : '–'}</span><span className="ev-label">{w.title}</span><span className="muted small">{w.subject}</span></li>)}</ul>
          )}
        </Card>
        <Card title="Marks this term" pad={false}>
          <table className="table compact"><thead><tr><th>Subject</th><th className="num">Mark</th><th className="num">Class avg</th></tr></thead>
            <tbody>{g.subjects.map((x: any) => <tr key={x.subject}><td>{x.subject}</td><td className="num"><b>{x.mark ?? '–'}</b></td><td className="num muted">{x.classAvg ?? '–'}</td></tr>)}</tbody></table>
        </Card>
        <Card title={`Class teacher`}><p>{data.classTeacher || '–'}</p><p className="muted small">Questions? Contact the school office: {me.school.contact}</p></Card>
      </div>
    </>
  );
  if (tab === 'attendance') return (
    <div className="grid g2">
      <Card title="Attendance by week"><BarChart data={data.weeks.map((w: any) => ({ label: w.label, value: w.pct }))} min={0} /></Card>
      <Card title="Last 10 school days">
        <div className="last10">{data.lastDays.map((d: any) => <span key={d.date} className={`day ${markClass(d.mark)}`}><b>{d.mark}</b><small>{fmtShort(d.date)}</small></span>)}</div>
        <p className="muted small">P present · A absent · L late · E excused</p>
      </Card>
      <Card title={`Absences and lates · ${me.term}`} className="span-2" pad={false}>
        {!data.absences.length ? <Empty>Present every day this term.</Empty> : (
          <table className="table compact"><tbody>{data.absences.map((x: any) => <tr key={x.date}><td>{fmtDate(x.date)}</td><td><span className={`dot ${markClass(x.mark)}`}>{x.mark}</span></td><td className="muted">{x.note || ''}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  );
  // fees
  if (!f) return <Card><Empty>Fees are not shown here.</Empty></Card>;
  return (
    <>
      <div className="kpis">
        <Kpi label={`${me.term} fees`} value={money(s, f.billed)} sub={f.feesDue ? `due ${fmtDate(f.feesDue)}` : undefined} />
        <Kpi label="Paid" value={money(s, f.paid)} tone="good" />
        <Kpi label="Still to pay" value={money(s, Math.max(0, f.balance))} sub={f.status} tone={f.overdue ? 'bad' : undefined} />
      </div>
      {f.plans.length > 0 && <Card title="Payment plan"><p>Instalments of {money(s, f.plans[0].instalment)}; next due {fmtDate(f.plans[0].nextDue)}.</p></Card>}
      <Card title="Payments" pad={false}>
        {!f.payments.length ? <Empty>No payments yet.</Empty> : (
          <table className="table compact hover"><thead><tr><th>Receipt</th><th>Date</th><th>Term</th><th className="num">Amount</th></tr></thead>
            <tbody>{f.payments.map((p: any) => <tr key={p.id} onClick={() => setReceipt(p.id)}><td>{p.receiptNo}</td><td>{fmtDate(p.date)}</td><td>{p.term}</td><td className="num">{money(s, p.amount)}</td></tr>)}</tbody></table>
        )}
      </Card>
      <p className="muted small">To pay, use the school's usual payment methods; the payment shows here once the office records it. Questions: {me.school.contact}</p>
      {receipt && <PortalReceipt id={receipt} s={s} onClose={() => setReceipt(null)} />}
    </>
  );
}

function PortalReceipt({ id, s, onClose }: { id: number; s: MoneySettings; onClose: () => void }) {
  const { data, error } = useApi<any>(`/portal/payments/${id}`);
  return (
    <Modal title="Receipt" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => window.print()}>Print</button></>}>
      {error && <ErrorBox error={error} />}
      {!data ? !error && <Loading /> : (
        <div className="receipt print-area">
          <div className="receipt-head"><div><h3>{data.school.name}</h3><div className="muted small">{data.school.address}<br />{data.school.contact}</div></div>
            <div className="right"><div className="receipt-no">{data.payment.receiptNo}</div><div className="muted small">{fmtDate(data.payment.date)}</div></div></div>
          <h4>OFFICIAL RECEIPT</h4>
          <dl className="receipt-dl"><dt>Received for</dt><dd>{data.student.name} · {data.student.className}</dd><dt>Term</dt><dd>{data.payment.term}</dd><dt>Method</dt><dd>{data.payment.method}</dd></dl>
          <div className="receipt-amount">{money(s, data.payment.amount)}</div>
          <table className="table compact"><tbody>
            <tr><td>{data.payment.term} fees</td><td className="num">{money(s, data.billed)}</td></tr>
            <tr><td>Paid to date</td><td className="num">{money(s, data.paidToDate)}</td></tr>
            <tr><td><b>Balance</b></td><td className="num"><b>{money(s, Math.max(0, data.balanceAfter))}</b></td></tr>
          </tbody></table>
        </div>
      )}
    </Modal>
  );
}

function ReportTab({ id, terms, term }: { id: number; terms: string[]; term: string }) {
  const [t, setT] = useState(term);
  const { data, error } = useApi<{ school: RCData['school']; gradeBands: RCData['gradeBands']; card: any }>(`/portal/learners/${id}/report?term=${encodeURIComponent(t)}`);
  return (
    <>
      <div className="portal-tools no-print">
        <Select value={t} onChange={setT} options={terms} aria-label="Term" />
        <button className="btn" onClick={() => window.print()}>Print / save as PDF</button>
      </div>
      {error && <ErrorBox error={error} />}
      {!data ? !error && <Loading /> : <div className="print-area"><ReportCard rc={{ ...data.card, canEditTeacher: false, canEditPrincipal: false }} school={data.school} bands={data.gradeBands} readOnly /></div>}
    </>
  );
}

function HomeworkTab({ id, today }: { id: number; today: string }) {
  const { data, error } = useApi<{ homework: any[]; materials: any[] }>(`/portal/learners/${id}/homework`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const upcoming = data.homework.filter((w) => !w.dueOn || w.dueOn >= today).reverse(), past = data.homework.filter((w) => w.dueOn && w.dueOn < today);
  const item = (w: any, kind: string) => (
    <Card key={`${kind}${w.id}`} className="hw-card" title={<>{w.subject && <span className="pill">{w.subject}</span>} {w.title}</>}
      actions={w.dueOn ? <span className={`pill ${w.dueOn < today ? '' : daysBetween(today, w.dueOn) <= 1 ? 'warn' : 'info'}`}>due {fmtDay(w.dueOn)}</span> : undefined}>
      {w.details && <p className="pre hw-details">{w.details}</p>}
      {w.link && <p><a href={w.link} target="_blank" rel="noopener noreferrer">{w.link}</a></p>}
      {w.files.length > 0 && <Files ownerType={kind} ownerId={w.id} files={w.files as FileDoc[]} />}
      <p className="muted small">{w.postedBy}</p>
    </Card>
  );
  return (
    <>
      <h2 className="sub-h">Homework to do</h2>
      {!upcoming.length ? <Card><Empty>No homework due.</Empty></Card> : <div className="hw-list">{upcoming.map((w) => item(w, 'homework'))}</div>}
      <h2 className="sub-h">Study materials</h2>
      {!data.materials.length ? <Card><Empty>No materials yet.</Empty></Card> : <div className="hw-list">{data.materials.map((w) => item(w, 'material'))}</div>}
      {past.length > 0 && <><h2 className="sub-h">Past homework</h2><div className="hw-list">{past.map((w) => item(w, 'homework'))}</div></>}
    </>
  );
}

function Notices() {
  const { data, error } = useApi<Notice[]>('/portal/notices');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return !data.length ? <Card><Empty>No notices.</Empty></Card> : <div className="notices">{data.map((n) => <NoticeItem key={n.id} n={n} />)}</div>;
}

function ScheduleTab({ id }: { id: number }) {
  const { data, error } = useApi<any>(`/portal/learners/${id}/schedule`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <Card title="Upcoming exams" pad={false}>
        {!data.exams.length ? <Empty>No exams scheduled.</Empty> : (
          <table className="table compact"><tbody>{data.exams.map((e: any) => <tr key={e.id}><td><b>{fmtDay(e.date)}</b></td><td className="nowrap">{e.start}–{e.end}</td><td>{e.subject}{e.title ? <span className="muted"> · {e.title}</span> : ''}</td><td className="muted">{e.room}</td></tr>)}</tbody></table>
        )}
      </Card>
      <Card title="Weekly timetable">
        {!data.lessons.length ? <Empty>The timetable has not been published yet.</Empty> : (
          <WeekGrid days={data.days} periods={data.periods} cell={(d, p) => data.lessons.filter((l: any) => l.day === d && l.period === p).map((l: any, i: number) => (
            <div key={i} className="tt-lesson"><b>{l.subject}</b><small>{[l.teacher, l.room].filter(Boolean).join(' · ')}</small></div>
          ))} />
        )}
      </Card>
    </>
  );
}
