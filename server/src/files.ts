/**
 * FILES: documents attached to a learner, homework, study material, an admission application or a staff record.
 * Stored on disk under data/uploads with random names; the documents table keeps the original name, type and owner.
 * Only the listed file types are accepted (decided by extension, never by what the browser claims), at most 10 MB,
 * and downloads are always sent as attachments so a file can never run as a page of the app.
 */
import express, { Router, type Request } from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { logActivity } from './activity.ts';
import { DATA_DIR, type Row, type Store } from './db.ts';
import { bad, forbidden, h, mayTeach, notFound, nowIso, str } from './kit.ts';

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? resolve(DATA_DIR, 'uploads');
export const MAX_BYTES = 10 * 1024 * 1024;
export const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text', '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.txt': 'text/plain', '.csv': 'text/csv',
};
export type OwnerType = 'student' | 'homework' | 'material' | 'application' | 'staff';
const OWNER_TABLE: Record<OwnerType, 'students' | 'homework' | 'materials' | 'applications' | 'staff'> = {
  student: 'students', homework: 'homework', material: 'materials', application: 'applications', staff: 'staff',
};

/** Who may see / add files for each kind of owner. */
function allowed(req: Request, type: OwnerType, owner: Row, write: boolean) {
  const p = req.perms;
  if (!p) return false;
  switch (type) {
    case 'student': return p.admin;
    case 'homework': case 'material':
      if (write) return mayTeach(p, owner.className);
      if (p.staff) return true;
      return p.portal && !!(req as any).learnerClasses?.includes(owner.className);
    case 'application': return p.admissions;
    case 'staff': return p.hr;
  }
}

export function saveFile(store: Store, o: { ownerType: OwnerType; ownerId: number; filename: string; data: Buffer; label?: string; by: string }) {
  const name = o.filename.replace(/[\\/\0\r\n"]/g, '_').slice(-120) || 'file';
  const ext = extname(name).toLowerCase();
  const mime = TYPES[ext];
  if (!mime) throw bad(`Files of type ${ext || '(none)'} are not accepted. Use PDF, a picture, Word, Excel, PowerPoint or text.`);
  if (!o.data.length) throw bad('The file is empty');
  if (o.data.length > MAX_BYTES) throw bad('Files can be at most 10 MB');
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const storedAs = randomBytes(16).toString('hex') + ext;
  writeFileSync(resolve(UPLOAD_DIR, storedAs), o.data);
  return store.insert('documents', {
    ownerType: o.ownerType, ownerId: o.ownerId, label: str(o.label) || null, filename: name, mime, size: o.data.length,
    storedAs, uploadedBy: o.by, at: nowIso(),
  });
}

export function filesOf(store: Store, type: OwnerType, ids: number[]) {
  if (!ids.length) return [];
  return store.all('documents', `WHERE ownerType = ? AND ownerId IN (${ids.map(() => '?').join(',')}) ORDER BY id`, type, ...ids)
    .map(({ storedAs, ...d }) => d);
}

/** Remove an owner's files (when the learner / homework / … is deleted). */
export function deleteFilesOf(store: Store, type: OwnerType, ownerId: number) {
  for (const d of store.all('documents', 'WHERE ownerType = ? AND ownerId = ?', type, ownerId)) {
    rmSync(resolve(UPLOAD_DIR, d.storedAs), { force: true });
    store.db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
  }
}

export function sendFile(res: any, d: Row) {
  const path = resolve(UPLOAD_DIR, d.storedAs);
  if (!existsSync(path)) throw notFound('File');
  res.setHeader('Content-Type', d.mime);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(readFileSync(path));
}

export function buildFilesApi(store: Store) {
  const r = Router();
  const ownerOf = (type: string, id: number) => {
    if (!(type in OWNER_TABLE)) throw bad('Unknown kind of file owner');
    const row = store.get(OWNER_TABLE[type as OwnerType], id);
    if (!row) throw notFound('The record the file belongs to');
    return row;
  };
  const docOr404 = (id: number) => store.get('documents', id) ?? (() => { throw notFound('File'); })();
  /** Parents / students: the classes of their learners (for homework / material files). */
  r.use((req, _res, next) => {
    if (req.perms?.portal) (req as any).learnerClasses = req.perms.learners.map((id) => store.get('students', id)?.className).filter(Boolean);
    next();
  });

  r.get('/files', h((req) => {
    const type = str(req.query.ownerType) as OwnerType, id = Number(req.query.ownerId);
    const owner = ownerOf(type, id);
    if (!allowed(req, type, owner, false)) throw forbidden('You cannot see these files');
    return filesOf(store, type, [id]);
  }));

  r.post('/files', express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h((req) => {
    const type = str(req.query.ownerType) as OwnerType, id = Number(req.query.ownerId);
    const owner = ownerOf(type, id);
    if (!allowed(req, type, owner, true)) throw forbidden('You cannot add files here');
    let filename = '';
    try { filename = decodeURIComponent(str(req.get('x-filename'))); } catch { throw bad('Bad file name'); }
    const doc = saveFile(store, { ownerType: type, ownerId: id, filename, data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), label: str(req.query.label), by: req.user!.name });
    logActivity(store, req, { category: 'data', action: 'file.upload', summary: `Uploaded ${doc.filename} to ${type} #${id}`, learnerId: type === 'student' ? id : null, details: { file: doc.filename, size: doc.size, ownerType: type, ownerId: id } });
    const { storedAs, ...out } = doc;
    return out;
  }));

  r.get('/files/:id', (req, res, next) => {
    try {
      const d = docOr404(+req.params.id);
      if (!allowed(req, d.ownerType, ownerOf(d.ownerType, d.ownerId), false)) throw forbidden('You cannot open this file');
      sendFile(res, d);
    } catch (e) { next(e); }
  });

  r.delete('/files/:id', h((req) => {
    const d = docOr404(+req.params.id);
    if (!allowed(req, d.ownerType, ownerOf(d.ownerType, d.ownerId), true)) throw forbidden('You cannot delete this file');
    rmSync(resolve(UPLOAD_DIR, d.storedAs), { force: true });
    store.db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
    logActivity(store, req, { category: 'data', action: 'file.delete', summary: `Deleted file ${d.filename} from ${d.ownerType} #${d.ownerId}`, learnerId: d.ownerType === 'student' ? d.ownerId : null });
  }));
  return r;
}
