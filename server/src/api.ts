import { Router, type Request } from 'express';
import { readFileSync } from 'node:fs';
import { loadSample, SAMPLE_FILE, TABLES, type Row, type Store, type TableName } from './db.ts';
import {
  appToday, band, dayNum, fullName, holidayOn, isActive, isoOf, isSchoolDay, recalc, termInfo, termMarks, weekday,
  type Calc, type StudentStats,
} from './engine.ts';
import type { Settings } from './types.ts';
import { buildReportCard } from './reports.ts';
import { gpaOf } from './analytics.ts';
import { deleteFilesOf } from './files.ts';
import { activityCsv, activityUsers, CATEGORIES, describeDiff, diff, logActivity, queryActivity, type Category, type Entry } from './activity.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const bad = (msg: string) => new HttpError(400, msg);
const notFound = (what: string) => new HttpError(404, `${what} not found`);

const num = (v: unknown) => (v === undefined || v === null || v === '' ? NaN : Number(v));
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

export function money(s: Settings, x: number) {
  const d = s.currencyDecimals ?? 0;
  return `${s.currencySymbol ?? ''}${x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

/** Next / previous school day (weekends and holidays skipped) */
function stepSchoolDay(s: Settings, iso: string, dir: 1 | -1) {
  let d = dayNum(iso);
  for (let i = 0; i < 60; i++) {
    d += dir;
    if (weekday(d) <= 5 && !holidayOn(s, isoOf(d))) return isoOf(d);
  }
  return isoOf(d);
}

const SETTING_LABELS: Record<string, string> = {
  schoolName: 'school name', schoolAddress: 'address', schoolContact: 'contact', currencySymbol: 'currency symbol',
  currencyDecimals: 'currency decimals', useFees: 'use fees', lateCountsPresent: 'late counts as present',
  riskAttendance: 'at-risk attendance', riskDrop: 'at-risk drop', currentTerm: 'current term', sampleMode: 'sample mode',
  sampleAnchor: 'sample date', grades: 'grades & fees', assessmentTypes: 'default assessments', payMethods: 'payment methods',
  studentStatuses: 'learner statuses', gradeBands: 'grading scale', optionalFees: 'optional fees', keyDates: 'key dates',
  templates: 'e-mail templates', streams: 'streams',
};

const FEE_KPIS = ['billed', 'paid', 'balance', 'overdueAmount', 'receiptsTodayAmount'] as const;
const FEE_CLASS = ['billed', 'paid', 'balance', 'overdue', 'plans'] as const;
const FEE_STU = ['billed', 'paid', 'paidBefore', 'balance', 'overdue'] as const;

export function buildApi(store: Store) {
  const api = Router();
  // ---- roles (see auth.ts)
  const MSG = { admin: 'Only an admin can do that', teach: 'Only teachers and admins can do that', fees: 'Only the bursar and admins can see fees' };
  const need = (req: Request, what: 'admin' | 'teach' | 'fees') => { if (!req.perms?.[what]) throw new HttpError(403, MSG[what]); };
  const mayTeach = (req: Request, className: string) => !!req.perms?.teach && (!req.perms.classes || req.perms.classes.includes(className));
  const needClass = (req: Request, className: string) => {
    need(req, 'teach');
    const c = req.perms!.classes;
    if (c && !c.includes(className)) throw new HttpError(403, c.length ? `You can only work on ${c.length === 1 ? `your class (${c[0]})` : `your classes (${c.join(', ')})`}` : 'You are not class teacher of any class yet: ask an admin');
  };
  /** Teachers see learners and classes, but no fee figures. */
  const hideFees = (req: Request) => !req.perms?.fees;
  const kpisFor = (req: Request, k: Calc['kpis']) => hideFees(req) ? { ...k, ...Object.fromEntries(FEE_KPIS.map((f) => [f, null])) } : k;
  const classFor = (req: Request, c: any) => (c && hideFees(req) ? { ...c, ...Object.fromEntries(FEE_CLASS.map((f) => [f, null])) } : c);
  const stuFor = (req: Request, x: StudentStats | undefined) => (x && hideFees(req) ? { ...x, ...Object.fromEntries(FEE_STU.map((f) => [f, null])), feeStatus: '', hasPlan: false, planNext: null } : x);
  const h = (fn: (req: Request) => unknown) => (req: Request, res: any, next: any) => {
    try { res.json(fn(req) ?? { ok: true }); } catch (e) { next(e); }
  };
  const log = (req: Request, category: Category, action: string, summary: string, extra: Omit<Entry, 'category' | 'action' | 'summary'> = {}) =>
    logActivity(store, req, { category, action, summary, ...extra });
  const who = (id: number) => { const st = store.get('students', id); return st ? `${fullName(st)} (${st.className})` : `learner #${id}`; };
  const S = () => store.settings();
  const C = (term?: string) => recalc(store, term);
  const classNames = () => store.all('classes', 'ORDER BY name').map((c) => c.name as string);
  const studentOr404 = (id: number) => store.get('students', id) ?? (() => { throw notFound('Learner'); })();

  // ------------------------------------------------------------ meta / settings
  api.get('/meta', h((req) => {
    const s = S(), c = C();
    return {
      user: req.user, perms: req.perms,
      settings: s, today: c.today, term: c.term, termStart: c.termStart, termEnd: c.termEnd, feesDue: c.feesDue,
      schoolDay: c.schoolDay, holiday: c.holiday, kpis: kpisFor(req, c.kpis), classes: classNames(),
      teachers: store.all('teachers', 'ORDER BY name').map((t) => t.name),
    };
  }));

  api.put('/settings', h((req) => {
    need(req, 'admin');
    const next = { ...S(), ...req.body } as Settings;
    if (!str(next.schoolName)) throw bad('School name is required');
    if (!next.terms?.some((t) => t.name === next.currentTerm)) throw bad('Current term must be one of the terms on the calendar');
    for (const t of next.terms) if (!isIso(t.start) || !isIso(t.end) || t.end < t.start) throw bad(`${t.name || 'A term'}: check its start and end dates`);
    next.gradeBands = [...(next.gradeBands ?? [])].sort((a, b) => b.from - a.from);
    const before = S();
    const changed = diff(before, next, Object.keys({ ...before, ...next }));
    store.saveSettings(next);
    if (Object.keys(changed).length) log(req, 'settings', 'settings.update', `Changed settings: ${describeDiff(changed, SETTING_LABELS)}`, { details: changed });
    return next;
  }));

  api.get('/export', (req, res) => {
    if (!req.perms?.admin) return res.status(403).json({ error: MSG.admin });
    const out: any = { settings: S() };
    for (const t of Object.keys(TABLES) as TableName[]) out[t] = store.all(t, 'ORDER BY id');
    log(req, 'data', 'backup.download', 'Downloaded a backup of all school data');
    res.setHeader('Content-Disposition', `attachment; filename="school-backup-${appToday(S())}.json"`);
    res.json(out);
  });
  api.post('/import', h((req) => {
    need(req, 'admin');
    if (!req.body?.settings || !Array.isArray(req.body?.students)) throw bad('Not a school backup file');
    store.load(req.body);
    const counts = Object.fromEntries((Object.keys(TABLES) as TableName[]).map((t) => [t, (req.body[t] ?? []).length]));
    log(req, 'data', 'backup.restore', `Restored a backup: replaced all school data (${counts.students} learners, ${counts.payments} payments)`, { details: counts });
  }));
  api.post('/admin/clear-data', h((req) => {
    need(req, 'admin');
    const n = store.all('students').length;
    store.clearData();
    log(req, 'data', 'data.clear', `Cleared all school data (${n} learners and their registers, marks and payments); settings kept`);
  }));
  api.post('/admin/load-sample', h((req) => {
    need(req, 'admin');
    loadSample(store);
    log(req, 'data', 'data.sample', 'Replaced all school data with the sample school');
  }));

  // ------------------------------------------------------------ students
  api.get('/students', h((req) => {
    const c = C();
    return store.all('students', 'ORDER BY className, firstName, lastName').map((st) => ({ ...st, stats: stuFor(req, c.byId.get(st.id)) }));
  }));

  api.get('/students/:id', h((req) => {
    const st = studentOr404(+req.params.id);
    const s = S(), c = C();
    const x = c.byId.get(st.id)!;
    const classmates = c.students.filter((y) => y.active && y.className === st.className);
    const subjects = s.subjects.map((subj) => {
      const v = classmates.map((y) => y.marks[subj]).filter((m) => m !== undefined);
      return { subject: subj, mark: x.marks[subj] ?? null, classAvg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null };
    });
    const term = termInfo(s, s.currentTerm);
    const att = store.all('attendance', 'WHERE learnerId = ? ORDER BY date DESC', st.id);
    const regs = store.all('registers', 'WHERE className = ? AND date >= ? AND date <= ? ORDER BY date', st.className, isoOf(term.start), c.today);
    const markOn = new Map(att.map((a) => [a.date, a]));
    // attendance by week for this learner
    const tsMon = term.start - (weekday(term.start) - 1);
    const wk = new Map<number, { p: number; n: number }>();
    for (const r of regs) {
      const w = Math.floor((dayNum(r.date) - tsMon) / 7) + 1;
      const m = markOn.get(r.date)?.mark;
      const cell = wk.get(w) ?? { p: 0, n: 0 };
      cell.n++;
      if (!(m === 'A' || m === 'E' || (m === 'L' && !s.lateCountsPresent))) cell.p++;
      wk.set(w, cell);
    }
    const fees = !hideFees(req);
    return {
      student: st, stats: stuFor(req, x), subjects,
      weeks: [...wk.entries()].map(([w, v]) => ({ label: `W${w}`, pct: Math.round((v.p / v.n) * 1000) / 10 })),
      lastDays: regs.slice(-10).map((r) => ({ date: r.date, mark: markOn.get(r.date)?.mark ?? 'P', note: markOn.get(r.date)?.note ?? '' })),
      absences: att.filter((a) => dayNum(a.date) >= term.start),
      payments: fees ? store.all('payments', 'WHERE studentId = ? ORDER BY date DESC, id DESC', st.id) : [],
      plans: fees ? store.all('paymentPlans', 'WHERE studentId = ? ORDER BY agreedOn DESC', st.id) : [],
      comments: store.all('comments', 'WHERE learnerId = ? ORDER BY term', st.id),
    };
  }));

  const validateStudent = (b: any, id?: number) => {
    if (!str(b.firstName) || !str(b.lastName)) throw bad('First and last name are required');
    if (!str(b.className) || !classNames().includes(b.className)) throw bad('Pick a class');
    for (const f of ['dob', 'enrolmentDate']) if (b[f] && !isIso(b[f])) throw bad(`${f === 'dob' ? 'Date of birth' : 'Enrolment date'} is not a valid date`);
    if (b.guardianEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.guardianEmail)) throw bad('Guardian e-mail does not look right');
    if (str(b.learnerNo)) {
      const dup = store.all('students', 'WHERE learnerNo = ? AND id != ?', str(b.learnerNo), id ?? -1);
      if (dup.length) throw bad(`Learner No ${b.learnerNo} is already used by ${fullName(dup[0])}`);
    }
  };
  api.post('/students', h((req) => {
    need(req, 'admin');
    const b = { status: 'Active', enrolmentDate: appToday(S()), ...req.body };
    if (!str(b.learnerNo)) {
      const n = store.all('students', 'WHERE className = ?', b.className).length + 1;
      b.learnerNo = `S-${b.className}-${String(n).padStart(2, '0')}`;
      while (store.all('students', 'WHERE learnerNo = ?', b.learnerNo).length) b.learnerNo += '+';
    }
    validateStudent(b);
    delete b.id;
    const row = store.insert('students', b);
    log(req, 'students', 'student.create', `Added learner ${fullName(row)} (${row.className}, ${row.learnerNo})`, { learnerId: row.id });
    return row;
  }));
  api.put('/students/:id', h((req) => {
    need(req, 'admin');
    const cur = studentOr404(+req.params.id);
    const b = { ...cur, ...req.body };
    validateStudent(b, cur.id);
    const row = store.update('students', cur.id, b)!;
    const d = diff(cur, row, TABLES.students);
    if (Object.keys(d).length) log(req, 'students', 'student.update', `Edited learner ${fullName(row)}: ${describeDiff(d)}`, { learnerId: row.id, details: d });
    return row;
  }));
  api.delete('/students/:id', h((req) => {
    need(req, 'admin');
    const id = +req.params.id;
    const cur = studentOr404(id);
    const counts = Object.fromEntries([['attendance', 'learnerId'], ['marks', 'learnerId'], ['payments', 'studentId']].map(([t, col]) =>
      [t, (store.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`).get(id) as { n: number }).n]));
    const payments = store.all('payments', 'WHERE studentId = ?', id);
    store.tx(() => {
      for (const [t, col] of [['attendance', 'learnerId'], ['marks', 'learnerId'], ['comments', 'learnerId'], ['payments', 'studentId'], ['paymentPlans', 'studentId']])
        store.db.prepare(`DELETE FROM ${t} WHERE ${col} = ?`).run(id);
      store.db.prepare('DELETE FROM students WHERE id = ?').run(id);
      store.db.prepare('DELETE FROM userLearners WHERE learnerId = ?').run(id);
      store.db.prepare('DELETE FROM riders WHERE learnerId = ?').run(id);
    });
    deleteFilesOf(store, 'student', id);
    log(req, 'students', 'student.delete',
      `Deleted learner ${fullName(cur)} (${cur.className}) with ${counts.attendance} attendance marks, ${counts.marks} marks and ${counts.payments} payments`,
      { learnerId: id, details: { learner: cur, payments, counts } });
  }));

  // ------------------------------------------------------------ classes
  api.get('/classes', h((req) => {
    const c = C();
    return store.all('classes', 'ORDER BY name').map((r) => ({ ...r, stats: classFor(req, c.classes.find((x) => x.id === r.id)) }));
  }));
  const validateClass = (b: any, id?: number) => {
    if (!str(b.name)) throw bad('Class name is required');
    if (store.all('classes', 'WHERE name = ? AND id != ?', str(b.name), id ?? -1).length) throw bad(`There is already a class ${b.name}`);
  };
  api.post('/classes', h((req) => {
    need(req, 'admin'); validateClass(req.body); const b = { ...req.body }; delete b.id;
    const row = store.insert('classes', b);
    log(req, 'classes', 'class.create', `Added class ${row.name}${row.teacher ? ` (${row.teacher})` : ''}`);
    return row;
  }));
  api.put('/classes/:id', h((req) => {
    need(req, 'admin');
    const cur = store.get('classes', +req.params.id);
    if (!cur) throw notFound('Class');
    const b = { ...cur, ...req.body };
    validateClass(b, cur.id);
    return store.tx(() => {
      if (b.name !== cur.name) // a renamed class keeps its learners, registers and assessments
        for (const t of ['students', 'registers', 'attendance', 'assessments']) store.db.prepare(`UPDATE ${t} SET className = ? WHERE className = ?`).run(b.name, cur.name);
      store.db.prepare(`UPDATE classes SET ${TABLES.classes.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...TABLES.classes.map((k) => b[k] ?? null), cur.id);
      const row = store.get('classes', cur.id)!;
      const d = diff(cur, row, TABLES.classes);
      if (Object.keys(d).length) log(req, 'classes', 'class.update', `Edited class ${cur.name}: ${describeDiff(d)}`, { details: d });
      return row;
    });
  }));
  api.delete('/classes/:id', h((req) => {
    need(req, 'admin');
    const cur = store.get('classes', +req.params.id);
    if (!cur) throw notFound('Class');
    const n = store.all('students', 'WHERE className = ?', cur.name).length;
    if (n) throw bad(`${cur.name} still has ${n} learner${n === 1 ? '' : 's'}: move them to another class first`);
    store.remove('classes', cur.id);
    log(req, 'classes', 'class.delete', `Deleted class ${cur.name}`, { details: cur });
  }));

  // ------------------------------------------------------------ teachers
  api.get('/teachers', h(() => {
    const cls = store.all('classes');
    return store.all('teachers', 'ORDER BY name').map((t) => ({ ...t, classes: cls.filter((c) => c.teacher === t.name).map((c) => c.name) }));
  }));
  api.post('/teachers', h((req) => {
    need(req, 'admin'); if (!str(req.body.name)) throw bad('Teacher name is required'); const b = { ...req.body }; delete b.id;
    const row = store.insert('teachers', b);
    log(req, 'teachers', 'teacher.create', `Added teacher ${row.name}`);
    return row;
  }));
  api.put('/teachers/:id', h((req) => {
    need(req, 'admin');
    const cur = store.get('teachers', +req.params.id);
    if (!cur) throw notFound('Teacher');
    const b = { ...cur, ...req.body };
    if (!str(b.name)) throw bad('Teacher name is required');
    return store.tx(() => {
      if (b.name !== cur.name) {
        store.db.prepare('UPDATE classes SET teacher = ? WHERE teacher = ?').run(b.name, cur.name);
        store.db.prepare('UPDATE users SET teacherName = ? WHERE teacherName = ?').run(b.name, cur.name);
      }
      store.db.prepare(`UPDATE teachers SET ${TABLES.teachers.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...TABLES.teachers.map((k) => b[k] ?? null), cur.id);
      const row = store.get('teachers', cur.id)!;
      const d = diff(cur, row, TABLES.teachers);
      if (Object.keys(d).length) log(req, 'teachers', 'teacher.update', `Edited teacher ${cur.name}: ${describeDiff(d)}`, { details: d });
      return row;
    });
  }));
  api.delete('/teachers/:id', h((req) => {
    need(req, 'admin');
    const cur = store.get('teachers', +req.params.id);
    if (!cur || !store.remove('teachers', cur.id)) throw notFound('Teacher');
    log(req, 'teachers', 'teacher.delete', `Deleted teacher ${cur.name}`, { details: cur });
  }));

  // ------------------------------------------------------------ today
  api.get('/today', h((req) => {
    const s = S(), c = C();
    const detail = (x: StudentStats) => {
      const st = store.get('students', x.id)!;
      return { ...stuFor(req, x)!, guardianName: st.guardianName, guardianPhone: st.guardianPhone, guardianEmail: st.guardianEmail };
    };
    const t = dayNum(c.today);
    const upcoming = [
      ...(s.keyDates ?? []).map((k) => ({ date: k.date, label: k.label.replace('{overdue}', String(c.kpis.overdueCount)), kind: 'key' })),
      ...(s.holidays ?? []).map((k) => ({ date: k.date, label: `${k.name}${k.type ? ` · ${k.type.toLowerCase()}` : ''}`, kind: 'holiday' })),
      ...(s.terms ?? []).flatMap((tm) => [
        { date: tm.start, label: `${tm.name} starts`, kind: 'term' },
        ...(tm.feesDue ? [{ date: tm.feesDue, label: `${tm.name} fees due`, kind: 'fees' }] : []),
      ]),
    ].filter((e) => e.date && dayNum(e.date) >= t && dayNum(e.date) <= t + 45)
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter((e, i, arr) => arr.findIndex((y) => y.date === e.date && y.label === e.label) === i);
    return {
      today: c.today, term: c.term, schoolDay: c.schoolDay, holiday: c.holiday, kpis: kpisFor(req, c.kpis), weeks: c.weeks,
      classes: c.classes.map((k) => classFor(req, k)), risk: c.riskIds.map((id) => detail(c.byId.get(id)!)), watch: c.watchIds.map((id) => detail(c.byId.get(id)!)),
      upcoming, flagMax: c.flagMax,
      receipts: hideFees(req) ? [] : store.all('payments', 'WHERE date = ? ORDER BY id DESC', c.today).map((p) => ({ ...p, name: c.byId.get(p.studentId)?.name })),
    };
  }));

  // ------------------------------------------------------------ registers / attendance
  api.get('/register', h((req) => {
    need(req, 'teach');
    const s = S(), c = C();
    const className = str(req.query.class) || classNames()[0];
    const date = isIso(req.query.date) ? (req.query.date as string) : c.today;
    if (!classNames().includes(className)) throw notFound('Class');
    const reg = store.all('registers', 'WHERE className = ? AND date = ?', className, date)[0];
    const marks = new Map(store.all('attendance', 'WHERE className = ? AND date = ?', className, date).map((a) => [a.learnerId, a]));
    const prevRegs = store.all('registers', 'WHERE className = ? AND date < ? ORDER BY date DESC LIMIT 5', className, date).reverse();
    const prevMarks = prevRegs.length
      ? store.all('attendance', `WHERE className = ? AND date IN (${prevRegs.map(() => '?').join(',')})`, className, ...prevRegs.map((r) => r.date))
      : [];
    const learners = store.all('students', 'WHERE className = ? ORDER BY firstName, lastName', className).filter(isActive).map((st) => ({
      id: st.id, name: fullName(st), learnerNo: st.learnerNo,
      mark: (marks.get(st.id)?.mark as string) ?? 'P', note: (marks.get(st.id)?.note as string) ?? '',
      last5: prevRegs.map((r) => ({ date: r.date, mark: prevMarks.find((m) => m.learnerId === st.id && m.date === r.date)?.mark ?? 'P' })),
      termAtt: c.byId.get(st.id)?.att ?? null,
      guardianEmail: st.guardianEmail, guardianName: st.guardianName,
    }));
    return {
      className, date, taken: !!reg, takenBy: reg?.takenBy ?? '', holiday: holidayOn(s, date),
      weekend: weekday(dayNum(date)) > 5, schoolDay: isSchoolDay(s, date), learners,
      prevDay: stepSchoolDay(s, date, -1), nextDay: stepSchoolDay(s, date, 1), today: c.today,
      teacher: store.all('classes', 'WHERE name = ?', className)[0]?.teacher ?? '',
      canEdit: mayTeach(req, className),
    };
  }));

  api.post('/register', h((req) => {
    const { className, date, marks } = req.body ?? {};
    if (!classNames().includes(className)) throw bad('Unknown class');
    needClass(req, className);
    if (!isIso(date)) throw bad('Pick a date');
    if (date > C().today) throw bad('A register cannot be taken for a future date');
    if (!Array.isArray(marks)) throw bad('No marks sent');
    const valid = new Set(store.all('students', 'WHERE className = ?', className).filter(isActive).map((st) => st.id));
    const teacher = req.user!.name;
    let present = 0, enrolled = 0;
    const existed = !!store.db.prepare('SELECT 1 FROM registers WHERE className = ? AND date = ?').get(className, date);
    const before = new Map(store.all('attendance', 'WHERE className = ? AND date = ?', className, date).map((a) => [a.learnerId as number, a.mark as string]));
    const changes: { learner: string; from: string; to: string }[] = [];
    store.tx(() => {
      store.db.prepare('DELETE FROM attendance WHERE className = ? AND date = ?').run(className, date);
      const ins = store.db.prepare('INSERT INTO attendance (learnerId, date, className, mark, note) VALUES (?, ?, ?, ?, ?)');
      for (const m of marks) {
        if (!valid.has(Number(m.learnerId))) continue;
        const mark = ['P', 'A', 'L', 'E'].includes(m.mark) ? m.mark : 'P';
        enrolled++;
        if (mark !== 'A' && mark !== 'E') present++;
        const was = before.get(Number(m.learnerId)) ?? 'P';
        if (existed ? was !== mark : mark !== 'P') changes.push({ learner: who(Number(m.learnerId)).replace(/ \(.*\)$/, ''), from: existed ? was : '', to: mark });
        if (mark !== 'P') ins.run(Number(m.learnerId), date, className, mark, str(m.note) || null);
      }
      const ex = store.db.prepare('SELECT id FROM registers WHERE className = ? AND date = ?').get(className, date) as Row | undefined;
      if (ex) store.db.prepare('UPDATE registers SET takenBy = ?, present = ?, enrolled = ? WHERE id = ?').run(teacher, present, enrolled, ex.id);
      else store.db.prepare('INSERT INTO registers (date, className, takenBy, present, enrolled) VALUES (?, ?, ?, ?, ?)').run(date, className, teacher, present, enrolled);
    });
    if (!existed) {
      log(req, 'attendance', 'register.take', `Took the register for ${className} on ${date}: ${present} of ${enrolled} present${changes.length ? ` (${changes.map((c) => `${c.learner} ${c.to}`).join(', ')})` : ''}`, { details: { className, date, present, enrolled, marks: changes } });
    } else if (changes.length) {
      log(req, 'attendance', 'register.change', `Changed the register for ${className} on ${date}: ${changes.map((c) => `${c.learner} ${c.from} → ${c.to}`).join(', ')}`, { details: { className, date, present, enrolled, changes } });
    }
    return { present, enrolled };
  }));

  api.delete('/register', h((req) => {
    const className = str(req.query.class), date = str(req.query.date);
    needClass(req, className);
    const marks = store.all('attendance', 'WHERE className = ? AND date = ?', className, date);
    const reg = store.all('registers', 'WHERE className = ? AND date = ?', className, date)[0];
    store.tx(() => {
      store.db.prepare('DELETE FROM attendance WHERE className = ? AND date = ?').run(className, date);
      store.db.prepare('DELETE FROM registers WHERE className = ? AND date = ?').run(className, date);
    });
    if (reg) log(req, 'attendance', 'register.delete', `Deleted the register for ${className} on ${date}`, { details: { register: reg, marks } });
  }));

  // ------------------------------------------------------------ gradebook
  api.get('/gradebook', h((req) => {
    need(req, 'teach');
    const s = S();
    const className = str(req.query.class) || classNames()[0];
    const term = str(req.query.term) || s.currentTerm;
    const c = C(term === s.currentTerm ? undefined : term);
    const learners = c.students.filter((x) => x.active && x.className === className);
    const classAvg: Record<string, number | null> = {};
    for (const subj of s.subjects) {
      const v = learners.map((x) => x.marks[subj]).filter((m) => m !== undefined);
      classAvg[subj] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    }
    const counts = store.db.prepare('SELECT subject, COUNT(*) AS n FROM assessments WHERE className = ? AND term = ? GROUP BY subject').all(className, term) as { subject: string; n: number }[];
    return {
      className, term, subjects: s.subjects, classAvg, canEdit: mayTeach(req, className),
      assessmentCounts: Object.fromEntries(counts.map((r) => [r.subject, r.n])),
      learners: learners.map((x) => ({ id: x.id, name: x.name, marks: x.marks, avg: x.avg, chg: x.chg, pos: x.pos, att: x.att, flags: x.flags, gpa: gpaOf(S(), x.marks) })),
    };
  }));

  api.get('/assessments', h((req) => {
    need(req, 'teach');
    const s = S();
    const className = str(req.query.class), term = str(req.query.term) || s.currentTerm, subject = str(req.query.subject);
    const assessments = store.all('assessments', 'WHERE className = ? AND term = ? AND subject = ? ORDER BY date, id', className, term, subject);
    const ids = assessments.map((a) => a.id);
    const marks = ids.length ? store.all('marks', `WHERE assessmentId IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
    const tm = termMarks(store, s, term);
    const learners = store.all('students', 'WHERE className = ? ORDER BY firstName, lastName', className).filter(isActive).map((st) => ({
      id: st.id, name: fullName(st),
      marks: Object.fromEntries(marks.filter((m) => m.learnerId === st.id).map((m) => [m.assessmentId, m.mark])),
      termMark: tm.get(st.id)?.[subject] ?? null,
    }));
    return { className, term, subject, assessments, learners, canEdit: mayTeach(req, className) };
  }));

  const validateAssessment = (b: any) => {
    const s = S();
    if (!classNames().includes(b.className)) throw bad('Unknown class');
    if (!s.terms.some((t) => t.name === b.term)) throw bad('Unknown term');
    if (!s.subjects.includes(b.subject)) throw bad('Unknown subject');
    if (!str(b.name)) throw bad('Name the assessment');
    if (!(num(b.weight) >= 0)) throw bad('Weight must be 0 or more');
    if (!(num(b.outOf) > 0)) throw bad('"Out of" must be more than 0');
    if (b.date && !isIso(b.date)) throw bad('Assessment date is not a valid date');
  };
  api.post('/assessments', h((req) => {
    const b = { outOf: 100, ...req.body }; delete b.id; validateAssessment(b); needClass(req, b.className);
    const row = store.insert('assessments', b);
    log(req, 'grades', 'assessment.create', `Added ${row.subject} assessment "${row.name}" for ${row.className} (${row.term}, ${row.weight}%, out of ${row.outOf})`);
    return row;
  }));
  api.post('/assessments/defaults', h((req) => {
    const s = S();
    const { className, term } = req.body ?? {};
    needClass(req, className);
    const subjects: string[] = req.body.subject ? [req.body.subject] : s.subjects;
    let added = 0;
    store.tx(() => {
      for (const subject of subjects) {
        const have = store.all('assessments', 'WHERE className = ? AND term = ? AND subject = ?', className, term, subject).map((a) => a.name);
        for (const t of s.assessmentTypes) {
          if (have.includes(t.name)) continue;
          validateAssessment({ className, term, subject, name: t.name, weight: t.weight, outOf: 100 });
          store.db.prepare('INSERT INTO assessments (term, className, subject, name, weight, outOf) VALUES (?, ?, ?, ?, ?, 100)').run(term, className, subject, t.name, t.weight);
          added++;
        }
      }
    });
    if (added) log(req, 'grades', 'assessment.defaults', `Added ${added} default assessment${added === 1 ? '' : 's'} for ${className} (${term}${req.body.subject ? `, ${req.body.subject}` : ', every subject'})`);
    return { added };
  }));
  api.put('/assessments/:id', h((req) => {
    const cur = store.get('assessments', +req.params.id);
    if (!cur) throw notFound('Assessment');
    const b = { ...cur, ...req.body };
    validateAssessment(b);
    needClass(req, cur.className);
    needClass(req, b.className);
    const row = store.update('assessments', cur.id, b)!;
    const d = diff(cur, row, TABLES.assessments);
    if (Object.keys(d).length) log(req, 'grades', 'assessment.update', `Edited ${cur.subject} assessment "${cur.name}" for ${cur.className}: ${describeDiff(d)}`, { details: d });
    return row;
  }));
  api.delete('/assessments/:id', h((req) => {
    const id = +req.params.id;
    const cur = store.get('assessments', id);
    if (!cur) throw notFound('Assessment');
    needClass(req, cur.className);
    const marks = store.all('marks', 'WHERE assessmentId = ?', id);
    store.tx(() => {
      store.db.prepare('DELETE FROM marks WHERE assessmentId = ?').run(id);
      store.db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
    });
    log(req, 'grades', 'assessment.delete', `Deleted ${cur.subject} assessment "${cur.name}" for ${cur.className} (${cur.term}) and its ${marks.length} marks`, { details: { assessment: cur, marks } });
  }));

  api.put('/marks', h((req) => {
    const list = req.body?.marks;
    if (!Array.isArray(list)) throw bad('No marks sent');
    const all = store.all('assessments');
    const outOf = new Map(all.map((a) => [a.id, a.outOf > 0 ? a.outOf : 100]));
    const classOf = new Map(all.map((a) => [a.id, a.className as string]));
    for (const m of list) {
      if (!outOf.has(Number(m.assessmentId))) throw bad('Unknown assessment');
      needClass(req, classOf.get(Number(m.assessmentId))!);
      if (m.mark !== null && m.mark !== '' && m.mark !== undefined) {
        const v = Number(m.mark);
        if (!Number.isFinite(v) || v < 0 || v > outOf.get(Number(m.assessmentId))!) throw bad(`Mark ${m.mark} is not between 0 and ${outOf.get(Number(m.assessmentId))}`);
      }
    }
    const assess = new Map(all.map((a) => [a.id as number, a]));
    const changes: { assessment: string; learner: string; from: number | null; to: number | null }[] = [];
    for (const m of list) {
      const old = store.db.prepare('SELECT mark FROM marks WHERE assessmentId = ? AND learnerId = ?').get(Number(m.assessmentId), Number(m.learnerId)) as { mark: number } | undefined;
      const to = m.mark === null || m.mark === '' || m.mark === undefined ? null : Number(m.mark);
      if ((old?.mark ?? null) !== to) {
        const a = assess.get(Number(m.assessmentId))!;
        changes.push({ assessment: `${a.className} ${a.subject} ${a.name}`, learner: who(Number(m.learnerId)).replace(/ \(.*\)$/, ''), from: old?.mark ?? null, to });
      }
    }
    store.tx(() => {
      const del = store.db.prepare('DELETE FROM marks WHERE assessmentId = ? AND learnerId = ?');
      const ins = store.db.prepare('INSERT INTO marks (assessmentId, learnerId, mark) VALUES (?, ?, ?)');
      for (const m of list) {
        del.run(Number(m.assessmentId), Number(m.learnerId));
        if (m.mark !== null && m.mark !== '' && m.mark !== undefined) ins.run(Number(m.assessmentId), Number(m.learnerId), Number(m.mark));
      }
    });
    if (changes.length) {
      const where = [...new Set(changes.map((c) => c.assessment.split(' ').slice(0, 2).join(' ')))];
      const changedOld = changes.filter((c) => c.from !== null);
      log(req, 'grades', 'marks.save', `Saved ${changes.length} mark${changes.length === 1 ? '' : 's'} in ${where.join(', ')}${changedOld.length ? ` (${changedOld.length} changed from an earlier mark${changedOld.length <= 3 ? `: ${changedOld.map((c) => `${c.learner} ${c.from} → ${c.to ?? 'blank'}`).join(', ')}` : ''})` : ''}`, { details: changes });
    }
    return { saved: list.length };
  }));

  // ------------------------------------------------------------ report cards
  const reportCard = (st: Row, term: string, c: Calc) => buildReportCard(store, st, term, c);
  api.get('/report-cards', h((req) => {
    need(req, 'teach');
    const s = S();
    const term = str(req.query.term) || s.currentTerm;
    const c = C(term === s.currentTerm ? undefined : term);
    const ids = req.query.learner
      ? [studentOr404(+req.query.learner!)]
      : store.all('students', 'WHERE className = ? ORDER BY firstName, lastName', str(req.query.class)).filter(isActive);
    return {
      school: { name: s.schoolName, address: s.schoolAddress, contact: s.schoolContact, principal: s.principal }, gradeBands: s.gradeBands,
      cards: ids.map((st) => ({ ...reportCard(st, term, c), canEditTeacher: mayTeach(req, st.className), canEditPrincipal: !!req.perms?.admin })),
    };
  }));
  api.put('/comments', h((req) => {
    const { learnerId, term } = req.body ?? {};
    const st = studentOr404(+learnerId);
    if ('teacherComment' in (req.body ?? {})) needClass(req, st.className);
    if ('principalComment' in (req.body ?? {})) need(req, 'admin');
    const ex = store.all('comments', 'WHERE learnerId = ? AND term = ?', +learnerId, term)[0];
    const patch: any = {};
    if ('teacherComment' in req.body) patch.teacherComment = req.body.teacherComment;
    if ('principalComment' in req.body) patch.principalComment = req.body.principalComment;
    const row = ex ? store.update('comments', ex.id, patch)! : store.insert('comments', { learnerId: +learnerId, term, ...patch });
    const d = diff(ex ?? {}, row, Object.keys(patch));
    if (Object.keys(d).length) log(req, 'reports', 'comment.save', `${'principalComment' in d ? "Principal's" : "Teacher's"} comment for ${fullName(st)} (${term})`, { learnerId: st.id, details: d });
    return row;
  }));

  // ------------------------------------------------------------ fees, payments, plans
  api.get('/fees', h((req) => {
    need(req, 'fees');
    const s = S(), c = C();
    const className = str(req.query.class);
    const learners = c.students.filter((x) => x.active && (!className || x.className === className))
      .map((x) => ({ id: x.id, name: x.name, className: x.className, learnerNo: x.learnerNo, billed: x.billed, paid: x.paid, balance: x.balance, overdue: x.overdue, feeStatus: x.feeStatus, hasPlan: x.hasPlan, planNext: x.planNext }));
    const recent = store.all('payments', 'ORDER BY date DESC, id DESC LIMIT 25').map((p) => ({ ...p, name: c.byId.get(p.studentId)?.name, className: c.byId.get(p.studentId)?.className }));
    const plans = store.all('paymentPlans', 'WHERE term = ? ORDER BY nextDue', c.term).map((p) => ({ ...p, name: c.byId.get(p.studentId)?.name, balance: c.byId.get(p.studentId)?.balance ?? 0 }));
    return { useFees: s.useFees, term: c.term, feesDue: c.feesDue, today: c.today, kpis: c.kpis, classes: c.classes, learners, recent, plans, nextReceipt: nextReceipt() };
  }));

  const nextReceipt = () => {
    const pre = `R-${appToday(S()).slice(0, 4)}-`;
    let hi = 0;
    for (const p of store.all('payments', 'WHERE receiptNo LIKE ?', `${pre}%`)) hi = Math.max(hi, parseInt(p.receiptNo.slice(pre.length), 10) || 0);
    return pre + String(hi + 1).padStart(4, '0');
  };
  const validatePayment = (b: any) => {
    const s = S();
    if (!b.studentId) throw bad('Pick a learner');
    studentOr404(+b.studentId);
    if (!isIso(b.date)) throw bad('Payment date is required');
    if (!(num(b.amount) > 0)) throw bad('Amount must be more than 0');
    if (!s.terms.some((t) => t.name === b.term)) throw bad('Pick the term the payment is for');
    if (!str(b.receiptNo)) throw bad('Receipt No is required');
  };
  api.get('/payments/:id', h((req) => {
    need(req, 'fees');
    const s = S(), c = C();
    const p = store.get('payments', +req.params.id);
    if (!p) throw notFound('Payment');
    const st = store.get('students', p.studentId);
    const x = c.byId.get(p.studentId);
    const paidToDate = store.all('payments', 'WHERE studentId = ? AND term = ? AND (date < ? OR (date = ? AND id <= ?))', p.studentId, p.term, p.date, p.date, p.id)
      .reduce((a, r) => a + (r.amount ?? 0), 0);
    return {
      payment: p, student: st ? { name: fullName(st), learnerNo: st.learnerNo, className: st.className, guardianName: st.guardianName } : null,
      billed: x?.billed ?? 0, paidToDate, balanceAfter: (x?.billed ?? 0) - paidToDate,
      school: { name: s.schoolName, address: s.schoolAddress, contact: s.schoolContact },
    };
  }));
  api.post('/payments', h((req) => {
    need(req, 'fees');
    const s = S();
    const b = { date: appToday(s), term: s.currentTerm, receiptNo: nextReceipt(), ...req.body };
    delete b.id;
    validatePayment(b);
    if (store.all('payments', 'WHERE receiptNo = ?', b.receiptNo).length) throw bad(`Receipt ${b.receiptNo} already exists`);
    const row = store.insert('payments', b);
    log(req, 'fees', 'payment.create', `Recorded payment ${row.receiptNo}: ${money(s, row.amount)} for ${who(row.studentId)}, ${row.term}${row.method ? `, ${row.method}` : ''}`, { learnerId: row.studentId, details: row });
    return row;
  }));
  api.put('/payments/:id', h((req) => {
    need(req, 'fees');
    const cur = store.get('payments', +req.params.id);
    if (!cur) throw notFound('Payment');
    const b = { ...cur, ...req.body };
    validatePayment(b);
    if (b.receiptNo !== cur.receiptNo && store.all('payments', 'WHERE receiptNo = ? AND id != ?', b.receiptNo, cur.id).length) throw bad(`Receipt ${b.receiptNo} already exists`);
    const row = store.update('payments', cur.id, b)!;
    const d = diff(cur, row, TABLES.payments);
    if (Object.keys(d).length) log(req, 'fees', 'payment.update', `Edited payment ${cur.receiptNo} for ${who(row.studentId)}: ${describeDiff(d)}`, { learnerId: row.studentId, details: d });
    return row;
  }));
  api.delete('/payments/:id', h((req) => {
    need(req, 'fees');
    const cur = store.get('payments', +req.params.id);
    if (!cur || !store.remove('payments', cur.id)) throw notFound('Payment');
    log(req, 'fees', 'payment.delete', `Deleted payment ${cur.receiptNo}: ${money(S(), cur.amount)} for ${who(cur.studentId)}, dated ${cur.date}`, { learnerId: cur.studentId, details: cur });
  }));

  const validatePlan = (b: any) => {
    if (!b.studentId) throw bad('Pick a learner');
    studentOr404(+b.studentId);
    if (!S().terms.some((t) => t.name === b.term)) throw bad('Pick a term');
    if (!(num(b.instalment) > 0)) throw bad('Instalment must be more than 0');
    if (!isIso(b.nextDue)) throw bad('Next due date is required');
  };
  api.post('/paymentPlans', h((req) => {
    need(req, 'fees');
    const s = S();
    const b = { term: s.currentTerm, agreedOn: appToday(s), ...req.body };
    delete b.id;
    validatePlan(b);
    const row = store.insert('paymentPlans', b);
    log(req, 'fees', 'plan.create', `Agreed a payment plan for ${who(row.studentId)}: ${money(s, row.instalment)}, next due ${row.nextDue}`, { learnerId: row.studentId, details: row });
    return row;
  }));
  api.put('/paymentPlans/:id', h((req) => {
    need(req, 'fees');
    const cur = store.get('paymentPlans', +req.params.id);
    if (!cur) throw notFound('Payment plan');
    const b = { ...cur, ...req.body };
    validatePlan(b);
    const row = store.update('paymentPlans', cur.id, b)!;
    const d = diff(cur, row, TABLES.paymentPlans);
    if (Object.keys(d).length) log(req, 'fees', 'plan.update', `Edited the payment plan for ${who(row.studentId)}: ${describeDiff(d)}`, { learnerId: row.studentId, details: d });
    return row;
  }));
  api.delete('/paymentPlans/:id', h((req) => {
    need(req, 'fees');
    const cur = store.get('paymentPlans', +req.params.id);
    if (!cur || !store.remove('paymentPlans', cur.id)) throw notFound('Payment plan');
    log(req, 'fees', 'plan.delete', `Deleted the payment plan for ${who(cur.studentId)} (${money(S(), cur.instalment)}, next due ${cur.nextDue})`, { learnerId: cur.studentId, details: cur });
  }));

  // ------------------------------------------------------------ activity log (admin only, read only)
  api.get('/activity', h((req) => {
    need(req, 'admin');
    return { ...queryActivity(store, req.query as any), users: activityUsers(store), categories: CATEGORIES };
  }));
  api.get('/activity.csv', (req, res) => {
    if (!req.perms?.admin) return res.status(403).json({ error: MSG.admin });
    log(req, 'data', 'activity.download', 'Downloaded the activity log');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-log-${appToday(S())}.csv"`);
    res.send(activityCsv(store, req.query as any));
  });

  // ------------------------------------------------------------ dashboard
  api.get('/dashboard', h((req) => {
    const s = S();
    const term = str(req.query.term) || s.currentTerm;
    const c = C(term === s.currentTerm ? undefined : term);
    const T = termInfo(s, term);
    const days: string[] = [];
    if (T.start) for (let d = T.start; d <= Math.min(dayNum(c.today), T.end || Infinity); d++) if (isSchoolDay(s, isoOf(d), T)) days.push(isoOf(d));
    const regs = days.length ? store.all('registers', 'WHERE date >= ? AND date <= ?', days[0], days[days.length - 1]) : [];
    const heat = c.classes.filter((k) => k.n > 0).map((k) => ({
      className: k.name,
      cells: days.map((d) => { const r = regs.find((x) => x.className === k.name && x.date === d); return r && r.enrolled ? Math.round((r.present / r.enrolled) * 1000) / 10 : null; }),
    }));
    const active = c.students.filter((x) => x.active);
    const spread = (s.gradeBands ?? []).map((b) => ({ band: b.band, meaning: b.meaning, n: active.filter((x) => x.avg !== null && band(s, x.avg)?.band === b.band).length }));
    const movers = active.filter((x) => x.chg !== null).sort((a, b) => b.chg! - a.chg!);
    return {
      term, today: c.today, kpis: kpisFor(req, c.kpis), weeks: c.weeks, days, heat, spread, classes: c.classes.map((k) => classFor(req, k)),
      useFees: s.useFees && !hideFees(req),
      up: movers.slice(0, 5).map(({ id, name, className, avg, chg }) => ({ id, name, className, avg, chg })),
      down: movers.slice(-5).reverse().map(({ id, name, className, avg, chg }) => ({ id, name, className, avg, chg })),
      notTaken: c.classes.filter((k) => k.today === 'No').map((k) => k.name),
    };
  }));

  // ------------------------------------------------------------ calendar
  api.get('/calendar', h((req) => {
    const s = S();
    const month = /^\d{4}-\d{2}$/.test(str(req.query.month)) ? str(req.query.month) : appToday(s).slice(0, 7);
    const first = dayNum(`${month}-01`);
    const last = dayNum(isoOf(dayNum(`${month}-01`) + 32).slice(0, 7) + '-01') - 1;
    const regs = store.db.prepare('SELECT date, COUNT(*) AS n, SUM(present) AS p, SUM(enrolled) AS e FROM registers WHERE date >= ? AND date <= ? GROUP BY date').all(isoOf(first), isoOf(last)) as any[];
    const nClasses = store.all('classes').length;
    const days = [];
    for (let d = first; d <= last; d++) {
      const iso = isoOf(d);
      const term = s.terms.find((t) => iso >= t.start && iso <= t.end);
      const r = regs.find((x) => x.date === iso);
      days.push({
        date: iso, weekday: weekday(d), term: term?.name ?? '', holiday: holidayOn(s, iso),
        events: [
          ...s.keyDates.filter((k) => k.date === iso).map((k) => k.label),
          ...s.terms.flatMap((t) => [t.start === iso ? `${t.name} starts` : '', t.end === iso ? `${t.name} ends` : '', t.feesDue === iso ? `${t.name} fees due` : '']).filter(Boolean),
        ],
        registers: r?.n ?? 0, attendance: r?.e ? Math.round((r.p / r.e) * 1000) / 10 : null,
        schoolDay: !!term && weekday(d) <= 5 && !holidayOn(s, iso),
      });
    }
    return { month, today: appToday(s), nClasses, days };
  }));

  // ------------------------------------------------------------ messages (templates filled for each guardian)
  api.post('/messages', h((req) => {
    const s = S(), c = C();
    const { kind, learnerIds, date, term } = req.body ?? {};
    const tpl = s.templates?.[kind as keyof Settings['templates']];
    if (!tpl) throw bad('Unknown message type');
    if (kind === 'fees') need(req, 'fees');
    if (kind === 'absent' || kind === 'report') for (const id of (learnerIds as number[] ?? [])) needClass(req, store.get('students', +id)?.className ?? '');
    const due = c.feesDue;
    return (learnerIds as number[] ?? []).map((id) => {
      const st = store.get('students', +id);
      const x = c.byId.get(+id);
      if (!st || !x) return null;
      const details = [
        `· Attendance this term: ${pct(x.att)} (${x.absent} day${x.absent === 1 ? '' : 's'} absent, ${x.late} late)`,
        `· Term average: ${x.avg === null ? '–' : Math.round(x.avg)}${x.chg !== null ? ` (${x.chg >= 0 ? '+' : ''}${Math.round(x.chg)} vs last term)` : ''}`,
        ...(s.useFees && !hideFees(req) ? [`· Fees: ${x.balance > 0.005 ? `${money(s, x.balance)} still to pay` : 'paid'}${x.overdue > 0 ? ' (overdue)' : ''}`] : []),
      ].join('\n');
      const tags: Record<string, string> = {
        Guardian: st.guardianName || 'Parent / Guardian', First: st.firstName ?? '', Last: st.lastName ?? '', Class: st.className ?? '',
        Date: fmtDate(date || c.today), Term: term || c.term, Details: details, Balance: money(s, x.balance), Overdue: money(s, x.overdue || x.balance),
        Due: fmtDate(due), School: s.schoolName, Contact: s.schoolContact,
      };
      const fill = (t: string) => t.replace(/\{(\w+)\}/g, (m, k) => tags[k] ?? m);
      return { learnerId: st.id, name: fullName(st), to: st.guardianEmail ?? '', subject: fill(tpl.subject), body: fill(tpl.body) };
    }).filter(Boolean);
  }));

  return api;
}
