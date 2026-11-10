/**
 * LEARNING: homework, study materials (files or links) and the notice board.
 * Teachers post for their own classes; admins for any class. Notices go to everyone, staff, families, or one class.
 */
import { Router, type Request } from 'express';
import { logActivity } from './activity.ts';
import type { Row, Store } from './db.ts';
import { appToday } from './engine.ts';
import { deleteFilesOf, filesOf } from './files.ts';
import { bad, forbidden, h, isIso, mayTeach, need, needClass, notFound, nowIso, pick, str } from './kit.ts';

export function noticeAudiences(store: Store) {
  return ['everyone', 'staff', 'families', ...(store.db.prepare('SELECT name FROM classes ORDER BY name').all() as { name: string }[]).map((c) => `class:${c.name}`)];
}
/** Notices a family sees: everyone, families, and their learners' classes; not expired. */
export function familyNotices(store: Store, classes: string[], today: string) {
  const aud = ['everyone', 'families', ...classes.map((c) => `class:${c}`)];
  return store.all('announcements', `WHERE audience IN (${aud.map(() => '?').join(',')}) AND (expires IS NULL OR expires >= ?) ORDER BY pinned DESC, at DESC LIMIT 50`, ...aud, today);
}

export function buildLearningApi(store: Store) {
  const r = Router();
  const classes = () => (store.db.prepare('SELECT name FROM classes').all() as { name: string }[]).map((c) => c.name);
  const log = (req: Request, action: string, summary: string, details?: unknown) =>
    logActivity(store, req, { category: 'grades', action, summary, details });

  // ------------------------------------------------------------ homework & materials (same shape)
  for (const kind of ['homework', 'materials'] as const) {
    const fileType = kind === 'homework' ? 'homework' : 'material';
    const cols = kind === 'homework' ? ['className', 'subject', 'title', 'details', 'setOn', 'dueOn'] : ['className', 'subject', 'title', 'details', 'link'];
    const label = kind === 'homework' ? 'homework' : 'study material';
    const validate = (b: any) => {
      if (!classes().includes(b.className)) throw bad('Pick a class');
      if (b.subject && !store.settings().subjects.includes(b.subject)) throw bad('Unknown subject');
      if (!str(b.title)) throw bad('Give it a title');
      if (kind === 'homework') {
        if (b.setOn && !isIso(b.setOn)) throw bad('"Set on" is not a valid date');
        if (b.dueOn && !isIso(b.dueOn)) throw bad('"Due" is not a valid date');
        if (b.setOn && b.dueOn && b.dueOn < b.setOn) throw bad('The due date is before the date it was set');
      } else if (b.link && !/^https?:\/\/\S+$/i.test(str(b.link))) throw bad('Links must start with http:// or https://');
    };
    const own = (id: number) => store.get(kind, id) ?? (() => { throw notFound(label); })();

    r.get(`/${kind}`, h((req) => {
      need(req, 'staff');
      const where: string[] = [], args: any[] = [];
      if (req.query.class) { where.push('className = ?'); args.push(str(req.query.class)); }
      if (req.query.subject) { where.push('subject = ?'); args.push(str(req.query.subject)); }
      const rows = store.all(kind, `${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${kind === 'homework' ? "COALESCE(dueOn, setOn) DESC" : 'at DESC'}, id DESC LIMIT 200`, ...args);
      const files = filesOf(store, fileType, rows.map((x) => x.id));
      return rows.map((x) => ({ ...x, files: files.filter((f) => f.ownerId === x.id), canEdit: mayTeach(req.perms, x.className) }));
    }));
    r.post(`/${kind}`, h((req) => {
      const b: Record<string, any> = { ...pick(req.body, cols), ...(kind === 'homework' ? { setOn: req.body?.setOn || appToday(store.settings()) } : {}) };
      validate(b);
      needClass(req, b.className);
      const row = store.insert(kind, { ...b, postedBy: req.user!.name, at: nowIso() });
      log(req, `${kind}.create`, `Posted ${label} "${row.title}" for ${row.className}${row.subject ? ` (${row.subject})` : ''}${row.dueOn ? `, due ${row.dueOn}` : ''}`);
      return { ...row, files: [], canEdit: true };
    }));
    r.put(`/${kind}/:id`, h((req) => {
      const cur = own(+req.params.id);
      needClass(req, cur.className);
      const b = { ...cur, ...pick(req.body, cols) };
      validate(b);
      needClass(req, b.className);
      const row = store.update(kind, cur.id, b)!;
      log(req, `${kind}.update`, `Edited ${label} "${row.title}" for ${row.className}`);
      return row;
    }));
    r.delete(`/${kind}/:id`, h((req) => {
      const cur = own(+req.params.id);
      needClass(req, cur.className);
      deleteFilesOf(store, fileType, cur.id);
      store.remove(kind, cur.id);
      log(req, `${kind}.delete`, `Deleted ${label} "${cur.title}" for ${cur.className}`, cur);
    }));
  }

  // ------------------------------------------------------------ notice board
  const mayPost = (req: Request, audience: string) => {
    const p = req.perms!;
    if (p.admin) return true;
    if (p.teach && audience.startsWith('class:')) return mayTeach(p, audience.slice(6));
    return false;
  };
  const validateNotice = (b: any) => {
    if (!str(b.title)) throw bad('Give the notice a title');
    if (!noticeAudiences(store).includes(b.audience)) throw bad('Pick who the notice is for');
    if (b.expires && !isIso(b.expires)) throw bad('"Show until" is not a valid date');
  };
  const canEdit = (req: Request, n: Row) => !!req.perms?.admin || (n.postedById === req.user?.id && mayPost(req, n.audience));
  r.get('/announcements', h((req) => {
    need(req, 'staff');
    const today = appToday(store.settings());
    const rows = store.all('announcements', `${req.query.all ? '' : 'WHERE (expires IS NULL OR expires >= ?)'} ORDER BY pinned DESC, at DESC LIMIT 200`, ...(req.query.all ? [] : [today]));
    return { items: rows.map((n) => ({ ...n, canEdit: canEdit(req, n), expired: !!n.expires && n.expires < today })), audiences: noticeAudiences(store).filter((a) => mayPost(req, a)) };
  }));
  r.post('/announcements', h((req) => {
    const b: Record<string, any> = { audience: 'everyone', ...pick(req.body, ['title', 'body', 'audience', 'pinned', 'expires']) };
    validateNotice(b);
    if (!mayPost(req, b.audience)) throw forbidden(req.perms?.teach ? 'Teachers can post notices to their own class' : 'Only admins and teachers can post notices');
    const row = store.insert('announcements', { ...b, pinned: b.pinned ? 1 : 0, postedBy: req.user!.name, postedById: req.user!.id, at: nowIso() });
    logActivity(store, req, { category: 'settings', action: 'notice.create', summary: `Posted notice "${row.title}" to ${row.audience}` });
    return row;
  }));
  r.put('/announcements/:id', h((req) => {
    const cur = store.get('announcements', +req.params.id) ?? (() => { throw notFound('Notice'); })();
    if (!canEdit(req, cur)) throw forbidden('Only the person who posted it, or an admin, can change this notice');
    const b = { ...cur, ...pick(req.body, ['title', 'body', 'audience', 'pinned', 'expires']) };
    validateNotice(b);
    if (!mayPost(req, b.audience)) throw forbidden('You cannot post to that audience');
    const row = store.update('announcements', cur.id, { ...b, pinned: b.pinned ? 1 : 0 })!;
    logActivity(store, req, { category: 'settings', action: 'notice.update', summary: `Edited notice "${row.title}"` });
    return row;
  }));
  r.delete('/announcements/:id', h((req) => {
    const cur = store.get('announcements', +req.params.id) ?? (() => { throw notFound('Notice'); })();
    if (!canEdit(req, cur)) throw forbidden('Only the person who posted it, or an admin, can delete this notice');
    store.remove('announcements', cur.id);
    logActivity(store, req, { category: 'settings', action: 'notice.delete', summary: `Deleted notice "${cur.title}"`, details: cur });
  }));
  return r;
}
