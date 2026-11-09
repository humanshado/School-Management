import { useState } from 'react';
import { Link } from 'react-router-dom';
import Register from '../components/Register';
import { BarChart, Card, Empty, ErrorBox, Flags, Kpi, Loading, MessagesModal, PageHead, Select, useApi, useMeta } from '../components/ui';
import { daysBetween, fmtLong, fmtShort, money, pct, signed } from '../format';
import type { ClassStats, Kpis, StudentStats } from '../types';

type Learner = StudentStats & { guardianName: string; guardianPhone: string; guardianEmail: string };
interface TodayData {
  today: string; term: string; schoolDay: boolean; holiday: string; kpis: Kpis; weeks: { label: string; pct: number }[];
  classes: ClassStats[]; risk: Learner[]; watch: Learner[]; flagMax: number;
  upcoming: { date: string; label: string; kind: string }[];
  receipts: { id: number; receiptNo: string; amount: number; name: string; method: string }[];
}

export default function Today() {
  const { meta } = useMeta();
  const s = meta.settings;
  const { data, error, reload } = useApi<TodayData>('/today');
  const [cls, setCls] = useState(() => localStorage.getItem('today.class') ?? '');
  const [mail, setMail] = useState<Learner | null>(null);
  const [showWatch, setShowWatch] = useState(false);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const regClass = cls && meta.classes.includes(cls) ? cls : data.classes.find((c) => c.today === 'No')?.name ?? meta.classes[0] ?? '';
  const pick = (c: string) => { setCls(c); try { localStorage.setItem('today.class', c); } catch { /* private mode */ } };
  const list = showWatch ? data.watch : data.risk;

  return (
    <>
      <PageHead title="Today" sub={<>{fmtLong(data.today)}{data.holiday ? ` · ${data.holiday}` : !data.schoolDay ? ' · not a school day' : ''}</>} />

      <div className="kpis">
        <Kpi label="Present today" value={k.enrolledToday ? pct(k.presentToday / k.enrolledToday, 1) : '–'} sub={k.enrolledToday ? `${k.presentToday} of ${k.enrolledToday} in registers taken` : 'no registers yet'} />
        <Kpi label="Registers" value={`${k.regTaken} / ${k.regTaken + k.regNot}`} sub={k.regNot ? `${k.regNot} not taken` : 'all taken'} tone={k.regNot ? 'warn' : 'good'} />
        <Kpi label="At risk" value={k.risk} sub={`${k.watch} on the watch list`} tone={k.risk ? 'bad' : undefined} />
        {s.useFees && <Kpi label="Fees overdue" value={k.overdueCount} sub={money(s, k.overdueAmount)} tone={k.overdueCount ? 'warn' : undefined} />}
        {s.useFees && <Kpi label="Receipts today" value={k.receiptsToday} sub={money(s, k.receiptsTodayAmount)} />}
      </div>

      <div className="grid g-today">
        <Card title="Morning register" className="span-2" actions={<Select value={regClass} onChange={pick} options={meta.classes} aria-label="Class" />}>
          <Register className={regClass} date={data.today} compact onSaved={reload} />
        </Card>

        <Card title="All classes today" pad={false}>
          <table className="table compact">
            <thead><tr><th>Class</th><th>Teacher</th><th>Register</th><th className="num">Present</th></tr></thead>
            <tbody>
              {data.classes.map((c) => (
                <tr key={c.id} className={c.name === regClass ? 'sel' : ''} onClick={() => pick(c.name)} style={{ cursor: 'pointer' }}>
                  <td><b>{c.name}</b></td>
                  <td className="muted">{c.teacher}</td>
                  <td>{c.today === 'Yes' ? <span className="pill ok">Taken</span> : c.today === 'No' ? <span className="pill warn">Not taken</span> : <span className="muted">–</span>}</td>
                  <td className="num">{c.today === 'Yes' ? `${c.todayPresent}/${c.todayEnrolled}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title={showWatch ? 'Watch list · 1 flag' : 'Learners at risk · 2+ flags'} className="span-2" pad={false} actions={
          <div className="seg">
            <button className={!showWatch ? 'on' : ''} onClick={() => setShowWatch(false)}>At risk ({data.risk.length})</button>
            <button className={showWatch ? 'on' : ''} onClick={() => setShowWatch(true)}>Watch ({data.watch.length})</button>
          </div>
        }>
          {list.length === 0 ? <Empty>Nobody here. 🎉</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Learner</th><th>Class</th><th className="num">Attend.</th><th className="num">Average</th><th className="num">Change</th>{s.useFees && <th>Fees</th>}<th>Flags</th><th /></tr></thead>
                <tbody>
                  {list.map((x) => (
                    <tr key={x.id}>
                      <td><Link to={`/students/${x.id}`}>{x.name}</Link></td>
                      <td>{x.className}</td>
                      <td className={`num ${x.reasons.includes('attendance') ? 'bad-text' : ''}`}>{pct(x.att)}</td>
                      <td className="num">{x.avg === null ? '–' : Math.round(x.avg)}</td>
                      <td className={`num ${x.reasons.includes('grades') ? 'bad-text' : ''}`}>{signed(x.chg)}</td>
                      {s.useFees && <td className={x.reasons.includes('fees') ? 'bad-text' : 'muted'}>{x.feeStatus || '–'}</td>}
                      <td><Flags n={x.flags} max={data.flagMax} reasons={x.reasons} /></td>
                      <td className="right"><button className="btn sm" onClick={() => setMail(x)}>E-mail</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small pad-x">Flags: attendance under {pct(s.riskAttendance)} · average down {s.riskDrop}+ points on last term{s.useFees ? ' · fees overdue' : ''}.</p>
        </Card>

        <Card title="Coming up">
          {data.upcoming.length === 0 ? <Empty>Nothing in the next 45 days.</Empty> : (
            <ul className="events">
              {data.upcoming.map((e, i) => {
                const n = daysBetween(data.today, e.date);
                return (
                  <li key={i} className={`ev-${e.kind}`}>
                    <span className="ev-date">{fmtShort(e.date)}</span>
                    <span className="ev-label">{e.label}</span>
                    <span className="muted small">{n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="School attendance by week" className="span-2">
          <BarChart data={data.weeks.map((w) => ({ label: w.label, value: w.pct }))} threshold={s.riskAttendance * 100} />
        </Card>

        {s.useFees && (
          <Card title="Receipts today" pad={false} actions={<Link className="btn sm" to="/fees">Record payment</Link>}>
            {data.receipts.length === 0 ? <Empty>No payments recorded today.</Empty> : (
              <table className="table compact">
                <tbody>{data.receipts.map((r) => <tr key={r.id}><td>{r.receiptNo}</td><td>{r.name}</td><td className="num">{money(s, r.amount)}</td></tr>)}</tbody>
              </table>
            )}
          </Card>
        )}
      </div>
      {mail && <MessagesModal kind="risk" learnerIds={[mail.id]} title={`E-mail ${mail.guardianName || 'guardian'} about ${mail.firstName}`} onClose={() => setMail(null)} />}
    </>
  );
}
