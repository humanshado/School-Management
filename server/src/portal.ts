/**
 * PORTAL: what parents and students see, only for the learners linked to their login.
 * Grades, report cards, attendance, homework and study materials, notices, fees (and receipts).
 * Staff-only data (risk flags, other learners, notes) is never sent.
 */
import { Router, type Request } from 'express';
import type { Row, Store } from './db.ts';
import { appToday, dayNum, fullName, isoOf, recalc, termInfo, weekday } from './engine.ts';
import { filesOf } from './files.ts';
import { forbidden, h, need, notFound, str } from './kit.ts';
import { familyNotices } from './learning.ts';
import { buildReportCard } from './reports.ts';
import { DAYS, periodsOf } from './schedule.ts';
import { loanInfo } from './resources.ts';

export function buildPortalApi(store: Store) {
  const r = Router();
  r.use((req, _res, next) => { try { need(req, 'portal'); next(); } catch (e) { next(e); } });

  /** The learner, if this login may see them. */
  const mine = (req: Request, id: number): Row => {
    if (!req.perms!.learners.includes(id)) throw forbidden('You can only see your own learners');
    return store.get('students', id) ?? (() => { throw notFound('Learner'); })();
  };
  const myLearners = (req: Request) => req.perms!.learners.map((id) => store.get('students', id)).filter(Boolean) as Row[];

  r.get('/me', h((req) => {
    const s = store.settings(), c = recalc(store);
    return {
      user: req.user, perms: req.perms, today: c.today, term: c.term, termStart: c.termStart, termEnd: c.termEnd,
      school: { name: s.schoolName, address: s.schoolAddress, contact: s.schoolContact, principal: s.principal },
      settings: { currencySymbol: s.currencySymbol, currencyDecimals: s.currencyDecimals, useFees: s.useFees, terms: s.terms.map((t) => t.name), gradeBands: s.gradeBands, subjects: s.subjects, lateCountsPresent: s.lateCountsPresent },
      learners: myLearners(req).map((st) => ({ id: st.id, name: fullName(st), firstName: st.firstName, className: st.className, learnerNo: st.learnerNo, status: st.status })),
    };
  }));

  r.get('/learners/:id', h((req) => {
    const st = mine(req, +req.params.id);
    const s = store.settings(), c = recalc(store);
    const x = c.byId.get(st.id)!;
    const mates = c.students.filter((y) => y.active && y.className === st.className);
    const term = termInfo(s, s.currentTerm);
    const regs = store.all('registers', 'WHERE className = ? AND date >= ? AND date <= ? ORDER BY date', st.className, isoOf(term.start), c.today);
    const att = store.all('attendance', 'WHERE learnerId = ? AND date >= ? ORDER BY date DESC', st.id, isoOf(term.start));
    const markOn = new Map(att.map((a) => [a.date, a]));
    const tsMon = term.start - (weekday(term.start) - 1);
    const wk = new Map<number, { p: number; n: number }>();
    for (const g of regs) {
      const w = Math.floor((dayNum(g.date) - tsMon) / 7) + 1;
      const m = markOn.get(g.date)?.mark;
      const cell = wk.get(w) ?? { p: 0, n: 0 };
      cell.n++;
      if (!(m === 'A' || m === 'E' || (m === 'L' && !s.lateCountsPresent))) cell.p++;
      wk.set(w, cell);
    }
    const today = c.today;
    const homework = store.all('homework', 'WHERE className = ? AND (dueOn IS NULL OR dueOn >= ?) ORDER BY dueOn LIMIT 5', st.className, today);
    return {
      learner: { id: st.id, name: fullName(st), firstName: st.firstName, className: st.className, learnerNo: st.learnerNo },
      classTeacher: store.all('classes', 'WHERE name = ?', st.className)[0]?.teacher ?? '',
      attendance: { att: x.att, present: x.present, taken: x.taken, absent: x.absent, late: x.late },
      weeks: [...wk.entries()].map(([w, v]) => ({ label: `W${w}`, pct: Math.round((v.p / v.n) * 1000) / 10 })),
      lastDays: regs.slice(-10).map((g) => ({ date: g.date, mark: markOn.get(g.date)?.mark ?? 'P' })),
      absences: att.map((a) => ({ date: a.date, mark: a.mark, note: a.note })),
      grades: {
        avg: x.avg, chg: x.chg, pos: x.pos, classSize: mates.filter((y) => y.avg !== null).length,
        subjects: s.subjects.map((subj) => {
          const v = mates.map((y) => y.marks[subj]).filter((m) => m !== undefined);
          return { subject: subj, mark: x.marks[subj] ?? null, classAvg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null };
        }),
      },
      fees: s.useFees ? {
        billed: x.billed, paid: x.paid, balance: x.balance, overdue: x.overdue, status: x.feeStatus, feesDue: c.feesDue,
        payments: store.all('payments', 'WHERE studentId = ? ORDER BY date DESC, id DESC', st.id).map((p) => pickPay(p)),
        plans: store.all('paymentPlans', 'WHERE studentId = ? AND term = ?', st.id, c.term).map((p) => ({ term: p.term, instalment: p.instalment, nextDue: p.nextDue })),
      } : null,
      homeworkDue: homework.map((w) => ({ id: w.id, title: w.title, subject: w.subject, dueOn: w.dueOn })),
    };
  }));

  r.get('/learners/:id/report', h((req) => {
    const st = mine(req, +req.params.id);
    const s = store.settings();
    const term = str(req.query.term) || s.currentTerm;
    if (!s.terms.some((t) => t.name === term)) throw notFound('Term');
    const c = recalc(store, term === s.currentTerm ? undefined : term);
    return {
      school: { name: s.schoolName, address: s.schoolAddress, contact: s.schoolContact, principal: s.principal }, gradeBands: s.gradeBands,
      card: buildReportCard(store, st, term, c),
    };
  }));

  r.get('/learners/:id/homework', h((req) => {
    const st = mine(req, +req.params.id);
    const since = isoOf(dayNum(appToday(store.settings())) - 60);
    const hw = store.all('homework', 'WHERE className = ? AND COALESCE(dueOn, setOn) >= ? ORDER BY COALESCE(dueOn, setOn) DESC', st.className, since);
    const mats = store.all('materials', 'WHERE className = ? ORDER BY at DESC LIMIT 100', st.className);
    const hf = filesOf(store, 'homework', hw.map((x) => x.id)), mf = filesOf(store, 'material', mats.map((x) => x.id));
    return {
      homework: hw.map((x) => ({ ...x, files: hf.filter((f) => f.ownerId === x.id) })),
      materials: mats.map((x) => ({ ...x, files: mf.filter((f) => f.ownerId === x.id) })),
    };
  }));

  r.get('/learners/:id/schedule', h((req) => {
    const st = mine(req, +req.params.id);
    const s = store.settings(), today = appToday(s);
    return {
      days: DAYS, periods: periodsOf(s),
      lessons: store.all('timetable', 'WHERE className = ?', st.className).map((l) => ({ day: l.day, period: l.period, subject: l.subject, teacher: l.teacher, room: l.room })),
      exams: store.all('exams', 'WHERE className = ? AND date >= ? ORDER BY date, start', st.className, today).map((e) => ({ id: e.id, subject: e.subject, title: e.title, date: e.date, start: e.start, end: e.end, room: e.room })),
    };
  }));

  /** Library books out, and the school bus. */
  r.get('/learners/:id/extras', h((req) => {
    const st = mine(req, +req.params.id);
    const today = appToday(store.settings());
    const rider = store.all('riders', 'WHERE learnerId = ?', st.id)[0];
    const route = rider ? store.get('routes', rider.routeId) : null, stop = rider ? store.get('stops', rider.stopId) : null;
    return {
      loans: store.all('loans', "WHERE borrowerType = 'learner' AND borrowerId = ? AND returnedOn IS NULL ORDER BY dueOn", st.id)
        .map((l) => { const x = loanInfo(store, l, today); return { title: store.get('books', l.bookId)?.title ?? '', borrowedOn: l.borrowedOn, dueOn: l.dueOn, overdue: x.overdue, daysLate: x.daysLate, fine: x.fine }; }),
      transport: route && stop ? { route: route.name, vehicle: route.vehicle, driver: route.driver, driverPhone: route.driverPhone, stop: stop.name, amTime: stop.amTime, pmTime: stop.pmTime } : null,
    };
  }));

  r.get('/notices', h((req) => {
    const classes = [...new Set(myLearners(req).map((st) => st.className))];
    return familyNotices(store, classes, appToday(store.settings())).map((n) => ({ id: n.id, title: n.title, body: n.body, audience: n.audience, pinned: n.pinned, at: n.at, postedBy: n.postedBy }));
  }));

  r.get('/payments/:id', h((req) => {
    const p = store.get('payments', +req.params.id) ?? (() => { throw notFound('Receipt'); })();
    const st = mine(req, p.studentId);
    const s = store.settings();
    const paidToDate = store.all('payments', 'WHERE studentId = ? AND term = ? AND (date < ? OR (date = ? AND id <= ?))', p.studentId, p.term, p.date, p.date, p.id).reduce((a, x) => a + (x.amount ?? 0), 0);
    const billed = recalc(store).byId.get(st.id)?.billed ?? 0;
    return {
      payment: pickPay(p), student: { name: fullName(st), learnerNo: st.learnerNo, className: st.className },
      billed, paidToDate, balanceAfter: billed - paidToDate, school: { name: s.schoolName, address: s.schoolAddress, contact: s.schoolContact },
    };
  }));
  return r;
}

const pickPay = (p: Row) => ({ id: p.id, receiptNo: p.receiptNo, date: p.date, term: p.term, amount: p.amount, method: p.method, reference: p.reference, paidBy: p.paidBy });
