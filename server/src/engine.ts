/**
 * SCHOOL ENGINE — a port of the workbook's SMS_Recalc.
 *
 *   attendance  registers taken this term per class (up to today), days absent / late per learner, term %, today's registers, weeks
 *   grades      term mark per subject = weighted assessments (rounded half up), term average, change vs the previous term,
 *               position in class
 *   fees        bill per learner (grade tuition + books + the optional fees the learner takes), paid, balance,
 *               overdue (after the term's Fees Due date, unless a payment plan is on time), status text
 *   flags       attendance under Settings > riskAttendance, average down by riskDrop or more, fees overdue.
 *               2+ flags = at risk, 1 flag = watch list
 *
 * Nothing calculated is stored: everything is worked out from the tables on demand (and cached until the next write).
 */
import type { Row, Store } from './db.ts';
import type { Settings } from './types.ts';

const EPS = 1e-7;

// ---------- dates (ISO yyyy-mm-dd <-> day numbers) ----------
export const dayNum = (iso: string | null | undefined) => (iso ? Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 86400000) : 0);
export const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
/** 1 = Monday ... 7 = Sunday */
export const weekday = (n: number) => ((((n + 3) % 7) + 7) % 7) + 1;
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function appToday(s: Settings): string {
  return s.sampleMode && s.sampleAnchor ? s.sampleAnchor : localToday();
}

export function holidayOn(s: Settings, iso: string): string {
  const h = (s.holidays ?? []).find((x) => x.date === iso);
  return h ? `${h.name}${h.type ? ` (${h.type.toLowerCase()})` : ''}` : '';
}

export function termInfo(s: Settings, name: string) {
  const terms = s.terms ?? [];
  const i = terms.findIndex((t) => t.name === name);
  const t = terms[i];
  return {
    name,
    start: t ? dayNum(t.start) : 0,
    end: t ? dayNum(t.end) : 0,
    due: t ? dayNum(t.feesDue) : 0,
    prev: i > 0 ? terms[i - 1].name : '',
  };
}

/** A school day: Mon-Fri, inside the term, not a holiday. */
export function isSchoolDay(s: Settings, iso: string, term = termInfo(s, s.currentTerm)) {
  const d = dayNum(iso);
  return weekday(d) <= 5 && d >= term.start && (d <= term.end || term.end === 0) && !holidayOn(s, iso);
}

export const r1 = (x: number) => Math.floor(x * 10 + 0.5 + 1e-9) / 10;
export const roundHalfUp = (x: number) => Math.floor(x + 0.5 + 1e-9);

export function band(s: Settings, mark: number) {
  const bands = s.gradeBands ?? [];
  for (const b of bands) if (mark >= b.from - 1e-6) return b;
  return bands[bands.length - 1];
}

export const hasItem = (list: string | null | undefined, item: string) =>
  !!list && list.split(',').some((p) => p.trim().toLowerCase() === item.trim().toLowerCase());

export const fullName = (st: Row) => `${st.firstName ?? ''} ${st.lastName ?? ''}`.trim();
export const isActive = (st: Row) => !st.status || st.status === 'Active';

/** Term mark per learner and subject: weighted assessments of that term (mark / outOf * 100), rounded half up. */
export function termMarks(store: Store, s: Settings, term: string) {
  const subjects = new Set(s.subjects ?? []);
  const ass = new Map<number, { subject: string; weight: number; outOf: number }>();
  for (const a of store.all('assessments', 'WHERE term = ?', term)) {
    if (!subjects.has(a.subject) || !(a.weight > 0)) continue;
    ass.set(a.id, { subject: a.subject, weight: a.weight, outOf: a.outOf > 0 ? a.outOf : 100 });
  }
  const acc = new Map<number, Map<string, { w: number; wm: number }>>();
  if (ass.size) {
    for (const m of store.all('marks', 'WHERE mark IS NOT NULL')) {
      const a = ass.get(m.assessmentId);
      if (!a) continue;
      let byS = acc.get(m.learnerId);
      if (!byS) acc.set(m.learnerId, (byS = new Map()));
      const cell = byS.get(a.subject) ?? { w: 0, wm: 0 };
      cell.w += a.weight;
      cell.wm += (a.weight * m.mark) / a.outOf * 100;
      byS.set(a.subject, cell);
    }
  }
  const out = new Map<number, Record<string, number>>();
  for (const [lid, byS] of acc) {
    const rec: Record<string, number> = {};
    for (const subj of s.subjects) {
      const c = byS.get(subj);
      if (c && c.w > 0) rec[subj] = roundHalfUp(c.wm / c.w);
    }
    out.set(lid, rec);
  }
  return out;
}

const avgOf = (rec: Record<string, number> | undefined) => {
  const v = rec ? Object.values(rec) : [];
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export interface StudentStats {
  id: number;
  name: string;
  firstName: string;
  className: string;
  learnerNo: string;
  active: boolean;
  taken: number;
  present: number;
  absent: number;
  late: number;
  att: number | null;
  avg: number | null;
  prev: number | null;
  chg: number | null;
  pos: number | null;
  billed: number;
  paid: number;
  paidBefore: number;
  balance: number;
  overdue: number;
  hasPlan: boolean;
  planNext: string | null;
  flags: number;
  flagText: string;
  feeStatus: string;
  marks: Record<string, number>;
  reasons: string[];
}

export interface ClassStats {
  id: number;
  name: string;
  label: string;
  grade: string;
  teacher: string;
  room: string;
  n: number;
  att: number | null;
  avg: number | null;
  billed: number;
  paid: number;
  balance: number;
  overdue: number;
  plans: number;
  registersTaken: number;
  today: 'Yes' | 'No' | '';
  todayPresent: number;
  todayEnrolled: number;
}

export interface Calc {
  today: string;
  term: string;
  termStart: string | null;
  termEnd: string | null;
  feesDue: string | null;
  prevTerm: string;
  schoolDay: boolean;
  holiday: string;
  students: StudentStats[];
  byId: Map<number, StudentStats>;
  classes: ClassStats[];
  weeks: { label: string; week: number; pct: number }[];
  riskIds: number[];
  watchIds: number[];
  kpis: {
    learners: number; classes: number; risk: number; watch: number;
    regTaken: number; regNot: number; presentToday: number; enrolledToday: number;
    billed: number; paid: number; balance: number; overdueCount: number; overdueAmount: number; plans: number;
    receiptsToday: number; receiptsTodayAmount: number; week: number; weeks: number; schoolDays: number; ready: number;
  };
  flagMax: number;
}

const fmtMD = (n: number) => { const d = isoOf(n); return `${d.slice(5, 7)}/${d.slice(8, 10)}`; };

const caches = new WeakMap<Store, Map<string, Calc>>();

export function recalc(store: Store, forTerm?: string): Calc {
  const s = store.settings();
  const key = `${store.version}|${forTerm ?? ''}|${appToday(s)}`;
  let cache = caches.get(store);
  if (!cache) caches.set(store, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 20) cache.clear();
  const out = compute(store, s, forTerm);
  cache.set(key, out);
  return out;
}

function compute(store: Store, s: Settings, forTerm?: string): Calc {
  let tdy = dayNum(appToday(s));
  const termName = forTerm || s.currentTerm;
  const T = termInfo(s, termName);
  // another term (Dashboard): worked out as of its last day
  if (forTerm && T.end > 0 && tdy > T.end) tdy = T.end;
  const tsMon = T.start - (weekday(T.start) - 1);
  const riskAtt = s.riskAttendance > 1 ? s.riskAttendance / 100 : s.riskAttendance ?? 0.9;
  const riskDrop = s.riskDrop ?? 5;
  const lateIn = s.lateCountsPresent !== false;
  const useFees = s.useFees !== false;
  const flagMax = useFees ? 3 : 2;
  const inTerm = (d: number) => d >= T.start && d <= tdy && (d <= T.end || T.end === 0);

  const classRows = store.all('classes', 'ORDER BY name');
  const students = store.all('students', 'ORDER BY className, firstName, lastName');
  const cls = new Map<string, ClassStats>();
  const gradeOf = new Map<string, string>();
  for (const c of classRows) {
    gradeOf.set(c.name, c.grade ?? '');
    cls.set(c.name, {
      id: c.id, name: c.name, label: c.grade ? `${c.grade}${c.stream ?? ''}` : c.name, grade: c.grade ?? '', teacher: c.teacher ?? '',
      room: c.room ?? '', n: 0, att: null, avg: null, billed: 0, paid: 0, balance: 0, overdue: 0, plans: 0,
      registersTaken: 0, today: '', todayPresent: 0, todayEnrolled: 0,
    });
  }

  // ---- registers this term (up to today): taken per class, today's, attendance by week
  const days = new Set<number>();
  const wkP: number[] = [], wkE: number[] = [];
  for (const r of store.all('registers')) {
    const d = dayNum(r.date);
    const c = cls.get(r.className);
    if (!c || !inTerm(d)) continue;
    c.registersTaken++;
    days.add(d);
    const wk = Math.floor((d - tsMon) / 7) + 1;
    if (wk >= 1 && wk <= 30) { wkP[wk] = (wkP[wk] ?? 0) + (r.present ?? 0); wkE[wk] = (wkE[wk] ?? 0) + (r.enrolled ?? 0); }
    if (d === tdy) { c.today = 'Yes'; c.todayPresent = r.present ?? 0; c.todayEnrolled = r.enrolled ?? 0; }
  }

  // ---- absences / lates per learner (this term, up to today)
  const ab = new Map<number, number>(), lt = new Map<number, number>();
  for (const a of store.all('attendance')) {
    if (!inTerm(dayNum(a.date))) continue;
    if (a.mark === 'A' || a.mark === 'E') ab.set(a.learnerId, (ab.get(a.learnerId) ?? 0) + 1);
    else if (a.mark === 'L') lt.set(a.learnerId, (lt.get(a.learnerId) ?? 0) + 1);
  }

  // ---- term marks: this term and the term before
  const tm = termMarks(store, s, termName);
  const tm2 = T.prev ? termMarks(store, s, T.prev) : new Map();

  // ---- fees
  const gradeFee = new Map((s.grades ?? []).map((g) => [g.name, (g.tuition ?? 0) + (g.books ?? 0)]));
  const paid = new Map<number, number>(), paidBefore = new Map<number, number>();
  let rcN = 0, rcAmt = 0;
  for (const p of store.all('payments')) {
    const d = dayNum(p.date);
    if (d === tdy) { rcN++; rcAmt += p.amount ?? 0; }
    if (p.term === termName) {
      paid.set(p.studentId, (paid.get(p.studentId) ?? 0) + (p.amount ?? 0));
      if (d < tdy) paidBefore.set(p.studentId, (paidBefore.get(p.studentId) ?? 0) + (p.amount ?? 0));
    }
  }
  const planNext = new Map<number, number>();
  for (const p of store.all('paymentPlans', 'WHERE term = ?', termName)) {
    planNext.set(p.studentId, Math.max(planNext.get(p.studentId) ?? 0, dayNum(p.nextDue)));
  }

  const stats: StudentStats[] = [];
  for (const st of students) {
    const active = isActive(st);
    const c = cls.get(st.className);
    const x: StudentStats = {
      id: st.id, name: fullName(st), firstName: st.firstName ?? '', className: st.className ?? '', learnerNo: st.learnerNo ?? '',
      active, taken: 0, present: 0, absent: ab.get(st.id) ?? 0, late: lt.get(st.id) ?? 0, att: null, avg: null, prev: null,
      chg: null, pos: null, billed: 0, paid: 0, paidBefore: 0, balance: 0, overdue: 0, hasPlan: false, planNext: null,
      flags: 0, flagText: '', feeStatus: '', marks: tm.get(st.id) ?? {}, reasons: [],
    };
    stats.push(x);
    if (!active) continue;
    if (c) {
      x.taken = c.registersTaken;
      x.present = x.taken - x.absent - (lateIn ? 0 : x.late);
      if (x.taken > 0) x.att = x.present / x.taken;
    }
    x.avg = avgOf(tm.get(st.id));
    if (x.avg !== null && T.prev) {
      x.prev = avgOf(tm2.get(st.id));
      if (x.prev !== null) x.chg = x.avg - x.prev;
    }
    if (useFees) {
      x.billed = gradeFee.get(gradeOf.get(st.className) ?? '') ?? 0;
      for (const f of s.optionalFees ?? []) if (hasItem(st.optionalFees, f.name)) x.billed += f.amount ?? 0;
      x.paid = paid.get(st.id) ?? 0;
      x.paidBefore = paidBefore.get(st.id) ?? 0;
      x.balance = x.billed - x.paid;
      x.hasPlan = planNext.has(st.id);
      if (x.hasPlan) x.planNext = isoOf(planNext.get(st.id)!);
      const over = x.balance > 0.005 && T.due > 0 && tdy > T.due && (!x.hasPlan || planNext.get(st.id)! < tdy);
      if (over) x.overdue = x.balance;
      if (x.billed <= 0.005) x.feeStatus = '';
      else if (x.balance <= 0.005) x.feeStatus = 'Paid';
      else if (over) x.feeStatus = `${x.paid <= 0.005 ? 'Unpaid' : 'Overdue'} · ${tdy - T.due} days`;
      else if (x.hasPlan) x.feeStatus = `Plan · next ${fmtMD(planNext.get(st.id)!)}`;
      else if (T.due) x.feeStatus = `Due ${fmtMD(T.due)}`;
    }
    // flags
    if (x.att !== null && x.att < riskAtt - EPS) { x.flags++; x.reasons.push('attendance'); }
    if (x.chg !== null && x.chg <= -riskDrop + EPS) { x.flags++; x.reasons.push('grades'); }
    if (x.overdue > 0) { x.flags++; x.reasons.push('fees'); }
    if (x.flags > 0) x.flagText = `${x.flags} of ${flagMax}`;
  }

  // positions in class (1 = highest term average)
  const byClass = new Map<string, StudentStats[]>();
  for (const x of stats) if (x.active && x.avg !== null) (byClass.get(x.className) ?? byClass.set(x.className, []).get(x.className)!).push(x);
  for (const list of byClass.values()) for (const x of list) x.pos = 1 + list.filter((y) => y.avg! > x.avg! + EPS).length;

  // class totals and KPIs
  const k: Calc['kpis'] = {
    learners: 0, classes: classRows.length, risk: 0, watch: 0, regTaken: 0, regNot: 0, presentToday: 0, enrolledToday: 0,
    billed: 0, paid: 0, balance: 0, overdueCount: 0, overdueAmount: 0, plans: 0, receiptsToday: rcN, receiptsTodayAmount: rcAmt,
    week: 0, weeks: 0, schoolDays: days.size, ready: 0,
  };
  const attAcc = new Map<string, number[]>(), avgAcc = new Map<string, number[]>();
  const risk: StudentStats[] = [], watch: StudentStats[] = [];
  for (const x of stats) {
    if (!x.active) continue;
    k.learners++;
    if (x.avg !== null) k.ready++;
    if (x.flags >= 2) risk.push(x);
    if (x.flags === 1) watch.push(x);
    const c = cls.get(x.className);
    if (c) {
      c.n++;
      if (x.att !== null) (attAcc.get(c.name) ?? attAcc.set(c.name, []).get(c.name)!).push(x.att);
      if (x.avg !== null) (avgAcc.get(c.name) ?? avgAcc.set(c.name, []).get(c.name)!).push(x.avg);
      c.billed += x.billed; c.paid += x.paid;
      if (x.overdue > 0) c.overdue++;
      if (x.hasPlan && x.balance > 0.005) c.plans++;
    }
    k.billed += x.billed; k.paid += x.paid;
    if (x.overdue > 0) { k.overdueCount++; k.overdueAmount += x.overdue; }
    if (x.hasPlan && x.balance > 0.005) k.plans++;
  }
  k.balance = k.billed - k.paid;
  k.risk = risk.length; k.watch = watch.length;
  const todayIso = isoOf(tdy);
  const schoolDay = weekday(tdy) <= 5 && tdy >= T.start && (tdy <= T.end || T.end === 0) && !holidayOn(s, todayIso);
  const mean = (v?: number[]) => (v && v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  for (const c of cls.values()) {
    c.att = mean(attAcc.get(c.name));
    c.avg = mean(avgAcc.get(c.name));
    c.balance = c.billed - c.paid;
    if (c.today === 'Yes') { k.regTaken++; k.presentToday += c.todayPresent; k.enrolledToday += c.todayEnrolled; }
    else if (c.n > 0 && schoolDay) { c.today = 'No'; k.regNot++; }
  }
  // at-risk order: most flags first, then lowest attendance, then first name
  risk.sort((a, b) => b.flags - a.flags || (a.att ?? 2) - (b.att ?? 2) || a.firstName.localeCompare(b.firstName));

  const weeks: Calc['weeks'] = [];
  if (T.start > 0) for (let w = 1; w <= 14; w++) if ((wkE[w] ?? 0) > 0) weeks.push({ label: `W${w}`, week: w, pct: r1((wkP[w] / wkE[w]) * 100) });
  if (T.start > 0) {
    const lastWeek = T.end > 0 ? Math.floor((T.end - tsMon) / 7) + 1 : 99;
    k.week = Math.max(1, Math.min(Math.floor((tdy - tsMon) / 7) + 1, lastWeek));
    k.weeks = T.end > 0 ? lastWeek : 0;
  }

  return {
    today: todayIso, term: termName, termStart: T.start ? isoOf(T.start) : null, termEnd: T.end ? isoOf(T.end) : null,
    feesDue: T.due ? isoOf(T.due) : null, prevTerm: T.prev, schoolDay, holiday: holidayOn(s, todayIso),
    students: stats, byId: new Map(stats.map((x) => [x.id, x])), classes: [...cls.values()], weeks,
    riskIds: risk.map((x) => x.id), watchIds: watch.map((x) => x.id), kpis: k, flagMax,
  };
}
