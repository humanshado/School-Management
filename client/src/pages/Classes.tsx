import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EditModal, type FieldDef } from '../components/Crud';
import { Card, ErrorBox, Loading, Meter, PageHead, Select, useApi, useMeta, usePerms } from '../components/ui';
import { money, num1, pct } from '../format';
import type { ClassStats } from '../types';

interface ClassRow { id?: number; name: string; grade: string; stream: string; teacher: string; room: string; notes: string; stats?: ClassStats }

export default function Classes() {
  const { meta, reload: reloadMeta } = useMeta();
  const s = meta.settings;
  const perms = usePerms();
  const { data, error, reload } = useApi<ClassRow[]>('/classes');
  const [edit, setEdit] = useState<Partial<ClassRow> | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const fields: FieldDef<ClassRow>[] = [
    { key: 'name', label: 'Class', required: true },
    { key: 'grade', label: 'Grade', render: (v, set) => <Select value={v ?? ''} onChange={set} options={s.grades.map((g) => g.name)} placeholder="–" /> },
    { key: 'stream', label: 'Stream', render: (v, set) => <Select value={v ?? ''} onChange={set} options={s.streams} placeholder="–" /> },
    { key: 'teacher', label: 'Class teacher', render: (v, set) => <Select value={v ?? ''} onChange={set} options={meta.teachers} placeholder="–" /> },
    { key: 'room', label: 'Room' },
    { key: 'notes', label: 'Notes', wide: true },
  ];
  const done = () => { setEdit(null); reload(); reloadMeta(); };
  return (
    <>
      <PageHead title="Classes" sub={`${data.length} classes · ${meta.term}`}>
        {perms.admin && <button className="btn primary" onClick={() => setEdit({ name: '', grade: '', stream: '', teacher: '', room: '', notes: '' })}>+ Add class</button>}
      </PageHead>
      <Card pad={false}>
        <div className="table-wrap">
          <table className={`table ${perms.admin ? 'hover' : ''}`}>
            <thead><tr>
              <th>Class</th><th>Grade</th><th>Class teacher</th><th>Room</th><th className="num">Learners</th><th>Attendance</th><th className="num">Average</th>
              {perms.showFees && <><th className="num">Billed</th><th>Collected</th><th className="num">Overdue</th></>}<th>Today</th>
            </tr></thead>
            <tbody>
              {data.map((c) => {
                const k = c.stats;
                const coll = k && k.billed ? k.paid / k.billed : null;
                return (
                  <tr key={c.id} onClick={() => perms.admin && setEdit(c)}>
                    <td><b>{c.name}</b></td><td>{c.grade}</td><td>{c.teacher}</td><td className="muted">{c.room}</td>
                    <td className="num">{k?.n ?? 0}</td>
                    <td><div className="meter-cell"><Meter value={k?.att ?? null} tone={k?.att != null && k.att < s.riskAttendance ? 'bad' : ''} />{pct(k?.att, 1)}</div></td>
                    <td className="num">{num1(k?.avg)}</td>
                    {perms.showFees && <>
                      <td className="num">{money(s, k?.billed ?? 0)}</td>
                      <td><div className="meter-cell"><Meter value={coll} />{pct(coll)}</div></td>
                      <td className={`num ${k?.overdue ? 'bad-text' : ''}`}>{k?.overdue ?? 0}</td>
                    </>}
                    <td onClick={(e) => e.stopPropagation()}>
                      {k?.today === 'Yes' ? <span className="pill ok">Taken</span> : k?.today === 'No' && perms.canTeach(c.name) ? <Link className="pill warn" to={`/attendance?class=${c.name}`}>Not taken</Link> : k?.today === 'No' ? <span className="pill warn">Not taken</span> : <span className="muted">–</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {edit && <EditModal<ClassRow> title={edit.id ? `Edit ${edit.name}` : 'New class'} path="/classes" fields={fields} initial={edit} onClose={() => setEdit(null)} onSaved={done}
        onDelete={async () => { if (confirm(`Delete class ${edit.name}?`)) { await api.del(`/classes/${edit.id}`); done(); } }} />}
    </>
  );
}
