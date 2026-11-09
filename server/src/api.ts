import { Router, type Request } from 'express';
import { readFileSync } from 'node:fs';
import { SAMPLE_FILE, TABLES, type Row, type Store, type TableName } from './db.ts';
import {
  appToday, band, dayNum, fullName, holidayOn, isActive, isoOf, isSchoolDay, recalc, termInfo, termMarks, weekday,
  type Calc, type StudentStats,
} from './engine.ts';
import type { Settings } from './types.ts';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
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

export function buildApi(store: Store) {
  const api = Router();
  const h = (fn: (req: Request) => unknown) => (req: Request, res: any, next: any) => {
    try { res.json(fn(req) ?? { ok: true }); } catch (e) { next(e); }
  };
  const S = () => store.settings();
  const C = (term?: string) => recalc(store, term);
  const classNames = () => store.all('classes', 'ORDER BY name').map((c) => c.name as string);
  const studentOr404 = (id: number) => store.get('students', id) ?? (() => { throw notFound('Learner'); })();

  // ------------------------------------------------------------ meta / settings
  api.get('/meta', h(() => {
    const s = S(), c = C();
    return {
      settings: s, today: c.today, term: c.term, termStart: c.termStart, termEnd: c.termEnd, feesDue: c.feesDue,
      schoolDay: c.schoolDay, holiday: c.holiday, kpis: c.kpis, classes: classNames(),
      teachers: store.all('teachers', 'ORDER BY name').map((t) => t.name),
    };
  }));

  api.put('/settings', h((req) => {
    const next = { ...S(), ...req.body } as Settings;
    if (!str(next.schoolName)) throw bad('School name is required');
    if (!next.terms?.some((t) => t.name === next.currentTerm)) throw bad('Current term must be one of the terms on the calendar');
    for (const t of next.terms) if (!isIso(t.start) || !isIso(t.end) || t.end < t.start) throw bad(`${t.name || 'A term'}: check its start and end dates`);
    next.gradeBands = [...(next.gradeBands ?? [])].sort((a, b) => b.from - a.from);
    store.saveSettings(next);
    return next;
  }));

  api.get('/export', (_req, res) => {
    const out: any = { settings: S() };
    for (const t of Object.keys(TABLES) as TableName[]) out[t] = store.all(t, 'ORDER BY id');
    res.setHeader('Content-Disposition', `attachment; filename="school-backup-${appToday(S())}.json"`);
    res.json(out);
  });
  api.post('/import', h((req) => {
    if (!req.body?.settings || !Array.isArray(req.body?.students)) throw bad('Not a school backup file');
    store.load(req.body);
  }));
  api.post('/admin/clear-data', h(() => store.clearData()));
  api.post('/admin/load-sample', h(() => store.load(JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')))));

  // ------------------------------------------------------------ students
  api.get('/students', h(() => {
    const c = C();
    return store.all('students', 'ORDER BY className, firstName, lastName').map((st) => ({ ...st, stats: c.byId.get(st.id) }));
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
    return {
      student: st, stats: x, subjects,
      weeks: [...wk.entries()].map(([w, v]) => ({ label: `W${w}`, pct: Math.round((v.p / v.n) * 1000) / 10 })),
      lastDays: regs.slice(-10).map((r) => ({ date: r.date, mark: markOn.get(r.date)?.mark ?? 'P', note: markOn.get(r.date)?.note ?? '' })),
      absences: att.filter((a) => dayNum(a.date) >= term.start),
      payments: store.all('payments', 'WHERE studentId = ? ORDER BY date DESC, id DESC', st.id),
      plans: store.all('paymentPlans', 'WHERE studentId = ? ORDER BY agreedOn DESC', st.id),
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
    const b = { status: 'Active', enrolmentDate: appToday(S()), ...req.body };
    if (!str(b.learnerNo)) {
      const n = store.all('students', 'WHERE className = ?', b.className).length + 1;
      b.learnerNo = `S-${b.className}-${String(n).padStart(2, '0')}`;
      while (store.all('students', 'WHERE learnerNo = ?', b.learnerNo).length) b.learnerNo += '+';
    }
    validateStudent(b);
    delete b.id;
    return store.insert('students', b);
  }));
  api.put('/students/:id', h((req) => {
    const cur = studentOr404(+req.params.id);
    const b = { ...cur, ...req.body };
    validateStudent(b, cur.id);
    return store.update('students', cur.id, b);
  }));
  api.delete('/students/:id', h((req) => {
    const id = +req.params.id;
    studentOr404(id);
    store.tx(() => {
      for (const [t, col] of [['attendance', 'learnerId'], ['marks', 'learnerId'], ['comments', 'learnerId'], ['payments', 'studentId'], ['paymentPlans', 'studentId']])
        store.db.prepare(`DELETE FROM ${t} WHERE ${col} = ?`).run(id);
      store.db.prepare('DELETE FROM students WHERE id = ?').run(id);
    });
  }));

  // ------------------------------------------------------------ classes
  api.get('/classes', h(() => {
    const c = C();
    return store.all('classes', 'ORDER BY name').map((r) => ({ ...r, stats: c.classes.find((x) => x.id === r.id) }));
  }));
  const validateClass = (b: any, id?: number) => {
    if (!str(b.name)) throw bad('Class name is required');
    if (store.all('classes', 'WHERE name = ? AND id != ?', str(b.name), id ?? -1).length) throw bad(`There is already a class ${b.name}`);
  };
  api.post('/classes', h((req) => { validateClass(req.body); const b = { ...req.body }; delete b.id; return store.insert('classes', b); }));
  api.put('/classes/:id', h((req) => {
    const cur = store.get('classes', +req.params.id);
    if (!cur) throw notFound('Class');
    const b = { ...cur, ...req.body };
    validateClass(b, cur.id);
    return store.tx(() => {
      if (b.name !== cur.name) // a renamed class keeps its learners, registers and assessments
        for (const t of ['students', 'registers', 'attendance', 'assessments']) store.db.prepare(`UPDATE ${t} SET className = ? WHERE className = ?`).run(b.name, cur.name);
      store.db.prepare(`UPDATE classes SET ${TABLES.classes.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...TABLES.classes.map((k) => b[k] ?? null), cur.id);
      return store.get('classes', cur.id);
    });
  }));
  api.delete('/classes/:id', h((req) => {
    const cur = store.get('classes', +req.params.id);
    if (!cur) throw notFound('Class');
    const n = store.all('students', 'WHERE className = ?', cur.name).length;
    if (n) throw bad(`${cur.name} still has ${n} learner${n === 1 ? '' : 's'}: move them to another class first`);
    store.remove('classes', cur.id);
  }));

  // ------------------------------------------------------------ teachers
  api.get('/teachers', h(() => {
    const cls = store.all('classes');
    return store.all('teachers', 'ORDER BY name').map((t) => ({ ...t, classes: cls.filter((c) => c.teacher === t.name).map((c) => c.name) }));
  }));
  api.post('/teachers', h((req) => { if (!str(req.body.name)) throw bad('Teacher name is required'); const b = { ...req.body }; delete b.id; return store.insert('teachers', b); }));
  api.put('/teachers/:id', h((req) => {
    const cur = store.get('teachers', +req.params.id);
    if (!cur) throw notFound('Teacher');
    const b = { ...cur, ...req.body };
    if (!str(b.name)) throw bad('Teacher name is required');
    return store.tx(() => {
      if (b.name !== cur.name) store.db.prepare('UPDATE classes SET teacher = ? WHERE teacher = ?').run(b.name, cur.name);
      store.db.prepare(`UPDATE teachers SET ${TABLES.teachers.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...TABLES.teachers.map((k) => b[k] ?? null), cur.id);
      return store.get('teachers', cur.id);
    });
  }));
  api.delete('/teachers/:id', h((req) => { if (!store.remove('teachers', +req.params.id)) throw notFound('Teacher'); }));

  // ------------------------------------------------------------ today
  api.get('/today', h(() => {
    const s = S(), c = C();
    const detail = (x: StudentStats) => {
      const st = store.get('students', x.id)!;
      return { ...x, guardianName: st.guardianName, guardianPhone: st.guardianPhone, guardianEmail: st.guardianEmail };
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
      today: c.today, term: c.term, schoolDay: c.schoolDay, holiday: c.holiday, kpis: c.kpis, weeks: c.weeks,
      classes: c.classes, risk: c.riskIds.map((id) => detail(c.byId.get(id)!)), watch: c.watchIds.map((id) => detail(c.byId.get(id)!)),
      upcoming, flagMax: c.flagMax,
      receipts: store.all('payments', 'WHERE date = ? ORDER BY id DESC', c.today).map((p) => ({ ...p, name: c.byId.get(p.studentId)?.name })),
    };
  }));

  // ------------------------------------------------------------ registers / attendance
  api.get('/register', h((req) => {
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
    };
  }));

  api.post('/register', h((req) => {
    const { className, date, marks } = req.body ?? {};
    if (!classNames().includes(className)) throw bad('Unknown class');
    if (!isIso(date)) throw bad('Pick a date');
    if (date > C().today) throw bad('A register cannot be taken for a future date');
    if (!Array.isArray(marks)) throw bad('No marks sent');
    const valid = new Set(store.all('students', 'WHERE className = ?', className).filter(isActive).map((st) => st.id));
    const teacher = str(req.body.takenBy) || store.all('classes', 'WHERE name = ?', className)[0]?.teacher || '';
    let present = 0, enrolled = 0;
    store.tx(() => {
      store.db.prepare('DELETE FROM attendance WHERE className = ? AND date = ?').run(className, date);
      const ins = store.db.prepare('INSERT INTO attendance (learnerId, date, className, mark, note) VALUES (?, ?, ?, ?, ?)');
      for (const m of marks) {
        if (!valid.has(Number(m.learnerId))) continue;
        const mark = ['P', 'A', 'L', 'E'].includes(m.mark) ? m.mark : 'P';
        enrolled++;
        if (mark !== 'A' && mark !== 'E') present++;
        if (mark !== 'P') ins.run(Number(m.learnerId), date, className, mark, str(m.note) || null);
      }
      const ex = store.db.prepare('SELECT id FROM registers WHERE className = ? AND date = ?').get(className, date) as Row | undefined;
      if (ex) store.db.prepare('UPDATE registers SET takenBy = ?, present = ?, enrolled = ? WHERE id = ?').run(teacher, present, enrolled, ex.id);
      else store.db.prepare('INSERT INTO registers (date, className, takenBy, present, enrolled) VALUES (?, ?, ?, ?, ?)').run(date, className, teacher, present, enrolled);
    });
    return { present, enrolled };
  }));

  api.delete('/register', h((req) => {
    const className = str(req.query.class), date = str(req.query.date);
    store.tx(() => {
      store.db.prepare('DELETE FROM attendance WHERE className = ? AND date = ?').run(className, date);
      store.db.prepare('DELETE FROM registers WHERE className = ? AND date = ?').run(className, date);
    });
  }));

  // ------------------------------------------------------------ gradebook
  api.get('/gradebook', h((req) => {
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
      className, term, subjects: s.subjects, classAvg,
      assessmentCounts: Object.fromEntries(counts.map((r) => [r.subject, r.n])),
      learners: learners.map((x) => ({ id: x.id, name: x.name, marks: x.marks, avg: x.avg, chg: x.chg, pos: x.pos, att: x.att, flags: x.flags })),
    };
  }));

  api.get('/assessments', h((req) => {
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
    return { className, term, subject, assessments, learners };
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
  api.post('/assessments', h((req) => { const b = { outOf: 100, ...req.body }; delete b.id; validateAssessment(b); return store.insert('assessments', b); }));
  api.post('/assessments/defaults', h((req) => {
    const s = S();
    const { className, term } = req.body ?? {};
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
    return { added };
  }));
  api.put('/assessments/:id', h((req) => {
    const cur = store.get('assessments', +req.params.id);
    if (!cur) throw notFound('Assessment');
    const b = { ...cur, ...req.body };
    validateAssessment(b);
    return store.update('assessments', cur.id, b);
  }));
  api.delete('/assessments/:id', h((req) => {
    const id = +req.params.id;
    store.tx(() => {
      store.db.prepare('DELETE FROM marks WHERE assessmentId = ?').run(id);
      store.db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
    });
  }));

  api.put('/marks', h((req) => {
    const list = req.body?.marks;
    if (!Array.isArray(list)) throw bad('No marks sent');
    const outOf = new Map(store.all('assessments').map((a) => [a.id, a.outOf > 0 ? a.outOf : 100]));
    for (const m of list) {
      if (!outOf.has(Number(m.assessmentId))) throw bad('Unknown assessment');
      if (m.mark !== null && m.mark !== '' && m.mark !== undefined) {
        const v = Number(m.mark);
        if (!Number.isFinite(v) || v < 0 || v > outOf.get(Number(m.assessmentId))!) throw bad(`Mark ${m.mark} is not between 0 and ${outOf.get(Number(m.assessmentId))}`);
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
    return { saved: list.length };
  }));

  // ------------------------------------------------------------ report cards
  const reportCard = (st: Row, term: string, c: Calc) => {
    const s = S();
    const x = c.byId.get(st.id)!;
    const mates = c.students.filter((y) => y.active && y.className === st.className);
    const prev = termInfo(s, term).prev;
    const prevMarks = prev ? termMarks(store, s, prev).get(st.id) ?? {} : {};
    const cm = store.all('comments', 'WHERE learnerId = ? AND term = ?', st.id, term)[0];
    const cls = store.all('classes', 'WHERE name = ?', st.className)[0];
    const terms = s.terms ?? [];
    const nextTerm = terms[terms.findIndex((t) => t.name === term) + 1];
    return {
      student: { id: st.id, name: fullName(st), firstName: st.firstName, learnerNo: st.learnerNo, className: st.className, guardianName: st.guardianName, guardianEmail: st.guardianEmail },
      classLabel: cls ? (cls.grade ? `${cls.grade}${cls.stream ?? ''}` : cls.name) : st.className,
      classTeacher: cls?.teacher ?? '', term,
      subjects: s.subjects.map((subj) => {
        const v = mates.map((y) => y.marks[subj]).filter((m) => m !== undefined);
        const mark = x.marks[subj] ?? null;
        return {
          subject: subj, mark, band: mark !== null ? band(s, mark)?.band ?? '' : '', meaning: mark !== null ? band(s, mark)?.meaning ?? '' : '',
          classAvg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null, prev: prevMarks[subj] ?? null,
        };
      }),
      avg: x.avg, band: x.avg !== null ? band(s, x.avg)?.band ?? '' : '', chg: x.chg, pos: x.pos,
      classSize: mates.filter((y) => y.avg !== null).length,
      attendance: { present: x.present, taken: x.taken, absent: x.absent, late: x.late, att: x.att },
      teacherComment: cm?.teacherComment ?? '', principalComment: cm?.principalComment ?? '',
      nextTermStarts: nextTerm?.start ?? null,
    };
  };
  api.get('/report-cards', h((req) => {
    const s = S();
    const term = str(req.query.term) || s.currentTerm;
    const c = C(term === s.currentTerm ? undefined : term);
    const ids = req.query.learner
      ? [studentOr404(+req.query.learner!)]
      : store.all('students', 'WHERE className = ? ORDER BY firstName, lastName', str(req.query.class)).filter(isActive);
    return { school: { name: s.schoolName, address: s.schoolAddress, contact: s.schoolContact, principal: s.principal }, gradeBands: s.gradeBands, cards: ids.map((st) => reportCard(st, term, c)) };
  }));
  api.put('/comments', h((req) => {
    const { learnerId, term } = req.body ?? {};
    studentOr404(+learnerId);
    const ex = store.all('comments', 'WHERE learnerId = ? AND term = ?', +learnerId, term)[0];
    const patch: any = {};
    if ('teacherComment' in req.body) patch.teacherComment = req.body.teacherComment;
    if ('principalComment' in req.body) patch.principalComment = req.body.principalComment;
    return ex ? store.update('comments', ex.id, patch) : store.insert('comments', { learnerId: +learnerId, term, ...patch });
  }));

  // ------------------------------------------------------------ fees, payments, plans
  api.get('/fees', h((req) => {
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
    const s = S();
    const b = { date: appToday(s), term: s.currentTerm, receiptNo: nextReceipt(), ...req.body };
    delete b.id;
    validatePayment(b);
    if (store.all('payments', 'WHERE receiptNo = ?', b.receiptNo).length) throw bad(`Receipt ${b.receiptNo} already exists`);
    return store.insert('payments', b);
  }));
  api.put('/payments/:id', h((req) => {
    const cur = store.get('payments', +req.params.id);
    if (!cur) throw notFound('Payment');
    const b = { ...cur, ...req.body };
    validatePayment(b);
    return store.update('payments', cur.id, b);
  }));
  api.delete('/payments/:id', h((req) => { if (!store.remove('payments', +req.params.id)) throw notFound('Payment'); }));

  const validatePlan = (b: any) => {
    if (!b.studentId) throw bad('Pick a learner');
    studentOr404(+b.studentId);
    if (!S().terms.some((t) => t.name === b.term)) throw bad('Pick a term');
    if (!(num(b.instalment) > 0)) throw bad('Instalment must be more than 0');
    if (!isIso(b.nextDue)) throw bad('Next due date is required');
  };
  api.post('/paymentPlans', h((req) => {
    const s = S();
    const b = { term: s.currentTerm, agreedOn: appToday(s), ...req.body };
    delete b.id;
    validatePlan(b);
    return store.insert('paymentPlans', b);
  }));
  api.put('/paymentPlans/:id', h((req) => {
    const cur = store.get('paymentPlans', +req.params.id);
    if (!cur) throw notFound('Payment plan');
    const b = { ...cur, ...req.body };
    validatePlan(b);
    return store.update('paymentPlans', cur.id, b);
  }));
  api.delete('/paymentPlans/:id', h((req) => { if (!store.remove('paymentPlans', +req.params.id)) throw notFound('Payment plan'); }));

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
      term, today: c.today, kpis: c.kpis, weeks: c.weeks, days, heat, spread, classes: c.classes, useFees: s.useFees,
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
    const due = c.feesDue;
    return (learnerIds as number[] ?? []).map((id) => {
      const st = store.get('students', +id);
      const x = c.byId.get(+id);
      if (!st || !x) return null;
      const details = [
        `· Attendance this term: ${pct(x.att)} (${x.absent} day${x.absent === 1 ? '' : 's'} absent, ${x.late} late)`,
        `· Term average: ${x.avg === null ? '–' : Math.round(x.avg)}${x.chg !== null ? ` (${x.chg >= 0 ? '+' : ''}${Math.round(x.chg)} vs last term)` : ''}`,
        ...(s.useFees ? [`· Fees: ${x.balance > 0.005 ? `${money(s, x.balance)} still to pay` : 'paid'}${x.overdue > 0 ? ' (overdue)' : ''}`] : []),
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
