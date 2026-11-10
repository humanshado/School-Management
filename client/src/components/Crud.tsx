import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { Field, Modal, useAction } from './ui';

export interface FieldDef<T> { key: keyof T & string; label: string; required?: boolean; wide?: boolean; render?: (v: any, set: (v: any) => void) => ReactNode }

/** Add / edit modal for a simple record type. */
export function EditModal<T extends { id?: number }>({ title, path, fields, initial, onClose, onSaved, onDelete }: {
  title: string; path: string; fields: FieldDef<T>[]; initial: Partial<T>; onClose: () => void; onSaved: () => void; onDelete?: () => Promise<void>;
}) {
  const [f, setF] = useState<Partial<T>>(initial);
  const { busy, run } = useAction();
  const save = async () => {
    const r = await run(() => (f.id ? api.put(`${path}/${f.id}`, f) : api.post(path, f)), 'Saved');
    if (r) onSaved();
  };
  return (
    <Modal title={title} onClose={onClose} footer={<>
      {f.id && onDelete && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => run(onDelete)}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={busy}>Save</button>
    </>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {fields.map((d, i) => (
          <Field key={d.key} label={d.label + (d.required ? ' *' : '')} wide={d.wide}>
            {d.render ? d.render(f[d.key], (v) => setF((x) => ({ ...x, [d.key]: v })))
              : <input value={(f[d.key] as any) ?? ''} autoFocus={i === 0} onChange={(e) => setF((x) => ({ ...x, [d.key]: e.target.value }))} />}
          </Field>
        ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
