import { useState } from 'react';
import { api } from '../api';
import { SaveBar, useSettingsDraft } from '../components/Editors';
import { Card, Field, MessagesModal, PageHead, useMeta } from '../components/ui';
import type { Settings } from '../types';

const KINDS: { key: keyof Settings['templates']; title: string; usedBy: string; tags: string }[] = [
  { key: 'absent', title: 'Absence alert', usedBy: 'Message guardians · Today, Attendance', tags: '{Guardian} {First} {Class} {Date} {School} {Contact}' },
  { key: 'risk', title: 'At-risk e-mail', usedBy: 'E-mail · Today (learner at risk), Students', tags: '{Guardian} {First} {Details} {Term} {School} {Contact}' },
  { key: 'report', title: 'Report card e-mail', usedBy: 'E-mail guardian / E-mail class · Report Cards', tags: '{Guardian} {First} {Term} {Class} {School}' },
  { key: 'fees', title: 'Fee reminder', usedBy: 'Send reminders · Fees & Receipts', tags: '{Guardian} {First} {Overdue} {Due} {Term} {Balance}' },
];

const TAGS: [string, string][] = [
  ['{Guardian}', "guardian's name"], ['{First}', "learner's first name"], ['{Last}', "learner's last name"], ['{Class}', "learner's class"],
  ['{Date}', "today / the register's date"], ['{Term}', 'term'], ['{Details}', 'attendance, average, fees'], ['{Balance}', 'fees still to pay'],
  ['{Overdue}', 'fees overdue'], ['{Due}', "the term's fees due date"], ['{School}', 'Admin › School name'], ['{Contact}', 'Admin › School contact'],
];

export default function Communications() {
  const { meta } = useMeta();
  const d = useSettingsDraft();
  const [preview, setPreview] = useState<keyof Settings['templates'] | null>(null);
  const [sampleId, setSampleId] = useState<number | null>(null);
  const setT = (k: keyof Settings['templates'], patch: Partial<Settings['templates']['absent']>) =>
    d.set('templates', { ...d.draft.templates, [k]: { ...d.draft.templates[k], ...patch } });
  const openPreview = async (k: keyof Settings['templates']) => {
    if (sampleId === null) {
      const r = await api.get<any[]>('/students');
      setSampleId(r.find((s: any) => s.status === 'Active')?.id ?? null);
    }
    setPreview(k);
  };
  return (
    <>
      <PageHead title="Communications" sub="E-mail templates · the {tags} fill in for each guardian" />
      <div className="grid g-comms">
        {KINDS.map((k) => (
          <Card key={k.key} title={k.title} actions={<button className="btn sm" disabled={d.dirty} title={d.dirty ? 'Save first' : ''} onClick={() => openPreview(k.key)}>Preview</button>}>
            <p className="muted small">Sent by: {k.usedBy}</p>
            <Field label="Subject" wide><input value={d.draft.templates[k.key].subject} onChange={(e) => setT(k.key, { subject: e.target.value })} /></Field>
            <Field label="Message" wide><textarea rows={8} value={d.draft.templates[k.key].body} onChange={(e) => setT(k.key, { body: e.target.value })} /></Field>
            <p className="muted small">Tags here: {k.tags}</p>
          </Card>
        ))}
        <Card title="Tags">
          <table className="table compact"><tbody>{TAGS.map(([t, w]) => <tr key={t}><td><code>{t}</code></td><td className="muted">{w}</td></tr>)}</tbody></table>
          <p className="muted small">Type a tag into the subject or message, braces included. Every e-mail opens in your mail app for you to check and send; nothing is sent by the app. Templates are settings: they stay when the school's data is cleared.</p>
        </Card>
      </div>
      <SaveBar {...d} />
      {preview && sampleId !== null && <MessagesModal kind={preview} learnerIds={[sampleId]} date={meta.today} title="Preview (first learner)" onClose={() => setPreview(null)} />}
    </>
  );
}
