/**
 * ADMISSIONS: a public application form (no login; closed unless an admin opens it), document uploads, a pipeline of
 * stages, and "Enrol" which turns an application into a learner (with its documents).
 *
 * Public safety: the form is off by default; each address may send a few applications an hour; uploads need the
 * secret token returned with the application, only within a day of applying, at most 5 files.
 */
import express, { Router, type Request } from 'express';
import { randomBytes } from 'node:crypto';
import { logActivity } from './activity.ts';
import type { Row, Store } from './db.ts';
import { appToday } from './engine.ts';
import { deleteFilesOf, filesOf, MAX_BYTES, saveFile } from './files.ts';
import { HttpError, bad, h, isIso, need, notFound, nowIso, pick, str } from './kit.ts';

export const STAGES = ['Applied', 'Reviewing', 'Interview', 'Offered', 'Accepted', 'Enrolled', 'Waitlisted', 'Declined', 'Withdrawn'] as const;
const FORM_COLS = ['firstName', 'lastName', 'dob', 'gender', 'gradeApplying', 'guardianName', 'relationship', 'guardianPhone', 'guardianEmail', 'address', 'previousSchool', 'notes'];
const MAX_FILES = 5, UPLOAD_WINDOW_MS = 24 * 3600 * 1000;

const recent = new Map<string, number[]>();
function rateLimit(ip: string, max = 5, windowMs = 3600_000) {
  const now = Date.now(), list = (recent.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Too many applications from this connection. Please try again later or contact the school.');
  list.push(now);
  recent.set(ip, list);
}

export function buildPublicApi(store: Store) {
  const r = Router();
  r.get('/public/admissions', h(() => {
    const s = store.settings();
    return {
      open: !!s.admissionsOpen, intro: s.admissionsIntro ?? '', school: { name: s.schoolName, address: s.schoolAddress, contact: s.schoolContact },
      grades: s.grades.map((g) => g.name), relationships: s.relationships, genders: s.genders,
    };
  }));
  r.post('/public/applications', h((req) => {
    const s = store.settings();
    if (!s.admissionsOpen) throw new HttpError(403, 'Applications are closed at the moment. Please contact the school.');
    if (str(req.body?.website)) throw bad('Something went wrong'); // a hidden field only robots fill in
    rateLimit(req.ip ?? '?');
    const b = pick(req.body, FORM_COLS);
    for (const k of Object.keys(b)) b[k] = str(b[k]).slice(0, k === 'notes' || k === 'address' ? 1000 : 120) || null;
    if (!b.firstName || !b.lastName) throw bad("Enter the child's first and last name");
    if (b.dob && !isIso(b.dob)) throw bad('Date of birth is not a valid date');
    if (!s.grades.some((g) => g.name === b.gradeApplying)) throw bad('Pick the grade you are applying for');
    if (!b.guardianName) throw bad("Enter the parent / guardian's name");
    if (!b.guardianPhone && !b.guardianEmail) throw bad('Give a phone number or an e-mail so we can reach you');
    if (b.guardianEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.guardianEmail)) throw bad('The e-mail does not look right');
    const year = appToday(s).slice(0, 4);
    const n = (store.db.prepare("SELECT COUNT(*) AS n FROM applications WHERE ref LIKE ?").get(`APP-${year}-%`) as { n: number }).n + 1;
    const token = randomBytes(24).toString('base64url');
    const row = store.insert('applications', { ...b, ref: `APP-${year}-${String(n).padStart(4, '0')}`, status: 'Applied', submittedAt: nowIso(), updatedAt: nowIso(), token });
    logActivity(store, req, { category: 'admissions', action: 'application.submit', summary: `New application ${row.ref}: ${row.firstName} ${row.lastName} for ${row.gradeApplying} (guardian ${row.guardianName})` }, { id: null, name: `${row.guardianName} (applicant)` });
    return { ref: row.ref, token };
  }));
  r.post('/public/applications/:token/files', express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h((req) => {
    const a = store.all('applications', 'WHERE token = ?', str(req.params.token))[0];
    if (!a) throw notFound('Application');
    if (Date.now() - Date.parse(a.submittedAt) > UPLOAD_WINDOW_MS) throw new HttpError(403, 'Documents can only be added on the day you apply. Please e-mail them to the school.');
    if (filesOf(store, 'application', [a.id]).length >= MAX_FILES) throw bad(`At most ${MAX_FILES} documents`);
    let filename = '';
    try { filename = decodeURIComponent(str(req.get('x-filename'))); } catch { throw bad('Bad file name'); }
    const d = saveFile(store, { ownerType: 'application', ownerId: a.id, filename, data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), by: `${a.guardianName} (applicant)` });
    return { filename: d.filename, size: d.size };
  }));
  return r;
}

export function buildAdmissionsApi(store: Store) {
  const r = Router();
  const log = (req: Request, action: string, summary: string, details?: unknown) => logActivity(store, req, { category: 'admissions', action, summary, details });
  const appOr404 = (id: number) => store.get('applications', id) ?? (() => { throw notFound('Application'); })();
  const out = ({ token, ...a }: Row) => a;

  r.get('/applications', h((req) => {
    need(req, 'admissions');
    const rows = store.all('applications', 'ORDER BY id DESC');
    const counts = Object.fromEntries(STAGES.map((st) => [st, rows.filter((a) => a.status === st).length]));
    const status = str(req.query.status);
    const list = status ? rows.filter((a) => a.status === status) : rows;
    const files = filesOf(store, 'application', list.map((a) => a.id));
    const s = store.settings();
    return { stages: STAGES, counts, open: !!s.admissionsOpen, intro: s.admissionsIntro ?? '', items: list.map((a) => ({ ...out(a), files: files.filter((f) => f.ownerId === a.id) })) };
  }));

  r.put('/applications/settings', h((req) => {
    need(req, 'admin');
    const s = store.settings();
    const next = { ...s, admissionsOpen: !!req.body?.open, admissionsIntro: str(req.body?.intro).slice(0, 2000) };
    store.saveSettings(next);
    if (!!s.admissionsOpen !== next.admissionsOpen) log(req, next.admissionsOpen ? 'admissions.open' : 'admissions.close', next.admissionsOpen ? 'Opened online applications' : 'Closed online applications');
    return { open: next.admissionsOpen, intro: next.admissionsIntro };
  }));

  r.put('/applications/:id', h((req) => {
    need(req, 'admissions');
    const cur = appOr404(+req.params.id);
    const b = { ...cur, ...pick(req.body, [...FORM_COLS, 'status', 'interviewAt', 'decisionNotes']) };
    if (!STAGES.includes(b.status)) throw bad('Unknown stage');
    if (b.status === 'Enrolled' && !cur.studentId) throw bad('Use "Enrol" to enrol the child: it creates their learner record');
    if (cur.status === 'Enrolled' && b.status !== 'Enrolled') throw bad('This child is already enrolled');
    if (b.interviewAt && Number.isNaN(Date.parse(b.interviewAt))) throw bad('The interview time is not valid');
    const row = store.update('applications', cur.id, { ...b, updatedAt: nowIso() })!;
    if (cur.status !== row.status) log(req, 'application.stage', `${row.ref} (${row.firstName} ${row.lastName}): ${cur.status} → ${row.status}`);
    else log(req, 'application.update', `Updated application ${row.ref} (${row.firstName} ${row.lastName})`);
    return out(row);
  }));

  r.post('/applications/:id/enrol', h((req) => {
    need(req, 'admissions');
    const a = appOr404(+req.params.id);
    if (a.studentId) throw bad('Already enrolled');
    const cls = store.all('classes', 'WHERE name = ?', str(req.body?.className))[0];
    if (!cls) throw bad('Pick the class to enrol into');
    const n = store.all('students', 'WHERE className = ?', cls.name).length + 1;
    let learnerNo = `S-${cls.name}-${String(n).padStart(2, '0')}`;
    while (store.all('students', 'WHERE learnerNo = ?', learnerNo).length) learnerNo += '+';
    const st = store.tx(() => {
      const st = store.insert('students', {
        learnerNo, firstName: a.firstName, lastName: a.lastName, className: cls.name, dob: a.dob, gender: a.gender, status: 'Active',
        enrolmentDate: appToday(store.settings()), guardianName: a.guardianName, relationship: a.relationship, guardianPhone: a.guardianPhone,
        guardianEmail: a.guardianEmail, address: a.address, notes: [a.previousSchool && `Previous school: ${a.previousSchool}`, `Admitted from application ${a.ref}`].filter(Boolean).join('\n'),
      });
      store.db.prepare("UPDATE documents SET ownerType = 'student', ownerId = ? WHERE ownerType = 'application' AND ownerId = ?").run(st.id, a.id);
      store.db.prepare('UPDATE applications SET status = ?, studentId = ?, updatedAt = ? WHERE id = ?').run('Enrolled', st.id, nowIso(), a.id);
      return st;
    });
    logActivity(store, req, { category: 'admissions', action: 'application.enrol', summary: `Enrolled ${st.firstName} ${st.lastName} into ${cls.name} (${st.learnerNo}) from application ${a.ref}`, learnerId: st.id });
    return { student: st };
  }));

  r.delete('/applications/:id', h((req) => {
    need(req, 'admin');
    const a = appOr404(+req.params.id);
    deleteFilesOf(store, 'application', a.id);
    store.remove('applications', a.id);
    log(req, 'application.delete', `Deleted application ${a.ref} (${a.firstName} ${a.lastName})`, out(a));
  }));
  return r;
}
