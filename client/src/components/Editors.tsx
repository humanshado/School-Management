import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Settings } from '../types';
import { useAction, useMeta } from './ui';

/** A working copy of the settings with Save / Discard. */
export function useSettingsDraft() {
  const { meta, reload } = useMeta();
  const [draft, setDraft] = useState<Settings>(meta.settings);
  const { busy, run } = useAction();
  useEffect(() => setDraft(meta.settings), [meta.settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(meta.settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = () => run(async () => { await api.put('/settings', draft); await reload(); }, 'Settings saved');
  const discard = () => setDraft(meta.settings);
  return { draft, set, dirty, busy, save, discard };
}

export function SaveBar({ dirty, busy, save, discard }: { dirty: boolean; busy: boolean; save: () => void; discard: () => void }) {
  if (!dirty) return null;
  return (
    <div className="save-bar">
      <span>You have unsaved changes.</span>
      <button className="btn" onClick={discard}>Discard</button>
      <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
    </div>
  );
}

export function StringList({ value, onChange, placeholder = 'Add…' }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [add, setAdd] = useState('');
  const push = () => { const v = add.trim(); if (v && !value.includes(v)) onChange([...value, v]); setAdd(''); };
  const move = (i: number, d: number) => { const n = [...value]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <div className="str-list">
      {value.map((v, i) => (
        <div key={i} className="str-item">
          <input value={v} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} aria-label="Item" />
          <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
          <button className="icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove">×</button>
        </div>
      ))}
      <div className="str-item add">
        <input value={add} placeholder={placeholder} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), push())} aria-label="New item" />
        <button className="btn sm" onClick={push} disabled={!add.trim()}>Add</button>
      </div>
    </div>
  );
}

export interface Col<T> { key: keyof T & string; label: string; type?: 'text' | 'number' | 'date'; width?: string; placeholder?: string }

export function RowsEditor<T extends Record<string, any>>({ rows, cols, onChange, blank, addLabel = 'Add row' }: {
  rows: T[]; cols: Col<T>[]; onChange: (r: T[]) => void; blank: T; addLabel?: string;
}) {
  return (
    <div className="table-wrap">
      <table className="table rows-editor">
        <thead><tr>{cols.map((c) => <th key={c.key} style={{ width: c.width }}>{c.label}</th>)}<th style={{ width: 36 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key}>
                  <input type={c.type ?? 'text'} value={r[c.key] ?? ''} placeholder={c.placeholder} aria-label={c.label}
                    onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: c.type === 'number' ? (e.target.value === '' ? 0 : +e.target.value) : e.target.value } : x)))} />
                </td>
              ))}
              <td><button className="icon-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove row">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn sm" onClick={() => onChange([...rows, { ...blank }])}>+ {addLabel}</button>
    </div>
  );
}
