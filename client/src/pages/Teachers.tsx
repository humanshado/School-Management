import { useMemo, useState } from 'react';
import { api } from '../api';
import { EditModal, type FieldDef } from '../components/Crud';
import { Card, Empty, ErrorBox, Loading, PageHead, useApi, useMeta } from '../components/ui';

interface Teacher { id?: number; name: string; phone: string; email: string; subjects: string; notes: string; classes?: string[] }

export default function Teachers() {
  const { reload: reloadMeta } = useMeta();
  const { data, error, reload } = useApi<Teacher[]>('/teachers');
  const [edit, setEdit] = useState<Partial<Teacher> | null>(null);
  const [q, setQ] = useState('');
  const list = useMemo(() => (data ?? []).filter((t) => [t.name, t.subjects, t.phone, t.email].some((v) => v?.toLowerCase().includes(q.toLowerCase()))), [data, q]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const fields: FieldDef<Teacher>[] = [
    { key: 'name', label: 'Teacher name', required: true }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'E-mail' },
    { key: 'subjects', label: 'Subjects', wide: true }, { key: 'notes', label: 'Notes', wide: true },
  ];
  const done = () => { setEdit(null); reload(); reloadMeta(); };
  return (
    <>
      <PageHead title="Teachers" sub={`${data.length} teachers`}>
        <button className="btn primary" onClick={() => setEdit({ name: '', phone: '', email: '', subjects: '', notes: '' })}>+ Add teacher</button>
      </PageHead>
      <Card pad={false}>
        <div className="filters"><input type="search" placeholder="Search name, subject, phone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
        <div className="table-wrap">
          <table className="table hover">
            <thead><tr><th>Name</th><th>Class</th><th>Subjects</th><th>Phone</th><th>E-mail</th></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} onClick={() => setEdit(t)}>
                  <td><b>{t.name}</b></td>
                  <td>{t.classes?.join(', ') || <span className="muted">–</span>}</td>
                  <td className="muted">{t.subjects}</td>
                  <td>{t.phone}</td>
                  <td onClick={(e) => e.stopPropagation()}>{t.email && <a href={`mailto:${t.email}`}>{t.email}</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <Empty>No teachers match.</Empty>}
        </div>
      </Card>
      {edit && <EditModal<Teacher> title={edit.id ? `Edit ${edit.name}` : 'New teacher'} path="/teachers" fields={fields} initial={edit} onClose={() => setEdit(null)} onSaved={done}
        onDelete={async () => { if (confirm(`Delete ${edit.name}?`)) { await api.del(`/teachers/${edit.id}`); done(); } }} />}
    </>
  );
}
