import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qs } from '../api';
import { BarChart, Card, Empty, ErrorBox, Kpi, Loading, PageHead, Select, useApi, useMeta } from '../components/ui';
import { money, num1, pct } from '../format';

type ColType = 'num' | 'money' | 'pct' | 'text';
interface Def { id: string; group: string; title: string; description: string; params: ('term' | 'from' | 'to' | 'class')[] }
interface Report {
  title: string; subtitle?: string; params: { term: string; from: string; to: string; class: string };
  kpis?: { label: string; value: string | number; type?: ColType }[];
  chart?: { title: string; unit?: string; max?: number; min?: number; data: { label: string; value: number }[] };
  tables: { title?: string; columns: { key: string; label: string; type?: ColType }[]; rows: Record<string, any>[] }[];
}

export default function Reports() {
  const { data: defs, error } = useApi<Def[]>('/reports');
  const [sp, setSp] = useSearchParams();
  const id = sp.get('r') ?? defs?.[0]?.id ?? '';
  const groups = useMemo(() => (defs ?? []).reduce<Record<string, Def[]>>((a, d) => ((a[d.group] ??= []).push(d), a), {}), [defs]);
  if (error) return <ErrorBox error={error} />;
  if (!defs) return <Loading />;
  const def = defs.find((d) => d.id === id);
  return (
    <>
      <PageHead title="Reports" sub="Pick a report; save any table as CSV for Excel" />
      <div className="reports">
        <Card className="report-list no-print" pad={false}>
          {Object.entries(groups).map(([g, list]) => (
            <div key={g}><div className="nav-title">{g}</div>
              {list.map((d) => <button key={d.id} className={d.id === id ? 'on' : ''} onClick={() => setSp({ r: d.id }, { replace: true })} title={d.description}>{d.title}</button>)}
            </div>
          ))}
        </Card>
        <div className="report-main">{def ? <ReportView key={def.id} def={def} /> : <Card><Empty>Pick a report.</Empty></Card>}</div>
      </div>
    </>
  );
}

function ReportView({ def }: { def: Def }) {
  const { meta } = useMeta();
  const s = meta.settings;
  const [p, setP] = useState<{ term?: string; from?: string; to?: string; class?: string }>({});
  const { data, error, loading, reload } = useApi<Report>(`/reports/${def.id}${qs(p)}`);
  const fmt = (v: unknown, t?: ColType) => v === null || v === undefined || v === '' ? '–'
    : t === 'money' ? money(s, Number(v)) : t === 'pct' ? (typeof v === 'number' ? pct(v, 1) : String(v)) : t === 'num' && typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString() : num1(v)) : String(v);
  const csv = (t: Report['tables'][0]) => {
    const cell = (v: unknown) => { let x = v === null || v === undefined ? '' : String(v); if (/^[=+\-@]/.test(x) && isNaN(Number(x))) x = `'${x}`; return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const body = [t.columns.map((c) => cell(c.label)).join(','), ...t.rows.map((r) => t.columns.map((c) => cell(c.type === 'pct' && typeof r[c.key] === 'number' ? Math.round(r[c.key] * 1000) / 10 : r[c.key])).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv' }));
    a.download = `${def.id}${t.title ? `-${t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const cur = data?.params;
  return (
    <>
      <Card title={def.title} actions={<>
        {def.params.includes('term') && <Select value={p.term ?? cur?.term ?? ''} onChange={(v) => setP({ ...p, term: v })} options={s.terms.map((t) => t.name)} aria-label="Term" />}
        {def.params.includes('from') && <input type="date" value={p.from ?? cur?.from ?? ''} onChange={(e) => setP({ ...p, from: e.target.value })} aria-label="From" style={{ width: 'auto' }} />}
        {def.params.includes('to') && <input type="date" value={p.to ?? cur?.to ?? ''} onChange={(e) => setP({ ...p, to: e.target.value })} aria-label="To" style={{ width: 'auto' }} />}
        {def.params.includes('class') && <Select value={p.class ?? ''} onChange={(v) => setP({ ...p, class: v })} options={meta.classes} placeholder="All classes" aria-label="Class" />}
        <button className="btn sm" onClick={() => window.print()}>Print</button>
      </>}>
        <p className="muted small" style={{ margin: 0 }}>{def.description}</p>
      </Card>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data || loading ? <Loading /> : (
        <div className="print-area report-body">
          <h2 className="print-only">{meta.settings.schoolName} · {data.title}{data.subtitle ? ` · ${data.subtitle}` : ''}</h2>
          {data.subtitle && <p className="muted">{data.subtitle}</p>}
          {!!data.kpis?.length && <div className="kpis">{data.kpis.map((k) => <Kpi key={k.label} label={k.label} value={fmt(k.value, k.type)} />)}</div>}
          {data.chart && data.chart.data.length > 0 && <Card title={data.chart.title}><BarChart data={data.chart.data} unit={data.chart.unit ?? ''} min={data.chart.min} max={data.chart.max ?? 100} /></Card>}
          {data.tables.map((t, i) => (
            <Card key={i} title={t.title ?? data.title} pad={false} actions={t.rows.length > 0 && <button className="btn sm no-print" onClick={() => csv(t)}>CSV</button>}>
              {!t.rows.length ? <Empty>Nothing to show.</Empty> : (
                <div className="table-wrap"><table className="table compact">
                  <thead><tr>{t.columns.map((c) => <th key={c.key} className={c.type && c.type !== 'text' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                  <tbody>{t.rows.map((r, j) => <tr key={j}>{t.columns.map((c) => <td key={c.key} className={c.type && c.type !== 'text' ? 'num' : ''}>{fmt(r[c.key], c.type)}</td>)}</tr>)}</tbody>
                </table></div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
