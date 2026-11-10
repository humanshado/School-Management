import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { LearnerPicker } from '../components/Users';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Select, useAction, useApi, useMeta } from '../components/ui';
import { fmtShort, plural } from '../format';

interface Stop { id?: number; name: string; amTime: string | null; pmTime: string | null }
interface Rider { id: number; learnerId: number; stopId: number; name: string; className: string; guardianName: string; guardianPhone: string; billed: boolean; notes: string }
interface Route { id: number; name: string; vehicle: string; driver: string; driverPhone: string; capacity: number | null; notes: string; stops: Stop[]; riders: Rider[] }
interface Data { canEdit: boolean; transportFee: string | null; items: Route[] }

export default function Transport() {
  const { data, error, reload } = useApi<Data>('/routes');
  const [edit, setEdit] = useState<Partial<Route> | null>(null);
  const [stops, setStops] = useState<Route | null>(null);
  const [rider, setRider] = useState<{ route: Route } | null>(null);
  const [sheet, setSheet] = useState<Route | null>(null);
  const [trips, setTrips] = useState<Route | null>(null);
  const { run } = useAction();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const riders = data.items.reduce((a, r) => a + r.riders.length, 0);
  const unbilled = data.items.flatMap((r) => r.riders.filter((x) => !x.billed));
  return (
    <>
      <PageHead title="Transport" sub={`${data.items.length} routes · ${riders} learners ride`}>
        {data.canEdit && <button className="btn primary" onClick={() => setEdit({ name: '', vehicle: '', driver: '', driverPhone: '', capacity: null, notes: '' })}>+ Route</button>}
      </PageHead>
      {data.transportFee && unbilled.length > 0 && (
        <div className="callout warn">{unbilled.length} learner{unbilled.length === 1 ? ' rides' : 's ride'} without the "{data.transportFee}" optional fee: {unbilled.map((x) => <Link key={x.id} to={`/students/${x.learnerId}`} style={{ marginRight: 6 }}>{x.name}</Link>)}</div>
      )}
      {!data.items.length ? <Card><Empty>No routes yet.</Empty></Card> : (
        <div className="hw-list">
          {data.items.map((r) => (
            <Card key={r.id} className="hw-card" title={<>🚌 {r.name}</>} actions={<>
              <span className={`pill ${r.capacity && r.riders.length >= r.capacity ? 'warn' : ''}`}>{r.riders.length}{r.capacity ? `/${r.capacity}` : ''} seats</span>
              {data.canEdit && <button className="btn sm ghost" onClick={() => setEdit(r)}>Edit</button>}
            </>}>
              <p className="muted small">{[r.vehicle, r.driver && `driver ${r.driver}`, r.driverPhone].filter(Boolean).join(' · ') || 'No vehicle details'}</p>
              <ol className="stops">{r.stops.map((s) => (
                <li key={s.id}><b>{s.name}</b> <span className="muted small">{s.amTime ?? '–'} / {s.pmTime ?? '–'}</span>
                  <span className="muted small"> · {plural(r.riders.filter((x) => x.stopId === s.id).length, 'rider')}</span></li>
              ))}</ol>
              {!r.stops.length && <p className="muted small">No stops yet.</p>}
              <div className="btn-row">
                {data.canEdit && <button className="btn sm" onClick={() => setStops(r)}>Stops…</button>}
                {data.canEdit && r.stops.length > 0 && <button className="btn sm" onClick={() => setRider({ route: r })}>+ Rider</button>}
                <button className="btn sm" onClick={() => setSheet(r)}>Route sheet</button>
                <button className="btn sm" onClick={() => setTrips(r)}>Trips</button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <RouteModal r={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {stops && <StopsModal r={stops} onClose={() => setStops(null)} onSaved={() => { setStops(null); reload(); }} />}
      {rider && <RiderModal route={rider.route} onClose={() => setRider(null)} onSaved={() => { setRider(null); reload(); }} />}
      {trips && <TripsModal r={trips} canEdit={data.canEdit} onClose={() => setTrips(null)} />}
      {sheet && (
        <Modal wide title={`Route sheet · ${sheet.name}`} onClose={() => setSheet(null)} footer={<><button className="btn" onClick={() => setSheet(null)}>Close</button><button className="btn primary" onClick={() => window.print()}>Print</button></>}>
          <div className="print-area">
            <h3>{sheet.name} {sheet.vehicle && `· ${sheet.vehicle}`}</h3>
            <p className="muted small">{[sheet.driver && `Driver ${sheet.driver}`, sheet.driverPhone].filter(Boolean).join(' · ')}</p>
            {sheet.stops.map((s) => {
              const list = sheet.riders.filter((x) => x.stopId === s.id);
              return (
                <div key={s.id} className="sheet-stop">
                  <h4>{s.name} <span className="muted small">morning {s.amTime ?? '–'} · afternoon {s.pmTime ?? '–'}</span></h4>
                  {!list.length ? <p className="muted small">No riders.</p> : (
                    <table className="table compact"><tbody>{list.map((x) => (
                      <tr key={x.id}><td>☐</td><td><b>{x.name}</b> <span className="muted">{x.className}</span></td><td>{x.guardianName}</td><td>{x.guardianPhone}</td>
                        <td>{data.canEdit && <button className="btn sm ghost no-print" onClick={() => run(async () => { if (confirm(`Take ${x.name} off school transport?`)) { await api.put(`/riders/${x.learnerId}`, { routeId: null }); setSheet(null); reload(); } })}>Remove</button>}</td></tr>
                    ))}</tbody></table>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}

function RouteModal({ r, onClose, onSaved }: { r: Partial<Route>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(r);
  const { busy, run } = useAction();
  const set = (p: Partial<Route>) => setF((x) => ({ ...x, ...p }));
  const save = async () => { if (await run(() => (f.id ? api.put(`/routes/${f.id}`, f) : api.post('/routes', f)), 'Route saved')) onSaved(); };
  const del = async () => { if (confirm(`Delete route ${f.name}?`) && (await run(() => api.del(`/routes/${f.id}`), 'Route deleted'))) onSaved(); };
  return (
    <Modal title={f.id ? `Edit ${r.name}` : 'New route'} onClose={onClose} footer={<>
      {f.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button>
    </>}>
      <div className="form-grid">
        <Field label="Route name *"><input value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
        <Field label="Vehicle"><input value={f.vehicle ?? ''} onChange={(e) => set({ vehicle: e.target.value })} placeholder="Bus 1 · KAA 123B" /></Field>
        <Field label="Driver"><input value={f.driver ?? ''} onChange={(e) => set({ driver: e.target.value })} /></Field>
        <Field label="Driver's phone"><input value={f.driverPhone ?? ''} onChange={(e) => set({ driverPhone: e.target.value })} /></Field>
        <Field label="Seats"><input type="number" min="1" value={f.capacity ?? ''} onChange={(e) => set({ capacity: e.target.value ? +e.target.value : null })} /></Field>
        <Field label="Notes" wide><input value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function StopsModal({ r, onClose, onSaved }: { r: Route; onClose: () => void; onSaved: () => void }) {
  const [list, setList] = useState<Stop[]>(r.stops.length ? r.stops : [{ name: '', amTime: '', pmTime: '' }]);
  const { busy, run } = useAction();
  const set = (i: number, p: Partial<Stop>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setList(n); };
  return (
    <Modal title={`Stops · ${r.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => api.put(`/routes/${r.id}/stops`, { stops: list }), 'Stops saved')) onSaved(); }}>Save</button></>}>
      <table className="table rows-editor">
        <thead><tr><th>Stop, in order</th><th>Morning</th><th>Afternoon</th><th /></tr></thead>
        <tbody>{list.map((s, i) => (
          <tr key={s.id ?? `n${i}`}>
            <td><input value={s.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Stop name" /></td>
            <td><input type="time" value={s.amTime ?? ''} onChange={(e) => set(i, { amTime: e.target.value })} aria-label="Morning time" /></td>
            <td><input type="time" value={s.pmTime ?? ''} onChange={(e) => set(i, { pmTime: e.target.value })} aria-label="Afternoon time" /></td>
            <td className="nowrap"><button className="icon-btn" disabled={!i} onClick={() => move(i, -1)} aria-label="Move up">↑</button><button className="icon-btn" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="Remove">×</button></td>
          </tr>
        ))}</tbody>
      </table>
      <button className="btn sm" onClick={() => setList([...list, { name: '', amTime: '', pmTime: '' }])}>+ Stop</button>
    </Modal>
  );
}

function RiderModal({ route, onClose, onSaved }: { route: Route; onClose: () => void; onSaved: () => void }) {
  const [who, setWho] = useState<number[]>([]);
  const [stop, setStop] = useState(String(route.stops[0]?.id ?? ''));
  const { busy, run } = useAction();
  return (
    <Modal title={`Add a rider · ${route.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !who.length} onClick={async () => { if (await run(() => api.put(`/riders/${who[0]}`, { routeId: route.id, stopId: Number(stop) }), 'Rider added') !== undefined) onSaved(); }}>Save</button></>}>
      <div className="form-grid">
        <Field label="Learner *" wide><LearnerPicker value={who} single onChange={setWho} /></Field>
        <Field label="Stop *"><Select value={stop} onChange={setStop} options={route.stops.map((s) => ({ value: String(s.id), label: `${s.name} (${s.amTime ?? '–'})` }))} /></Field>
      </div>
      <p className="muted small">A learner rides one route: adding them here moves them off any other route.</p>
    </Modal>
  );
}

function TripsModal({ r, canEdit, onClose }: { r: Route; canEdit: boolean; onClose: () => void }) {
  const { meta } = useMeta();
  const { data, reload } = useApi<any[]>(`/trips?routeId=${r.id}`);
  const [f, setF] = useState({ date: meta.today, direction: 'AM', departedAt: '', arrivedAt: '', absent: '', notes: '' });
  const { busy, run } = useAction();
  return (
    <Modal wide title={`Trip log · ${r.name}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {canEdit && (
        <div className="form-grid">
          <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Trip"><Select value={f.direction} onChange={(v) => setF({ ...f, direction: v })} options={[{ value: 'AM', label: 'Morning' }, { value: 'PM', label: 'Afternoon' }]} /></Field>
          <Field label="Left at"><input type="time" value={f.departedAt} onChange={(e) => setF({ ...f, departedAt: e.target.value })} /></Field>
          <Field label="Arrived at"><input type="time" value={f.arrivedAt} onChange={(e) => setF({ ...f, arrivedAt: e.target.value })} /></Field>
          <Field label="Riders not on the bus" wide><input value={f.absent} onChange={(e) => setF({ ...f, absent: e.target.value })} placeholder="Names" /></Field>
          <Field label="Notes (delays, incidents)" wide><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <div><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.post('/trips', { ...f, routeId: r.id }); reload(); }, 'Trip logged')}>Log trip</button></div>
        </div>
      )}
      {!data ? <Loading /> : !data.length ? <Empty>No trips logged.</Empty> : (
        <table className="table compact"><thead><tr><th>Date</th><th>Trip</th><th>Times</th><th>Driver</th><th>Not on bus</th><th>Notes</th></tr></thead>
          <tbody>{data.map((t) => <tr key={t.id}><td>{fmtShort(t.date)}</td><td>{t.direction === 'AM' ? 'Morning' : 'Afternoon'}</td><td>{t.departedAt ?? '–'}–{t.arrivedAt ?? '–'}</td><td>{t.driver}</td><td>{t.absent}</td><td>{t.notes}</td></tr>)}</tbody></table>
      )}
      <p className="muted small">Live GPS tracking needs a tracker in each bus; this log records the trips by hand.</p>
    </Modal>
  );
}
