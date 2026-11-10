/**
 * REPORTS & ANALYTICS, GPA, and fee INVOICES / STATEMENTS.
 *
 * Every report returns the same shape: headline figures (kpis), an optional chart (label/value pairs), and tables
 * (columns + rows) the screen can show, print or save as CSV. Each report says who may run it.
 */
import { Router, type Request } from 'express';
import type { Row, Store } from './db.ts';
import { appToday, band, dayNum, fullName, hasItem, isActive, isoOf, recalc, termMarks } from './engine.ts';
import { forbidden, h, isIso, need, notFound, str } from './kit.ts';
import type { Settings } from './types.ts';
import { STAGES } from './admissions.ts';

type Col = { key: string; label: string; type?: 'num' | 'money' | 'pct' | 'text' };
type Table = { title?: string; columns: Col[]; rows: Record<string, unknown>[] };
type Report = { title: string; subtitle?: string; kpis?: { label: string; value: string | number; type?: Col['type'] }[]; chart?: { title: string; unit?: string; max?: number; min?: number; data: { label: string; value: number }[] }; tables: Table[] };
type Perm = 'staff' | 'fees' | 'hr' | 'admissions' | 'library' | 'transport';
type Def = { id: string; group: string; title: string; description: string; params: ('term' | 'from' | 'to' | 'class')[]; perm: Perm; run: (q: Q) => Report };
type Q = { term: string; from: string; to: string; className: string };

const r1 = (x: number) => Math.round(x * 10) / 10;
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** Grade points of a band: its own `points`, else counting down from the top band (A=4 … E=0 for five bands). */
export function bandPoints(s: Settings, mark: number) {
  const bands = s.gradeBands ?? [];
  const b = band(s, mark);
  if (!b) return null;
  if (typeof (b as any).points === 'number') return (b as any).points as number;
  return bands.length - 1 - bands.indexOf(b);
}
export function gpaOf(s: Settings, marks: Record<string, number> | undefined) {
  const p = Object.values(marks ?? {}).map((m) => bandPoints(s, m)).filter((x): x is number => x !== null);
  return p.length ? Math.round((p.reduce((a, b) => a + b, 0) / p.length) * 100) / 100 : null;
}
/** Term GPA for every term up to `term` that has marks, and their mean (cumulative). */
export function gpaHistory(store: Store, learnerId: number, upTo: string) {
  const s = store.settings();
  const out: { term: string; gpa: number }[] = [];
  for (const t of s.terms) {
    const g = gpaOf(s, termMarks(store, s, t.name).get(learnerId));
    if (g !== null) out.push({ term: t.name, gpa: g });
    if (t.name === upTo) break;
  }
  const cum = mean(out.map((x) => x.gpa));
  return { terms: out, cumulative: cum === null ? null : Math.round(cum * 100) / 100 };
}

// ------------------------------------------------------------ invoices & statements
export function feeLines(s: Settings, st: Row, gradeOf: string) {
  const g = s.grades.find((x) => x.name === gradeOf);
  const lines: { item: string; amount: number }[] = [];
  if (g) { lines.push({ item: `Tuition · ${g.name}`, amount: g.tuition ?? 0 }); if (g.books) lines.push({ item: 'Books & activities', amount: g.books }); }
  for (const f of s.optionalFees ?? []) if (hasItem(st.optionalFees, f.name)) lines.push({ item: f.name, amount: f.amount ?? 0 });
  return lines;
}
export function invoiceFor(store: Store, st: Row, term: string) {
  const s = store.settings();
  const cls = store.all('classes', 'WHERE name = ?', st.className)[0];
  const lines = s.useFees ? feeLines(s, st, cls?.grade ?? '') : [];
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const payments = store.all('payments', 'WHERE studentId = ? AND term = ? ORDER BY date, id', st.id, term);
  const paid = payments.reduce((a, p) => a + (p.amount ?? 0), 0);
  const t = s.terms.find((x) => x.name === term);
  return {
    invoiceNo: `INV-${term.replace(/\s+/g, '')}-${st.learnerNo || st.id}`, term, issued: t?.start ?? null, due: t?.feesDue ?? null,
    learner: { id: st.id, name: fullName(st), learnerNo: st.learnerNo, className: st.className, guardianName: st.guardianName, address: st.address },
    lines, total, payments: payments.map((p) => ({ receiptNo: p.receiptNo, date: p.date, amount: p.amount, method: p.method })), paid, balance: total - paid,
    school: { name: s.schoolName, address: s.schoolAddress, contact: s.schoolContact },
  };
}
/**
 * Every term from enrolment to the current term: the term's bill, then its payments, with a running balance.
 * Terms before the school started recording payments in the app are left out (their payments were kept elsewhere,
 * e.g. in the Excel workbook), so families are never shown old terms as unpaid.
 */
export function statementFor(store: Store, st: Row) {
  const s = store.settings();
  const cur = s.terms.findIndex((t) => t.name === s.currentTerm);
  const recorded = new Set((store.db.prepare('SELECT DISTINCT term FROM payments').all() as { term: string }[]).map((r) => r.term));
  const firstKept = Math.min(cur, ...s.terms.map((t, i) => (recorded.has(t.name) ? i : Infinity)));
  const terms = s.terms.slice(Math.max(0, firstKept), cur + 1).filter((t) => !st.enrolmentDate || t.end >= st.enrolmentDate);
  const rows: { date: string; what: string; charge: number; payment: number; balance: number }[] = [];
  let bal = 0;
  for (const t of terms) {
    const inv = invoiceFor(store, st, t.name);
    if (inv.total) { bal += inv.total; rows.push({ date: t.start, what: `${t.name} fees (${inv.invoiceNo})`, charge: inv.total, payment: 0, balance: bal }); }
    for (const p of inv.payments) { bal -= p.amount; rows.push({ date: p.date, what: `Payment ${p.receiptNo}${p.method ? ` · ${p.method}` : ''}`, charge: 0, payment: p.amount, balance: bal }); }
  }
  // payments for terms not on the calendar (or future terms) still count
  const known = new Set(terms.map((t) => t.name));
  for (const p of store.all('payments', 'WHERE studentId = ? ORDER BY date, id', st.id).filter((p) => !known.has(p.term))) {
    bal -= p.amount; rows.push({ date: p.date, what: `Payment ${p.receiptNo} (${p.term})`, charge: 0, payment: p.amount, balance: bal });
  }
  return {
    learner: { id: st.id, name: fullName(st), learnerNo: st.learnerNo, className: st.className, guardianName: st.guardianName, address: st.address },
    rows, balance: bal, asOf: appToday(s), school: { name: s.schoolName, address: s.schoolAddress, contact: s.schoolContact },
    note: terms.length > 1 ? 'Fees for past terms use the current fee list.' : `From ${terms[0]?.name ?? s.currentTerm}, when payments started being recorded here.`,
  };
}

export function buildAnalyticsApi(store: Store) {
  const r = Router();
  const S = () => store.settings();
  const classes = () => store.all('classes', 'ORDER BY name');
  const active = () => store.all('students').filter(isActive);
  const termRange = (term: string) => { const t = S().terms.find((x) => x.name === term); return { from: t?.start ?? '', to: t?.end ?? '' }; };
  const pct = (a: number, b: number) => (b ? a / b : null);

  const defs: Def[] = [
    // ---------------------------------------------------------- learners
    { id: 'enrolment', group: 'Learners', title: 'Enrolment', description: 'Learners by class and gender; statuses.', params: [], perm: 'staff', run: () => {
      const s = S(), all = store.all('students'), act = all.filter(isActive);
      const genders = s.genders.length ? s.genders : ['F', 'M'];
      const rows = classes().map((c) => {
        const mine = act.filter((x) => x.className === c.name);
        return { className: c.name, teacher: c.teacher, total: mine.length, ...Object.fromEntries(genders.map((g) => [`g_${g}`, mine.filter((x) => x.gender === g).length])) };
      });
      const statuses = [...new Set(all.map((x) => x.status || 'Active'))];
      return {
        title: 'Enrolment', kpis: [{ label: 'Active learners', value: act.length }, { label: 'Classes', value: rows.length }, ...genders.map((g) => ({ label: g, value: act.filter((x) => x.gender === g).length }))],
        chart: { title: 'Learners per class', unit: '', min: 0, max: Math.max(1, ...rows.map((x) => x.total)), data: rows.map((x) => ({ label: x.className, value: x.total })) },
        tables: [
          { title: 'By class', columns: [{ key: 'className', label: 'Class' }, { key: 'teacher', label: 'Class teacher' }, ...genders.map((g) => ({ key: `g_${g}`, label: g, type: 'num' as const })), { key: 'total', label: 'Total', type: 'num' }], rows },
          { title: 'By status', columns: [{ key: 'status', label: 'Status' }, { key: 'n', label: 'Learners', type: 'num' }], rows: statuses.map((st) => ({ status: st, n: all.filter((x) => (x.status || 'Active') === st).length })) },
        ],
      };
    } },
    // ---------------------------------------------------------- attendance
    { id: 'attendance', group: 'Attendance', title: 'Attendance by class', description: 'Registers taken and attendance for a date range, and the chronic absentees.', params: ['from', 'to', 'class'], perm: 'staff', run: (q) => {
      const s = S();
      const regs = store.all('registers', 'WHERE date >= ? AND date <= ?', q.from, q.to).filter((x) => !q.className || x.className === q.className);
      const marks = store.all('attendance', 'WHERE date >= ? AND date <= ?', q.from, q.to);
      const lateIn = s.lateCountsPresent !== false;
      const byClass = classes().filter((c) => !q.className || c.name === q.className).map((c) => {
        const mine = regs.filter((x) => x.className === c.name);
        const p = mine.reduce((a, x) => a + (x.present ?? 0), 0), e = mine.reduce((a, x) => a + (x.enrolled ?? 0), 0);
        return { className: c.name, registers: mine.length, present: p, enrolled: e, att: pct(p, e) };
      });
      const learners = active().filter((x) => !q.className || x.className === q.className).map((st) => {
        const taken = regs.filter((x) => x.className === st.className).length;
        const mine = marks.filter((m) => m.learnerId === st.id);
        const absent = mine.filter((m) => m.mark === 'A' || m.mark === 'E').length, late = mine.filter((m) => m.mark === 'L').length;
        const present = taken - absent - (lateIn ? 0 : late);
        return { name: fullName(st), className: st.className, taken, absent, unexcused: mine.filter((m) => m.mark === 'A').length, late, att: taken ? present / taken : null };
      });
      const chronic = learners.filter((x) => x.att !== null && x.att < s.riskAttendance).sort((a, b) => (a.att ?? 0) - (b.att ?? 0));
      const P = byClass.reduce((a, x) => a + x.present, 0), E = byClass.reduce((a, x) => a + x.enrolled, 0);
      return {
        title: 'Attendance by class', subtitle: `${q.from} to ${q.to}`,
        kpis: [{ label: 'Attendance', value: pct(P, E) ?? '–', type: 'pct' }, { label: 'Registers', value: regs.length }, { label: `Under ${Math.round(s.riskAttendance * 100)}%`, value: chronic.length }],
        chart: { title: 'Attendance by class (%)', unit: '%', data: byClass.filter((x) => x.att !== null).map((x) => ({ label: x.className, value: r1(x.att! * 100) })) },
        tables: [
          { title: 'Classes', columns: [{ key: 'className', label: 'Class' }, { key: 'registers', label: 'Registers', type: 'num' }, { key: 'present', label: 'Present (learner-days)', type: 'num' }, { key: 'enrolled', label: 'Expected', type: 'num' }, { key: 'att', label: 'Attendance', type: 'pct' }], rows: byClass },
          { title: `Chronic absence (under ${Math.round(s.riskAttendance * 100)}%)`, columns: [{ key: 'name', label: 'Learner' }, { key: 'className', label: 'Class' }, { key: 'taken', label: 'Days', type: 'num' }, { key: 'absent', label: 'Absent', type: 'num' }, { key: 'unexcused', label: 'Unexcused', type: 'num' }, { key: 'late', label: 'Late', type: 'num' }, { key: 'att', label: 'Attendance', type: 'pct' }], rows: chronic },
        ],
      };
    } },
    { id: 'attendance-trend', group: 'Attendance', title: 'Attendance by term', description: 'School and class attendance term by term.', params: [], perm: 'staff', run: () => {
      const s = S();
      const terms = s.terms.filter((t) => t.start <= appToday(s));
      const regs = store.all('registers');
      const rows = classes().map((c) => ({ className: c.name, ...Object.fromEntries(terms.map((t) => {
        const mine = regs.filter((x) => x.className === c.name && x.date >= t.start && x.date <= t.end);
        return [t.name, pct(mine.reduce((a, x) => a + x.present, 0), mine.reduce((a, x) => a + x.enrolled, 0))];
      })) }));
      const school = terms.map((t) => { const mine = regs.filter((x) => x.date >= t.start && x.date <= t.end); return { label: t.name, p: pct(mine.reduce((a, x) => a + x.present, 0), mine.reduce((a, x) => a + x.enrolled, 0)) }; });
      return {
        title: 'Attendance by term', chart: { title: 'School attendance (%)', unit: '%', data: school.filter((x) => x.p !== null).map((x) => ({ label: x.label, value: r1(x.p! * 100) })) },
        tables: [{ title: 'By class', columns: [{ key: 'className', label: 'Class' }, ...terms.map((t) => ({ key: t.name, label: t.name, type: 'pct' as const }))], rows }],
      };
    } },
    // ---------------------------------------------------------- academic
    { id: 'subjects', group: 'Academic', title: 'Subject averages', description: 'Average term mark per subject and class, and the grade spread per subject.', params: ['term'], perm: 'staff', run: (q) => {
      const s = S(), tm = termMarks(store, s, q.term), act = active();
      const avgFor = (cls: string | null, subj: string) => mean(act.filter((x) => !cls || x.className === cls).map((x) => tm.get(x.id)?.[subj]).filter((m): m is number => m !== undefined));
      const rows = classes().map((c) => ({ className: c.name, ...Object.fromEntries(s.subjects.map((subj) => [subj, avgFor(c.name, subj) === null ? null : r1(avgFor(c.name, subj)!)])) }));
      const spread = s.subjects.map((subj) => {
        const marks = act.map((x) => tm.get(x.id)?.[subj]).filter((m): m is number => m !== undefined);
        return { subject: subj, n: marks.length, avg: marks.length ? r1(mean(marks)!) : null, ...Object.fromEntries(s.gradeBands.map((b) => [`b_${b.band}`, marks.filter((m) => band(s, m)?.band === b.band).length])) };
      });
      return {
        title: `Subject averages · ${q.term}`,
        chart: { title: 'School average per subject', unit: '', min: 0, max: 100, data: spread.filter((x) => x.avg !== null).map((x) => ({ label: x.subject.slice(0, 12), value: x.avg! })) },
        tables: [
          { title: 'Average mark by class', columns: [{ key: 'className', label: 'Class' }, ...s.subjects.map((x) => ({ key: x, label: x, type: 'num' as const }))], rows },
          { title: 'Grade spread by subject (learners)', columns: [{ key: 'subject', label: 'Subject' }, { key: 'avg', label: 'Average', type: 'num' }, ...s.gradeBands.map((b) => ({ key: `b_${b.band}`, label: b.band, type: 'num' as const }))], rows: spread },
        ],
      };
    } },
    { id: 'performers', group: 'Academic', title: 'Top and bottom performers', description: 'The five highest and lowest term averages in each class, with GPA.', params: ['term', 'class'], perm: 'staff', run: (q) => {
      const s = S(), c = recalc(store, q.term === s.currentTerm ? undefined : q.term);
      const rows: Record<string, unknown>[] = [];
      for (const cl of classes().filter((x) => !q.className || x.name === q.className)) {
        const list = c.students.filter((x) => x.active && x.className === cl.name && x.avg !== null).sort((a, b) => b.avg! - a.avg!);
        const pick = list.length <= 10 ? list.map((x, i) => [x, i < 5 ? 'Top' : 'Bottom'] as const) : [...list.slice(0, 5).map((x) => [x, 'Top'] as const), ...list.slice(-5).map((x) => [x, 'Bottom'] as const)];
        for (const [x, which] of pick) rows.push({ className: cl.name, which, pos: x.pos, name: x.name, avg: r1(x.avg!), gpa: gpaOf(s, x.marks), chg: x.chg === null ? null : r1(x.chg) });
      }
      return { title: `Top and bottom performers · ${q.term}`, tables: [{ columns: [{ key: 'className', label: 'Class' }, { key: 'which', label: '' }, { key: 'pos', label: 'Pos.', type: 'num' }, { key: 'name', label: 'Learner' }, { key: 'avg', label: 'Average', type: 'num' }, { key: 'gpa', label: 'GPA', type: 'num' }, { key: 'chg', label: 'Change', type: 'num' }], rows }] };
    } },
    { id: 'academic-trend', group: 'Academic', title: 'Results by term', description: 'Each class\'s average term mark, term by term.', params: [], perm: 'staff', run: () => {
      const s = S(), act = active();
      const terms = s.terms.map((t) => ({ name: t.name, tm: termMarks(store, s, t.name) })).filter((t) => t.tm.size);
      const avgOf = (tm: Map<number, Record<string, number>>, cls: string | null) => mean(act.filter((x) => !cls || x.className === cls).map((x) => mean(Object.values(tm.get(x.id) ?? {}))).filter((v): v is number => v !== null));
      return {
        title: 'Results by term', chart: { title: 'School average', unit: '', min: 0, max: 100, data: terms.map((t) => ({ label: t.name, value: r1(avgOf(t.tm, null) ?? 0) })) },
        tables: [{ columns: [{ key: 'className', label: 'Class' }, ...terms.map((t) => ({ key: t.name, label: t.name, type: 'num' as const }))], rows: classes().map((c) => ({ className: c.name, ...Object.fromEntries(terms.map((t) => { const v = avgOf(t.tm, c.name); return [t.name, v === null ? null : r1(v)]; })) })) }],
      };
    } },
    // ---------------------------------------------------------- fees
    { id: 'collections', group: 'Fees', title: 'Collections', description: 'Money received by month and by payment method.', params: ['from', 'to'], perm: 'fees', run: (q) => {
      const pays = store.all('payments', 'WHERE date >= ? AND date <= ? ORDER BY date', q.from, q.to);
      const months = [...new Set(pays.map((p) => p.date.slice(0, 7)))];
      const methods = [...new Set(pays.map((p) => p.method || '–'))];
      const total = pays.reduce((a, p) => a + p.amount, 0);
      return {
        title: 'Collections', subtitle: `${q.from} to ${q.to}`,
        kpis: [{ label: 'Received', value: total, type: 'money' }, { label: 'Receipts', value: pays.length }, { label: 'Average receipt', value: pays.length ? total / pays.length : 0, type: 'money' }],
        chart: { title: 'Received per month', unit: '', min: 0, max: Math.max(1, ...months.map((m) => pays.filter((p) => p.date.startsWith(m)).reduce((a, p) => a + p.amount, 0))), data: months.map((m) => ({ label: m, value: Math.round(pays.filter((p) => p.date.startsWith(m)).reduce((a, p) => a + p.amount, 0)) })) },
        tables: [
          { title: 'By month', columns: [{ key: 'month', label: 'Month' }, { key: 'n', label: 'Receipts', type: 'num' }, ...methods.map((m) => ({ key: `m_${m}`, label: m, type: 'money' as const })), { key: 'total', label: 'Total', type: 'money' }],
            rows: months.map((m) => { const mine = pays.filter((p) => p.date.startsWith(m)); return { month: m, n: mine.length, ...Object.fromEntries(methods.map((x) => [`m_${x}`, mine.filter((p) => (p.method || '–') === x).reduce((a, p) => a + p.amount, 0)])), total: mine.reduce((a, p) => a + p.amount, 0) }; }) },
        ],
      };
    } },
    { id: 'arrears', group: 'Fees', title: 'Arrears ageing', description: 'What is owed this term, by how long it has been overdue; the list of debtors.', params: ['class'], perm: 'fees', run: (q) => {
      const c = recalc(store), s = S();
      const due = c.feesDue ? dayNum(c.feesDue) : null, today = dayNum(c.today);
      const age = (x: { balance: number; overdue: number; hasPlan: boolean }) => {
        if (x.balance <= 0.005) return null;
        if (!due || today <= due) return 'Not yet due';
        if (x.hasPlan && !x.overdue) return 'On a plan';
        const d = today - due;
        return d <= 30 ? '1–30 days' : d <= 60 ? '31–60 days' : d <= 90 ? '61–90 days' : '90+ days';
      };
      const BUCKETS = ['Not yet due', 'On a plan', '1–30 days', '31–60 days', '61–90 days', '90+ days'];
      const debtors = c.students.filter((x) => x.active && (!q.className || x.className === q.className) && x.balance > 0.005).map((x) => {
        const st = store.get('students', x.id)!;
        return { name: x.name, className: x.className, guardian: st.guardianName, phone: st.guardianPhone, billed: x.billed, paid: x.paid, balance: x.balance, age: age(x) };
      }).sort((a, b) => b.balance - a.balance);
      const byBucket = BUCKETS.map((b) => ({ bucket: b, n: debtors.filter((d) => d.age === b).length, amount: debtors.filter((d) => d.age === b).reduce((a, d) => a + d.balance, 0) }));
      return {
        title: `Arrears ageing · ${c.term}`, subtitle: c.feesDue ? `fees were due ${c.feesDue}` : undefined,
        kpis: [{ label: 'Owed', value: debtors.reduce((a, d) => a + d.balance, 0), type: 'money' }, { label: 'Learners owing', value: debtors.length }, { label: 'Overdue', value: byBucket.slice(2).reduce((a, b) => a + b.amount, 0), type: 'money' }],
        chart: { title: 'Owed by age', unit: '', min: 0, max: Math.max(1, ...byBucket.map((b) => b.amount)), data: byBucket.map((b) => ({ label: b.bucket, value: Math.round(b.amount) })) },
        tables: [
          { title: 'By age', columns: [{ key: 'bucket', label: 'Age' }, { key: 'n', label: 'Learners', type: 'num' }, { key: 'amount', label: 'Owed', type: 'money' }], rows: byBucket },
          { title: 'Debtors', columns: [{ key: 'name', label: 'Learner' }, { key: 'className', label: 'Class' }, { key: 'guardian', label: 'Guardian' }, { key: 'phone', label: 'Phone' }, { key: 'billed', label: 'Billed', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Owed', type: 'money' }, { key: 'age', label: 'Age' }], rows: debtors },
        ],
        ...(s.useFees ? {} : { subtitle: 'Fees are switched off' }),
      };
    } },
    { id: 'fees-by-class', group: 'Fees', title: 'Collection rate by class', description: 'Billed, collected and owed per class this term.', params: [], perm: 'fees', run: () => {
      const c = recalc(store);
      const rows = c.classes.map((k) => ({ className: k.name, n: k.n, billed: k.billed, paid: k.paid, balance: k.balance, rate: pct(k.paid, k.billed), overdue: k.overdue }));
      return {
        title: `Collection rate by class · ${c.term}`,
        kpis: [{ label: 'Billed', value: c.kpis.billed, type: 'money' }, { label: 'Collected', value: c.kpis.paid, type: 'money' }, { label: 'Collection rate', value: pct(c.kpis.paid, c.kpis.billed) ?? '–', type: 'pct' }],
        chart: { title: 'Collected (%)', unit: '%', data: rows.filter((x) => x.rate !== null).map((x) => ({ label: x.className, value: r1(x.rate! * 100) })) },
        tables: [{ columns: [{ key: 'className', label: 'Class' }, { key: 'n', label: 'Learners', type: 'num' }, { key: 'billed', label: 'Billed', type: 'money' }, { key: 'paid', label: 'Collected', type: 'money' }, { key: 'balance', label: 'Owed', type: 'money' }, { key: 'rate', label: 'Rate', type: 'pct' }, { key: 'overdue', label: 'Overdue learners', type: 'num' }], rows }],
      };
    } },
    // ---------------------------------------------------------- admissions
    { id: 'admissions', group: 'Admissions', title: 'Admissions funnel', description: 'Applications by stage and by grade; how many become enrolments.', params: [], perm: 'admissions', run: () => {
      const apps = store.all('applications');
      const grades = [...new Set(apps.map((a) => a.gradeApplying))].sort();
      const enrolled = apps.filter((a) => a.status === 'Enrolled').length;
      return {
        title: 'Admissions funnel', kpis: [{ label: 'Applications', value: apps.length }, { label: 'Enrolled', value: enrolled }, { label: 'Conversion', value: pct(enrolled, apps.length) ?? '–', type: 'pct' }],
        chart: { title: 'Applications by stage', unit: '', min: 0, max: Math.max(1, ...STAGES.map((s) => apps.filter((a) => a.status === s).length)), data: STAGES.map((s) => ({ label: s, value: apps.filter((a) => a.status === s).length })) },
        tables: [{ title: 'By grade', columns: [{ key: 'grade', label: 'Grade' }, ...STAGES.map((s) => ({ key: s, label: s, type: 'num' as const })), { key: 'total', label: 'Total', type: 'num' }],
          rows: grades.map((g) => ({ grade: g, ...Object.fromEntries(STAGES.map((s) => [s, apps.filter((a) => a.gradeApplying === g && a.status === s).length])), total: apps.filter((a) => a.gradeApplying === g).length })) }],
      };
    } },
    // ---------------------------------------------------------- resources
    { id: 'library', group: 'Resources', title: 'Library circulation', description: 'Loans per month, the most borrowed books, overdue books.', params: ['from', 'to'], perm: 'library', run: (q) => {
      const loans = store.all('loans', 'WHERE borrowedOn >= ? AND borrowedOn <= ?', q.from, q.to);
      const today = appToday(S());
      const books = new Map(store.all('books').map((b) => [b.id, b]));
      const months = [...new Set(loans.map((l) => l.borrowedOn.slice(0, 7)))].sort();
      const top = [...loans.reduce((m, l) => m.set(l.bookId, (m.get(l.bookId) ?? 0) + 1), new Map<number, number>())].sort((a, b) => b[1] - a[1]).slice(0, 10);
      const overdue = store.all('loans', 'WHERE returnedOn IS NULL AND dueOn < ?', today);
      return {
        title: 'Library circulation', subtitle: `${q.from} to ${q.to}`,
        kpis: [{ label: 'Loans', value: loans.length }, { label: 'Titles', value: books.size }, { label: 'Overdue now', value: overdue.length }],
        chart: { title: 'Loans per month', unit: '', min: 0, max: Math.max(1, ...months.map((m) => loans.filter((l) => l.borrowedOn.startsWith(m)).length)), data: months.map((m) => ({ label: m, value: loans.filter((l) => l.borrowedOn.startsWith(m)).length })) },
        tables: [{ title: 'Most borrowed', columns: [{ key: 'title', label: 'Book' }, { key: 'author', label: 'Author' }, { key: 'n', label: 'Loans', type: 'num' }], rows: top.map(([id, n]) => ({ title: books.get(id)?.title ?? '(removed)', author: books.get(id)?.author, n })) }],
      };
    } },
    { id: 'transport', group: 'Resources', title: 'Transport use', description: 'Riders and seats per route.', params: [], perm: 'transport', run: () => {
      const routes = store.all('routes', 'ORDER BY name'), riders = store.all('riders');
      const rows = routes.map((rt) => { const n = riders.filter((x) => x.routeId === rt.id).length; return { name: rt.name, vehicle: rt.vehicle, riders: n, capacity: rt.capacity, use: rt.capacity ? n / rt.capacity : null }; });
      return {
        title: 'Transport use', kpis: [{ label: 'Routes', value: routes.length }, { label: 'Riders', value: riders.length }],
        chart: { title: 'Seats used (%)', unit: '%', min: 0, max: 100, data: rows.filter((x) => x.use !== null).map((x) => ({ label: x.name, value: r1(x.use! * 100) })) },
        tables: [{ columns: [{ key: 'name', label: 'Route' }, { key: 'vehicle', label: 'Vehicle' }, { key: 'riders', label: 'Riders', type: 'num' }, { key: 'capacity', label: 'Seats', type: 'num' }, { key: 'use', label: 'Used', type: 'pct' }], rows }],
      };
    } },
    // ---------------------------------------------------------- staff
    { id: 'staff', group: 'Staff', title: 'Staff attendance, leave and payroll', description: 'Staff absence and leave in a date range; payroll totals per month.', params: ['from', 'to'], perm: 'hr', run: (q) => {
      const staff = store.all('staff', "WHERE status != 'Left' ORDER BY name");
      const att = store.all('staffAttendance', 'WHERE date >= ? AND date <= ?', q.from, q.to);
      const leave = store.all('leave', "WHERE status = 'Approved' AND fromDate <= ? AND toDate >= ?", q.to, q.from);
      const runs = store.all('payruns', 'ORDER BY month');
      const slips = store.all('payslips');
      return {
        title: 'Staff', subtitle: `${q.from} to ${q.to}`,
        kpis: [{ label: 'Staff', value: staff.length }, { label: 'Days absent', value: att.filter((a) => a.mark === 'A').length }, { label: 'Leave days approved', value: leave.reduce((a, l) => a + (l.days ?? 0), 0) }],
        chart: { title: 'Net payroll per month', unit: '', min: 0, max: Math.max(1, ...runs.map((r) => slips.filter((p) => p.payrunId === r.id).reduce((a, p) => a + p.net, 0))), data: runs.map((r) => ({ label: r.month, value: Math.round(slips.filter((p) => p.payrunId === r.id).reduce((a, p) => a + p.net, 0)) })) },
        tables: [
          { title: 'Attendance and leave', columns: [{ key: 'name', label: 'Name' }, { key: 'position', label: 'Position' }, { key: 'absent', label: 'Absent', type: 'num' }, { key: 'late', label: 'Late', type: 'num' }, { key: 'leave', label: 'Leave days', type: 'num' }],
            rows: staff.map((x) => ({ name: x.name, position: x.position, absent: att.filter((a) => a.staffId === x.id && a.mark === 'A').length, late: att.filter((a) => a.staffId === x.id && a.mark === 'L').length, leave: leave.filter((l) => l.staffId === x.id).reduce((a, l) => a + (l.days ?? 0), 0) })) },
          { title: 'Payroll', columns: [{ key: 'month', label: 'Month' }, { key: 'status', label: 'Status' }, { key: 'n', label: 'Payslips', type: 'num' }, { key: 'gross', label: 'Gross', type: 'money' }, { key: 'deductions', label: 'Deductions', type: 'money' }, { key: 'net', label: 'Net', type: 'money' }],
            rows: runs.map((r) => { const mine = slips.filter((p) => p.payrunId === r.id); return { month: r.month, status: r.status, n: mine.length, gross: mine.reduce((a, p) => a + p.gross, 0), deductions: mine.reduce((a, p) => a + p.deductions, 0), net: mine.reduce((a, p) => a + p.net, 0) }; }) },
        ],
      };
    } },
  ];

  const allowed = (req: Request, d: Def) => !!req.perms?.[d.perm];
  r.get('/reports', h((req) => {
    need(req, 'staff');
    return defs.filter((d) => allowed(req, d)).map(({ run, ...d }) => d);
  }));
  r.get('/reports/:id', h((req) => {
    need(req, 'staff');
    const d = defs.find((x) => x.id === req.params.id) ?? (() => { throw notFound('Report'); })();
    if (!allowed(req, d)) throw forbidden('You cannot run this report');
    const s = S();
    const term = s.terms.some((t) => t.name === req.query.term) ? str(req.query.term) : s.currentTerm;
    const tr = termRange(s.currentTerm);
    const today = appToday(s);
    const from = isIso(req.query.from) ? (req.query.from as string) : tr.from || isoOf(dayNum(today) - 90);
    const to = isIso(req.query.to) ? (req.query.to as string) : today < tr.to ? today : tr.to || today;
    const report = d.run({ term, from, to, className: str(req.query.class) });
    return { ...report, params: { term, from, to, class: str(req.query.class) } };
  }));

  // ------------------------------------------------------------ invoices & statements (staff)
  r.get('/fees/invoices', h((req) => {
    need(req, 'fees');
    const s = S(), term = s.terms.some((t) => t.name === req.query.term) ? str(req.query.term) : s.currentTerm;
    const list = req.query.learner ? [store.get('students', +req.query.learner) ?? (() => { throw notFound('Learner'); })()] : store.all('students', 'WHERE className = ? ORDER BY firstName, lastName', str(req.query.class)).filter(isActive);
    return list.map((st) => invoiceFor(store, st, term));
  }));
  r.get('/fees/statement/:id', h((req) => {
    need(req, 'fees');
    const st = store.get('students', +req.params.id) ?? (() => { throw notFound('Learner'); })();
    return statementFor(store, st);
  }));
  return r;
}
