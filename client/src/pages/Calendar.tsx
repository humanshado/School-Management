import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api';
import { RowsEditor, SaveBar, useSettingsDraft } from '../components/Editors';
import { Card, ErrorBox, Loading, PageHead, useApi, useMeta, usePerms } from '../components/ui';
import { fmtShort } from '../format';

interface Day { date: string; weekday: number; term: string; holiday: string; events: string[]; registers: number; attendance: number | null; schoolDay: boolean }

const shiftMonth = (m: string, d: number) => { const [y, mo] = m.split('-').map(Number); const t = new Date(Date.UTC(y, mo - 1 + d, 1)); return t.toISOString().slice(0, 7); };

export default function Calendar() {
  const { meta } = useMeta();
  const [month, setMonth] = useState(meta.today.slice(0, 7));
  const { data, error, reload } = useApi<{ month: string; today: string; nClasses: number; days: Day[] }>(`/calendar${qs({ month })}`);
  const d = useSettingsDraft();
  const { admin, teach } = usePerms();
  const title = new Date(month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lead = data ? data.days[0].weekday - 1 : 0;
  const inMonth = data?.days.filter((x) => x.holiday || x.events.length) ?? [];

  return (
    <>
      <PageHead title="School Calendar" sub="Terms, holidays and key dates — the whole app reads them from here" />
      <div className="grid g-cal">
        <Card title={title} className="span-2" actions={<>
          <button className="btn sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <button className="btn sm ghost" onClick={() => setMonth(meta.today.slice(0, 7))}>This month</button>
          <button className="btn sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
        </>}>
          {error && <ErrorBox error={error} retry={reload} />}
          {!data ? <Loading /> : (
            <>
              <div className="month">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <div key={w} className="mh">{w}</div>)}
                {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} className="md blank" />)}
                {data.days.map((x) => {
                  const cls = ['md', x.weekday > 5 ? 'we' : '', x.holiday ? 'hol' : '', !x.term ? 'out' : '', x.date === data.today ? 'today' : ''].join(' ');
                  const body = (
                    <>
                      <span className="md-n">{+x.date.slice(8)}</span>
                      {x.holiday && <span className="md-tag hol">{x.holiday}</span>}
                      {x.events.map((e) => <span key={e} className="md-tag ev">{e}</span>)}
                      {x.schoolDay && x.date <= data.today && (
                        <span className={`md-reg ${x.registers < data.nClasses ? 'warn' : ''}`}>{x.registers}/{data.nClasses} reg.{x.attendance !== null ? ` · ${x.attendance}%` : ''}</span>
                      )}
                    </>
                  );
                  return teach && x.schoolDay && x.date <= data.today
                    ? <Link key={x.date} to={`/attendance?date=${x.date}`} className={cls} title="Open the registers for this day">{body}</Link>
                    : <div key={x.date} className={cls}>{body}</div>;
                })}
              </div>
              {inMonth.length > 0 && (
                <ul className="events compact">{inMonth.map((x) => <li key={x.date}><span className="ev-date">{fmtShort(x.date)}</span><span className="ev-label">{[x.holiday, ...x.events].filter(Boolean).join(' · ')}</span></li>)}</ul>
              )}
            </>
          )}
        </Card>

        <Card title="Terms" actions={<span className="muted small">Current: <b>{meta.term}</b> {admin ? '(change in Admin)' : ''}</span>}>
          <RowsEditor readOnly={!admin} rows={d.draft.terms} onChange={(v) => d.set('terms', v)} addLabel="Add term" blank={{ name: '', start: '', end: '', feesDue: '' }}
            cols={[{ key: 'name', label: 'Term', width: '22%' }, { key: 'start', label: 'Starts', type: 'date' }, { key: 'end', label: 'Ends', type: 'date' }, { key: 'feesDue', label: 'Fees due', type: 'date' }]} />
          <p className="muted small">The term before the current one is used for "change vs last term", so keep them in order.</p>
        </Card>

        <Card title="Holidays · not school days">
          <RowsEditor readOnly={!admin} rows={d.draft.holidays} onChange={(v) => d.set('holidays', v)} addLabel="Add holiday" blank={{ name: '', type: 'Public holiday', date: '' }}
            cols={[{ key: 'name', label: 'Holiday' }, { key: 'type', label: 'Type', width: '30%' }, { key: 'date', label: 'Date', type: 'date', width: '30%' }]} />
        </Card>

        <Card title="Key dates · shown on Today" className="span-2">
          <RowsEditor readOnly={!admin} rows={d.draft.keyDates} onChange={(v) => d.set('keyDates', v)} addLabel="Add key date" blank={{ label: '', date: '' }}
            cols={[{ key: 'label', label: 'Key date' }, { key: 'date', label: 'Date', type: 'date', width: '30%' }]} />
          <p className="muted small">{'{overdue}'} in a key date fills in the number of learners with fees overdue.</p>
        </Card>
      </div>
      {admin && <SaveBar {...d} />}
    </>
  );
}
