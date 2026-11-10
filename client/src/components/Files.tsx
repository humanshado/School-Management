import { useRef, useState } from 'react';
import { api, uploadFile } from '../api';
import { fileSize } from '../format';
import type { FileDoc } from '../types';
import { useAction } from './ui';

export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.txt,.csv';
const icon = (mime: string) => (mime.startsWith('image/') ? '🖼' : mime === 'application/pdf' ? '📄' : mime.includes('sheet') || mime.includes('excel') || mime.includes('csv') ? '📊' : '📎');

/** Attached files with download links; upload / delete when `editable`. */
export default function Files({ ownerType, ownerId, files, editable, onChange, compact }: {
  ownerType: string; ownerId: number; files: FileDoc[]; editable?: boolean; onChange?: () => void; compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | null) => list && list.length && run(async () => {
    for (const f of Array.from(list)) await uploadFile(`/files?ownerType=${ownerType}&ownerId=${ownerId}`, f);
    onChange?.();
  }, list.length === 1 ? 'File added' : `${list.length} files added`);
  return (
    <div className={`files ${compact ? 'compact' : ''} ${drag ? 'drag' : ''}`}
      onDragOver={(e) => { if (editable) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { if (editable) { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); } }}>
      {files.map((f) => (
        <span key={f.id} className="file-chip">
          <a href={`/api/files/${f.id}`} download title={`${f.filename} · ${fileSize(f.size)} · added by ${f.uploadedBy}`}>{icon(f.mime)} {f.label || f.filename}</a>
          {!compact && <small className="muted">{fileSize(f.size)}</small>}
          {editable && <button className="icon-btn" aria-label={`Remove ${f.filename}`} onClick={() => run(async () => { if (confirm(`Remove ${f.filename}?`)) { await api.del(`/files/${f.id}`); onChange?.(); } })}>×</button>}
        </span>
      ))}
      {editable && <>
        <button className="btn sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : '+ Attach file'}</button>
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </>}
      {!files.length && !editable && <span className="muted small">No files.</span>}
    </div>
  );
}
