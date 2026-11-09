import { useRef } from 'react';
import { api } from '../api';
import { RowsEditor, SaveBar, StringList, useSettingsDraft } from '../components/Editors';
import { Card, Field, PageHead, Select, useAction, useMeta } from '../components/ui';
import UsersCard from '../components/Users';

export default function Admin() {
  const { meta, reload } = useMeta();
  const d = useSettingsDraft();
  const s = d.draft;
  const { busy, run } = useAction();
  const file = useRef<HTMLInputElement>(null);
  const weights = s.assessmentTypes.reduce((a, x) => a + (x.weight || 0), 0);

  const importFile = (f: File) => run(async () => {
    const json = JSON.parse(await f.text());
    if (!confirm(`Replace ALL of the school's data and settings with ${f.name}?`)) return;
    await api.post('/import', json);
    await reload();
    location.reload();
  }, 'Backup restored');

  return (
    <>
      <PageHead title="Admin" sub="Settings & lists · changes apply across the whole app" />
      <div className="grid g-admin">
        <UsersCard />
        <Card title="School">
          <div className="form-grid">
            <Field label="School name" wide><input value={s.schoolName} onChange={(e) => d.set('schoolName', e.target.value)} /></Field>
            <Field label="Address" wide><input value={s.schoolAddress} onChange={(e) => d.set('schoolAddress', e.target.value)} /></Field>
            <Field label="Contact" wide hint="Phone · e-mail (used in e-mails and receipts)"><input value={s.schoolContact} onChange={(e) => d.set('schoolContact', e.target.value)} /></Field>
            <Field label="Principal"><input value={s.principal} onChange={(e) => d.set('principal', e.target.value)} /></Field>
            <Field label="Current term"><Select value={s.currentTerm} onChange={(v) => d.set('currentTerm', v)} options={s.terms.map((t) => t.name)} /></Field>
          </div>
        </Card>

        <Card title="Rules">
          <div className="form-grid">
            <Field label="Count late as present"><Select value={s.lateCountsPresent ? 'Yes' : 'No'} onChange={(v) => d.set('lateCountsPresent', v === 'Yes')} options={['Yes', 'No']} /></Field>
            <Field label="Use fees"><Select value={s.useFees ? 'Yes' : 'No'} onChange={(v) => d.set('useFees', v === 'Yes')} options={['Yes', 'No']} /></Field>
            <Field label="At risk if attendance under (%)"><input type="number" min="0" max="100" value={Math.round(s.riskAttendance * 100)} onChange={(e) => d.set('riskAttendance', +e.target.value / 100)} /></Field>
            <Field label="At risk if average drops by"><input type="number" min="0" value={s.riskDrop} onChange={(e) => d.set('riskDrop', +e.target.value)} /></Field>
            <Field label="Currency symbol"><input value={s.currencySymbol} onChange={(e) => d.set('currencySymbol', e.target.value)} /></Field>
            <Field label="Currency decimals"><Select value={String(s.currencyDecimals)} onChange={(v) => d.set('currencyDecimals', +v)} options={['0', '2']} /></Field>
          </div>
          <p className="muted small">A learner gets a flag for each rule they meet (attendance, average drop, fees overdue): 2 or more flags = at risk, 1 = watch list.</p>
        </Card>

        <Card title="Grades & fees per term">
          <RowsEditor rows={s.grades} onChange={(v) => d.set('grades', v)} addLabel="Add grade" blank={{ name: '', tuition: 0, books: 0 }}
            cols={[{ key: 'name', label: 'Grade' }, { key: 'tuition', label: 'Tuition', type: 'number' }, { key: 'books', label: 'Books & activities', type: 'number' }]} />
        </Card>

        <Card title="Optional fees">
          <RowsEditor rows={s.optionalFees} onChange={(v) => d.set('optionalFees', v)} addLabel="Add optional fee" blank={{ name: '', amount: 0 }}
            cols={[{ key: 'name', label: 'Fee' }, { key: 'amount', label: 'Amount per term', type: 'number' }]} />
          <p className="muted small">Ticked per learner on the learner's form.</p>
        </Card>

        <Card title="Default assessments" actions={<span className={`pill ${weights === 100 ? 'ok' : 'warn'}`}>weights total {weights}%</span>}>
          <RowsEditor rows={s.assessmentTypes} onChange={(v) => d.set('assessmentTypes', v)} addLabel="Add assessment" blank={{ name: '', weight: 0 }}
            cols={[{ key: 'name', label: 'Assessment' }, { key: 'weight', label: 'Weight %', type: 'number', width: '30%' }]} />
        </Card>

        <Card title="Grading scale">
          <RowsEditor rows={s.gradeBands} onChange={(v) => d.set('gradeBands', v)} addLabel="Add band" blank={{ band: '', from: 0, meaning: '' }}
            cols={[{ key: 'band', label: 'Grade', width: '20%' }, { key: 'from', label: 'From', type: 'number', width: '22%' }, { key: 'meaning', label: 'Meaning' }]} />
          <p className="muted small">"From" is the lowest mark in the band. Sorted highest first when saved.</p>
        </Card>

        <Card title="Subjects"><StringList value={s.subjects} onChange={(v) => d.set('subjects', v)} placeholder="Add subject…" /></Card>
        <Card title="Payment methods"><StringList value={s.payMethods} onChange={(v) => d.set('payMethods', v)} /></Card>
        <Card title="Learner statuses"><StringList value={s.studentStatuses} onChange={(v) => d.set('studentStatuses', v)} /><p className="muted small">"Active" learners are on registers and get billed.</p></Card>
        <Card title="Relationships"><StringList value={s.relationships} onChange={(v) => d.set('relationships', v)} /></Card>
        <Card title="Genders"><StringList value={s.genders} onChange={(v) => d.set('genders', v)} /></Card>
        <Card title="Streams / sections"><StringList value={s.streams} onChange={(v) => d.set('streams', v)} /></Card>

        <Card title="Data" className="span-2">
          <div className="form-grid">
            <Field label="Sample mode" hint="Pins “today” to the date below so the sample data looks live">
              <Select value={s.sampleMode ? 'Yes' : 'No'} onChange={(v) => d.set('sampleMode', v === 'Yes')} options={['Yes', 'No']} />
            </Field>
            <Field label="Sample date"><input type="date" value={s.sampleAnchor ?? ''} onChange={(e) => d.set('sampleAnchor', e.target.value)} disabled={!s.sampleMode} /></Field>
          </div>
          <div className="btn-row">
            <a className="btn" href="/api/export" download>Download backup (.json)</a>
            <button className="btn" onClick={() => file.current?.click()} disabled={busy}>Restore backup…</button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <button className="btn" disabled={busy} onClick={() => run(async () => {
              if (!confirm('Replace everything with the sample school (Alder Valley Academy)?')) return;
              await api.post('/admin/load-sample'); await reload(); location.reload();
            }, 'Sample data loaded')}>Load sample data</button>
            <button className="btn danger" disabled={busy} onClick={() => run(async () => {
              if (prompt(`This deletes every learner, class, teacher, register, mark and payment, keeping only the settings, lists, calendar and templates.\n\nType CLEAR to continue.`) !== 'CLEAR') return;
              await api.post('/admin/clear-data'); await reload(); location.reload();
            }, 'School data cleared')}>Clear all school data…</button>
          </div>
          <p className="muted small">To bring in data from the Excel workbook, run <code>python3 scripts/import_xlsm.py School_Management.xlsm</code>, then <code>npm run seed</code>. Today is {meta.today}.</p>
        </Card>
      </div>
      <SaveBar {...d} />
    </>
  );
}
