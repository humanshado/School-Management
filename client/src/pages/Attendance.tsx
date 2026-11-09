import { useSearchParams } from 'react-router-dom';
import Register from '../components/Register';
import { Card, PageHead, Select, useApi, useMeta } from '../components/ui';
import { fmtLong } from '../format';
import type { ClassStats } from '../types';

export default function Attendance() {
  const { meta } = useMeta();
  const [sp, setSp] = useSearchParams();
  const cls = sp.get('class') && meta.classes.includes(sp.get('class')!) ? sp.get('class')! : meta.classes[0] ?? '';
  const date = sp.get('date') ?? meta.today;
  const { data, reload } = useApi<{ classes: ClassStats[] }>('/today');
  const set = (patch: Record<string, string>) => setSp({ class: cls, date, ...patch }, { replace: true });
  return (
    <>
      <PageHead title="Attendance" sub={fmtLong(date)}>
        <Select value={cls} onChange={(v) => set({ class: v })} options={meta.classes} aria-label="Class" />
      </PageHead>
      <div className="grid g-att">
        <Card title={`Register · ${cls}`}>
          <Register className={cls} date={date} onDate={(d) => set({ date: d })} onSaved={reload} />
        </Card>
        <Card title="Registers today" pad={false}>
          <table className="table compact hover">
            <tbody>
              {(data?.classes ?? []).map((c) => (
                <tr key={c.id} className={c.name === cls ? 'sel' : ''} onClick={() => set({ class: c.name, date: meta.today })}>
                  <td><b>{c.name}</b> <span className="muted small">{c.teacher}</span></td>
                  <td className="right">{c.today === 'Yes' ? <span className="pill ok">{c.todayPresent}/{c.todayEnrolled}</span> : c.today === 'No' ? <span className="pill warn">Not taken</span> : <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
