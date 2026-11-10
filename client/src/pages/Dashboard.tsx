import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api';
import { BarChart, Card, ErrorBox, Kpi, Loading, Meter, PageHead, Select, useApi, useMeta } from '../components/ui';
import { fmtShort, money, num1, pct, signed } from '../format';
import type { ClassStats, Kpis } from '../types';

interface Mover { id: number; name: string; className: string; avg: number; chg: number }
interface Dash {
  term: string; today: string; kpis: Kpis; weeks: { label: string; pct: number }[]; days: string[];
  heat: { className: string; cells: (number | null)[] }[]; spread: { band: string; meaning: string; n: number }[];
  classes: ClassStats[]; useFees: boolean; up: Mover[]; down: Mover[]; notTaken: string[];
}

const heatClass = (v: number | null) => v === null ? 'h-none' : v >= 97 ? 'h5' : v >= 94 ? 'h4' : v >= 90 ? 'h3' : v >= 85 ? 'h2' : 'h1';

export default function Dashboard() {
  const { meta } = useMeta();
  const s = meta.settings;
  const [term, setTerm] = useState(meta.term);
  const [sort, setSort] = useState<'att' | 'avg' | 'coll'>('att');
  const { data, error, reload } = useApi<Dash>(`/dashboard${qs({ term })}`);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const coll = (c: ClassStats) => (c.billed ? c.paid / c.billed : 0);
  const board = [...data.classes].filter((c) => c.n > 0).sort((a, b) => sort === 'att' ? (b.att ?? 0) - (a.att ?? 0) : sort === 'avg' ? (b.avg ?? 0) - (a.avg ?? 0) : coll(b) - coll(a));
  const spreadMax = Math.max(1, ...data.spread.map((x) => x.n));
  const schoolAtt = data.weeks.length ? data.weeks.reduce((a, w) => a + w.pct, 0) / data.weeks.length : null;
  const avgAll = data.classes.filter((c) => c.avg !== null);

  return (
    <>
      <PageHead title="Dashboard" sub={term === meta.term ? `as of ${fmtShort(data.today)}` : `${term}, as of its last day`}>
        <Select value={term} onChange={setTerm} options={s.terms.map((t) => t.name)} aria-label="Term" />
      </PageHead>
      <div className="kpis">
        <Kpi label="Learners" value={k.learners} sub={`${k.classes} classes`} />
        <Kpi label="Attendance" value={schoolAtt === null ? '–' : `${num1(schoolAtt)}%`} sub={`${k.schoolDays} school days with registers`} />
        <Kpi label="Term average" value={avgAll.length ? num1(avgAll.reduce((a, c) => a + c.avg! * c.n, 0) / avgAll.reduce((a, c) => a + c.n, 0)) : '–'} sub={`${k.ready} learners with marks`} />
        <Kpi label="At risk / watch" value={`${k.risk} / ${k.watch}`} tone={k.risk ? 'bad' : undefined} />
        {data.useFees && <Kpi label="Fees collected" value={pct(k.billed ? k.paid / k.billed : null)} sub={`${money(s, k.balance)} to go`} />}
      </div>

      <div className="grid g-dash">
        <Card title="Every register this term" className="span-2" actions={data.notTaken.length ? <Link className="pill warn" to="/attendance">{data.notTaken.length} not taken today</Link> : undefined}>
          {data.days.length === 0 ? <p className="muted">No school days yet.</p> : (
            <div className="heat-wrap">
              <table className="heat">
                <thead><tr><th />{data.days.map((d, i) => <th key={d}>{i === 0 || new Date(d).getUTCDay() === 1 ? <span>{fmtShort(d)}</span> : null}</th>)}</tr></thead>
                <tbody>
                  {data.heat.map((r) => (
                    <tr key={r.className}>
                      <th>{r.className}</th>
                      {r.cells.map((v, i) => <td key={i} className={heatClass(v)} title={`${r.className} · ${fmtShort(data.days[i])}: ${v === null ? 'not taken' : v + '% present'}`} />)}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="heat-legend muted small">
                <span className="h-none" /> not taken <span className="h1" /> &lt;85% <span className="h2" /> 85% <span className="h3" /> 90% <span className="h4" /> 94% <span className="h5" /> 97%+
              </div>
            </div>
          )}
        </Card>

        <Card title="Class leaderboard" pad={false} actions={
          <div className="seg">
            <button className={sort === 'att' ? 'on' : ''} onClick={() => setSort('att')}>Attend.</button>
            <button className={sort === 'avg' ? 'on' : ''} onClick={() => setSort('avg')}>Average</button>
            {data.useFees && <button className={sort === 'coll' ? 'on' : ''} onClick={() => setSort('coll')}>Fees</button>}
          </div>
        }>
          <table className="table compact">
            <tbody>
              {board.map((c, i) => (
                <tr key={c.id}>
                  <td className="muted">{i + 1}</td><td><b>{c.name}</b></td>
                  <td style={{ width: '45%' }}><Meter value={sort === 'att' ? c.att : sort === 'avg' ? (c.avg ?? 0) / 100 : coll(c)} /></td>
                  <td className="num">{sort === 'att' ? pct(c.att, 1) : sort === 'avg' ? num1(c.avg) : pct(coll(c))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Attendance by week" className="span-2">
          <BarChart data={data.weeks.map((w) => ({ label: w.label, value: w.pct }))} threshold={s.riskAttendance * 100} />
        </Card>

        <Card title="Grade spread · term averages">
          <div className="spread">
            {data.spread.map((b) => (
              <div key={b.band} className="spread-row">
                <span className={`band-${b.band} spread-band`}>{b.band}</span>
                <div className="spread-bar"><span style={{ width: `${(b.n / spreadMax) * 100}%` }} /></div>
                <span className="num">{b.n}</span>
              </div>
            ))}
          </div>
          <p className="muted small">{data.spread.map((b) => `${b.band} ${b.meaning}`).join(' · ')}</p>
        </Card>

        <Card title="Biggest movers vs last term" className="span-3" pad={false}>
          <div className="movers">
            <div>
              <h3 className="sub-h good-text">Up</h3>
              <table className="table compact"><tbody>{data.up.map((m) => <tr key={m.id}><td><Link to={`/students/${m.id}`}>{m.name}</Link> <span className="muted small">{m.className}</span></td><td className="num">{num1(m.avg)}</td><td className="num good-text">{signed(m.chg)}</td></tr>)}</tbody></table>
            </div>
            <div>
              <h3 className="sub-h bad-text">Down</h3>
              <table className="table compact"><tbody>{data.down.map((m) => <tr key={m.id}><td><Link to={`/students/${m.id}`}>{m.name}</Link> <span className="muted small">{m.className}</span></td><td className="num">{num1(m.avg)}</td><td className="num bad-text">{signed(m.chg)}</td></tr>)}</tbody></table>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
