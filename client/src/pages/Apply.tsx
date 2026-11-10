import { useEffect, useState } from 'react';
import { api } from '../api';
import { ACCEPT } from '../components/Files';
import { ErrorBox, Loading } from '../components/ui';

interface Info { open: boolean; intro: string; school: { name: string; address: string; contact: string }; grades: string[]; relationships: string[]; genders: string[] }

/** The public online application form: no login. */
export default function Apply() {
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({ website: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ref: string; uploaded: number; failed: string[] } | null>(null);
  useEffect(() => { api.get<Info>('/public/admissions').then(setInfo).catch((e) => setErr(e.message)); }, []);
  if (!info) return <div className="boot">{err ? <ErrorBox error={err} /> : <Loading />}</div>;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ ref: string; token: string }>('/public/applications', f);
      const failed: string[] = []; let uploaded = 0;
      for (const file of files) {
        const res = await fetch(`/api/public/applications/${r.token}/files`, { method: 'POST', body: file, headers: { 'X-Requested-With': 'fetch', 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' } });
        if (res.ok) uploaded++; else failed.push(`${file.name}: ${(await res.json().catch(() => ({}))).error ?? 'not uploaded'}`);
      }
      setDone({ ref: r.ref, uploaded, failed });
      window.scrollTo(0, 0);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="apply-page">
      <header className="portal-bar"><div className="brand"><div className="logo" aria-hidden>▲</div><div><b>{info.school.name}</b><small>Online application</small></div></div></header>
      <main className="apply-main">
        {done ? (
          <div className="card card-body">
            <h1>Thank you!</h1>
            <p>Your application reference is <b>{done.ref}</b>. Please keep it. The school will contact you.</p>
            {done.uploaded > 0 && <p>{done.uploaded} document{done.uploaded === 1 ? '' : 's'} received.</p>}
            {done.failed.length > 0 && <div className="error-box">Some documents were not received: {done.failed.join('; ')}. Please e-mail them to the school.</div>}
            <p className="muted small">{info.school.contact}</p>
          </div>
        ) : !info.open ? (
          <div className="card card-body"><h1>Applications are closed</h1><p>Please contact the school: {info.school.contact}</p></div>
        ) : (
          <form className="card card-body form-grid" onSubmit={submit}>
            <h1 className="wide-row">Apply for a place</h1>
            {info.intro && <p className="pre wide-row">{info.intro}</p>}
            <h3 className="form-sec">The child</h3>
            <label className="field"><span>First name *</span><input required value={f.firstName ?? ''} onChange={set('firstName')} autoComplete="off" /></label>
            <label className="field"><span>Last name *</span><input required value={f.lastName ?? ''} onChange={set('lastName')} autoComplete="off" /></label>
            <label className="field"><span>Date of birth</span><input type="date" value={f.dob ?? ''} onChange={set('dob')} /></label>
            <label className="field"><span>Gender</span><select value={f.gender ?? ''} onChange={set('gender')}><option value="">–</option>{info.genders.map((g) => <option key={g}>{g}</option>)}</select></label>
            <label className="field"><span>Applying for *</span><select required value={f.gradeApplying ?? ''} onChange={set('gradeApplying')}><option value="">Pick a grade…</option>{info.grades.map((g) => <option key={g}>{g}</option>)}</select></label>
            <label className="field"><span>Current / previous school</span><input value={f.previousSchool ?? ''} onChange={set('previousSchool')} /></label>
            <h3 className="form-sec">Parent / guardian</h3>
            <label className="field"><span>Full name *</span><input required value={f.guardianName ?? ''} onChange={set('guardianName')} autoComplete="name" /></label>
            <label className="field"><span>Relationship</span><select value={f.relationship ?? ''} onChange={set('relationship')}><option value="">–</option>{info.relationships.map((g) => <option key={g}>{g}</option>)}</select></label>
            <label className="field"><span>Phone</span><input type="tel" value={f.guardianPhone ?? ''} onChange={set('guardianPhone')} autoComplete="tel" /></label>
            <label className="field"><span>E-mail</span><input type="email" value={f.guardianEmail ?? ''} onChange={set('guardianEmail')} autoComplete="email" /></label>
            <label className="field wide"><span>Address</span><input value={f.address ?? ''} onChange={set('address')} autoComplete="street-address" /></label>
            <label className="field wide"><span>Anything we should know (health, needs, siblings at the school…)</span><textarea rows={3} value={f.notes ?? ''} onChange={set('notes')} /></label>
            <label className="field wide"><span>Documents (birth certificate, last report…): up to 5 files, 10 MB each</span>
              <input type="file" multiple accept={ACCEPT} onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} /></label>
            <input className="hp" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} aria-hidden />
            {err && <div className="error-box wide-row" role="alert">{err}</div>}
            <div className="wide-row"><button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send application'}</button>
              <p className="muted small">We need a phone number or an e-mail to reach you. {info.school.name} · {info.school.contact}</p></div>
          </form>
        )}
      </main>
    </div>
  );
}
