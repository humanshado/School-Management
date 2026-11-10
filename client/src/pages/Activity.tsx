import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qs } from '../api';
import ActivityList, { type ActivityPage } from '../components/ActivityList';
import { Card, PageHead, Select, useApi } from '../components/ui';

/** Admin only: who changed what, and when. */
export default function Activity() {
  const [sp, setSp] = useSearchParams();
  const f = { category: sp.get('category') ?? '', userId: sp.get('userId') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '', q: sp.get('q') ?? '' };
  const [q, setQ] = useState(f.q);
  const { data: opts } = useApi<ActivityPage>('/activity?limit=1');
  const set = (patch: Partial<typeof f>) => setSp(Object.fromEntries(Object.entries({ ...f, ...patch }).filter(([, v]) => v)), { replace: true });
  // search as you type, a moment after the last key
  useEffect(() => {
    if (q === f.q) return;
    const t = setTimeout(() => set({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const filtered = Object.values(f).some(Boolean);

  return (
    <>
      <PageHead title="Activity" sub="Every change made in the app: who, what and when. Entries cannot be edited or deleted.">
        <a className="btn" href={`/api/activity.csv${qs(f)}`} download>Download CSV</a>
      </PageHead>
      <Card pad={false}>
        <div className="filters">
          <input type="search" placeholder="Search: a name, receipt no, class…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the activity log" />
          <Select value={f.category} onChange={(v) => set({ category: v })} placeholder="Every area" aria-label="Area"
            options={Object.entries(opts?.categories ?? {}).map(([value, label]) => ({ value, label }))} />
          <Select value={f.userId} onChange={(v) => set({ userId: v })} placeholder="Everyone" aria-label="Person"
            options={(opts?.users ?? []).map((u) => ({ value: u.userId === null ? 'none' : String(u.userId), label: u.userId === null ? `${u.userName} (not a user)` : u.userName }))} />
          <label className="date-filter">From <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="date-filter">To <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} /></label>
          {filtered && <button className="btn ghost" onClick={() => { setQ(''); setSp({}, { replace: true }); }}>Clear filters</button>}
        </div>
        <ActivityList filter={f} />
      </Card>
    </>
  );
}
