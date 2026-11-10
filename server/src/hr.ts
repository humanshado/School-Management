/**
 * STAFF HR & PAYROLL (admins and the bursar only: salaries and bank details are private).
 *
 * staff        everyone who works at the school (teachers can be added from the Teachers list)
 * attendance   a daily staff register: P present, A absent, L late, LV on leave (approved leave fills itself in)
 * leave        requests with a type and dates; working days are counted without weekends and holidays; approve / reject
 * payroll      pay items (Settings.payItems: allowances and deductions, fixed or a % of base pay) apply to everyone;
 *              a staff record can override an item or add its own. Approved unpaid leave is deducted pro rata.
 *              A monthly pay run is prepared as a draft (by the bursar or an admin), approved by an admin (which
 *              freezes the payslips), then marked paid. There are no built-in national tax tables: tax is a pay item.
 */
import { Router, type Request } from 'express';
import { logActivity } from './activity.ts';
import type { Row, Store } from './db.ts';
import { appToday, dayNum, holidayOn, isoOf, weekday } from './engine.ts';
import { bad, forbidden, h, isIso, need, notFound, nowIso, pick, str } from './kit.ts';
import { deleteFilesOf, filesOf } from './files.ts';

export const LEAVE_TYPES = ['Annual', 'Sick', 'Maternity / paternity', 'Compassionate', 'Study', 'Unpaid', 'Other'];
export const STAFF_MARKS = ['P', 'A', 'L', 'LV'];
type PayItem = { name: string; kind: 'allowance' | 'deduction'; method: 'fixed' | 'percent'; amount: number | null };
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Mon-Fri days from..to that are not holidays. */
export function workingDays(store: Store, from: string, to: string) {
  const s = store.settings();
  let n = 0;
  for (let d = dayNum(from); d <= dayNum(to); d++) if (weekday(d) <= 5 && !holidayOn(s, isoOf(d))) n++;
  return n;
}
const monthBounds = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`, last = isoOf(dayNum(isoOf(Date.UTC(y, m, 1) / 86400000)) - 1);
  return { first, last };
};

/** The items that apply to one member of staff: the school's, with their own overrides / extras. */
export function itemsFor(store: Store, st: Row): PayItem[] {
  const base: PayItem[] = (store.settings().payItems ?? []).map((i) => ({ ...i }));
  let own: PayItem[] = [];
  try { own = st.payItems ? JSON.parse(st.payItems) : []; } catch { own = []; }
  for (const o of own) {
    const i = base.findIndex((b) => b.name.toLowerCase() === o.name.toLowerCase());
    if (i >= 0) base[i] = { ...base[i], ...o };
    else base.push(o);
  }
  return base.filter((i) => i.amount !== null && i.amount !== undefined && Number(i.amount) !== 0);
}

export function payslipFor(store: Store, st: Row, month: string) {
  const baseSalary = Number(st.baseSalary) || 0;
  const lines: { name: string; kind: string; amount: number; note?: string }[] = [];
  for (const i of itemsFor(store, st)) {
    const amount = r2(i.method === 'percent' ? (baseSalary * Number(i.amount)) / 100 : Number(i.amount));
    lines.push({ name: i.name, kind: i.kind, amount, note: i.method === 'percent' ? `${i.amount}% of base` : undefined });
  }
  // approved unpaid leave in the month, pro rata on working days
  const { first, last } = monthBounds(month);
  const unpaid = store.all('leave', "WHERE staffId = ? AND status = 'Approved' AND type = 'Unpaid' AND fromDate <= ? AND toDate >= ?", st.id, last, first)
    .reduce((n, l) => n + workingDays(store, l.fromDate > first ? l.fromDate : first, l.toDate < last ? l.toDate : last), 0);
  if (unpaid > 0) {
    const days = workingDays(store, first, last) || 1;
    lines.push({ name: 'Unpaid leave', kind: 'deduction', amount: r2((baseSalary / days) * unpaid), note: `${unpaid} of ${days} working days` });
  }
  const allowances = lines.filter((l) => l.kind === 'allowance').reduce((a, l) => a + l.amount, 0);
  const deductions = r2(lines.filter((l) => l.kind === 'deduction').reduce((a, l) => a + l.amount, 0));
  const gross = r2(baseSalary + allowances);
  return { staffId: st.id, staffName: st.name, position: st.position, base: baseSalary, lines: JSON.stringify(lines), gross, deductions, net: r2(gross - deductions) };
}

export function buildHrApi(store: Store) {
  const r = Router();
  r.use(['/staff', '/staff-attendance', '/leave', '/payruns', '/payroll'], (req, _res, next) => { try { need(req, 'hr'); next(); } catch (e) { next(e); } });
  const log = (req: Request, action: string, summary: string, details?: unknown) => logActivity(store, req, { category: 'hr', action, summary, details });
  const staffOr404 = (id: number) => store.get('staff', id) ?? (() => { throw notFound('Staff member'); })();
  const today = () => appToday(store.settings());

  // ------------------------------------------------------------ staff
  const STAFF_COLS = ['name', 'position', 'department', 'phone', 'email', 'hireDate', 'status', 'teacherName', 'bankName', 'bankAccount', 'baseSalary', 'payItems', 'notes'];
  const checkStaff = (b: Record<string, any>) => {
    if (!str(b.name)) throw bad('Enter the name');
    if (b.hireDate && !isIso(b.hireDate)) throw bad('Start date is not valid');
    if (b.baseSalary !== null && b.baseSalary !== undefined && b.baseSalary !== '' && !(Number(b.baseSalary) >= 0)) throw bad('Base pay must be 0 or more');
    if (!['Active', 'On leave', 'Left'].includes(b.status ?? 'Active')) throw bad('Unknown status');
    if (b.payItems) {
      let list: any;
      try { list = typeof b.payItems === 'string' ? JSON.parse(b.payItems) : b.payItems; } catch { throw bad('Pay items are not valid'); }
      if (!Array.isArray(list)) throw bad('Pay items are not valid');
      for (const i of list) {
        if (!str(i.name) || !['allowance', 'deduction'].includes(i.kind) || !['fixed', 'percent'].includes(i.method)) throw bad('Each pay item needs a name, a kind and a method');
        if (i.amount !== null && !(Number(i.amount) >= 0)) throw bad(`${i.name}: amount must be 0 or more`);
      }
      b.payItems = JSON.stringify(list);
    }
  };
  r.get('/staff', h(() => {
    const yearStart = `${today().slice(0, 4)}-01-01`;
    const leave = store.all('leave', "WHERE status = 'Approved' AND toDate >= ?", yearStart);
    const files = filesOf(store, 'staff', store.all('staff').map((s) => s.id));
    return store.all('staff', "ORDER BY CASE status WHEN 'Left' THEN 1 ELSE 0 END, name").map((s) => ({
      ...s, leaveDaysThisYear: leave.filter((l) => l.staffId === s.id).reduce((a, l) => a + (l.days ?? 0), 0),
      files: files.filter((f) => f.ownerId === s.id), items: itemsFor(store, s),
    }));
  }));
  r.post('/staff', h((req) => {
    const b = { status: 'Active', ...pick(req.body, STAFF_COLS) }; checkStaff(b);
    const row = store.insert('staff', b);
    log(req, 'staff.create', `Added staff member ${row.name}${row.position ? ` (${row.position})` : ''}`);
    return row;
  }));
  r.post('/staff/from-teachers', h((req) => {
    const have = new Set(store.all('staff').map((s) => s.teacherName).filter(Boolean));
    const add = store.all('teachers', 'ORDER BY name').filter((t) => !have.has(t.name));
    store.tx(() => { for (const t of add) store.db.prepare("INSERT INTO staff (name, position, department, phone, email, status, teacherName) VALUES (?, 'Teacher', 'Teaching', ?, ?, 'Active', ?)").run(t.name, t.phone, t.email, t.name); });
    if (add.length) log(req, 'staff.import', `Added ${add.length} teachers as staff`);
    return { added: add.length };
  }));
  r.put('/staff/:id', h((req) => {
    const cur = staffOr404(+req.params.id);
    const b = { ...cur, ...pick(req.body, STAFF_COLS) }; checkStaff(b);
    const row = store.update('staff', cur.id, b)!;
    const changed = STAFF_COLS.filter((k) => String(cur[k] ?? '') !== String(row[k] ?? ''));
    if (changed.length) log(req, 'staff.update', `Edited staff member ${row.name}: ${changed.map((k) => k === 'baseSalary' ? `base pay ${cur.baseSalary ?? '–'} → ${row.baseSalary ?? '–'}` : k.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')}`);
    return row;
  }));
  r.delete('/staff/:id', h((req) => {
    need(req, 'admin');
    const cur = staffOr404(+req.params.id);
    if (store.all('payslips', 'WHERE staffId = ?', cur.id).length) throw bad(`${cur.name} has payslips: set their status to "Left" instead, to keep the payroll history`);
    store.tx(() => { for (const t of ['staffAttendance', 'leave']) store.db.prepare(`DELETE FROM ${t} WHERE staffId = ?`).run(cur.id); store.db.prepare('DELETE FROM staff WHERE id = ?').run(cur.id); });
    deleteFilesOf(store, 'staff', cur.id);
    log(req, 'staff.delete', `Deleted staff member ${cur.name}`, cur);
  }));

  // ------------------------------------------------------------ staff attendance
  r.get('/staff-attendance', h((req) => {
    const date = isIso(req.query.date) ? (req.query.date as string) : today();
    const marks = new Map(store.all('staffAttendance', 'WHERE date = ?', date).map((m) => [m.staffId, m]));
    const onLeave = new Set(store.all('leave', "WHERE status = 'Approved' AND fromDate <= ? AND toDate >= ?", date, date).map((l) => l.staffId));
    return {
      date, taken: marks.size > 0, holiday: holidayOn(store.settings(), date), weekend: weekday(dayNum(date)) > 5,
      staff: store.all('staff', "WHERE status != 'Left' ORDER BY name").map((s) => ({ id: s.id, name: s.name, position: s.position, mark: marks.get(s.id)?.mark ?? (onLeave.has(s.id) ? 'LV' : 'P'), note: marks.get(s.id)?.note ?? '', onLeave: onLeave.has(s.id) })),
    };
  }));
  r.post('/staff-attendance', h((req) => {
    const date = str(req.body?.date), marks = req.body?.marks;
    if (!isIso(date)) throw bad('Pick a date');
    if (date > today()) throw bad('Not for a future date');
    if (!Array.isArray(marks)) throw bad('No marks sent');
    const ids = new Set(store.all('staff').map((s) => s.id));
    let absent = 0;
    store.tx(() => {
      store.db.prepare('DELETE FROM staffAttendance WHERE date = ?').run(date);
      for (const m of marks) {
        if (!ids.has(Number(m.staffId))) continue;
        const mark = STAFF_MARKS.includes(m.mark) ? m.mark : 'P';
        if (mark === 'A') absent++;
        store.db.prepare('INSERT INTO staffAttendance (staffId, date, mark, note) VALUES (?, ?, ?, ?)').run(Number(m.staffId), date, mark, str(m.note) || null);
      }
    });
    log(req, 'staff.register', `Took the staff register for ${date}: ${absent} absent`);
    return { saved: marks.length };
  }));
  r.get('/staff-attendance/summary', h((req) => {
    const month = /^\d{4}-\d{2}$/.test(str(req.query.month)) ? str(req.query.month) : today().slice(0, 7);
    const { first, last } = monthBounds(month);
    const rows = store.all('staffAttendance', 'WHERE date >= ? AND date <= ?', first, last);
    const days = new Set(rows.map((x) => x.date)).size;
    return {
      month, days,
      staff: store.all('staff', "WHERE status != 'Left' ORDER BY name").map((s) => {
        const mine = rows.filter((x) => x.staffId === s.id);
        return { id: s.id, name: s.name, present: mine.filter((x) => x.mark === 'P' || x.mark === 'L').length, late: mine.filter((x) => x.mark === 'L').length, absent: mine.filter((x) => x.mark === 'A').length, leave: mine.filter((x) => x.mark === 'LV').length };
      }),
    };
  }));

  // ------------------------------------------------------------ leave
  r.get('/leave', h(() => store.all('leave', 'ORDER BY fromDate DESC LIMIT 300').map((l) => ({ ...l, staffName: store.get('staff', l.staffId)?.name ?? '?' }))));
  r.post('/leave', h((req) => {
    const b = pick(req.body, ['staffId', 'type', 'fromDate', 'toDate', 'reason']);
    const st = staffOr404(Number(b.staffId));
    if (!LEAVE_TYPES.includes(b.type)) throw bad('Pick the type of leave');
    if (!isIso(b.fromDate) || !isIso(b.toDate) || b.toDate < b.fromDate) throw bad('Check the dates');
    const days = workingDays(store, b.fromDate, b.toDate);
    if (!days) throw bad('Those dates have no working days');
    const clash = store.all('leave', "WHERE staffId = ? AND status != 'Rejected' AND fromDate <= ? AND toDate >= ?", st.id, b.toDate, b.fromDate)[0];
    if (clash) throw bad(`${st.name} already has ${clash.type.toLowerCase()} leave ${clash.fromDate} to ${clash.toDate}`);
    const row = store.insert('leave', { ...b, staffId: st.id, days, status: 'Pending' });
    log(req, 'leave.request', `${b.type} leave for ${st.name}: ${b.fromDate} to ${b.toDate} (${days} working days)`);
    return row;
  }));
  r.put('/leave/:id', h((req) => {
    const l = store.get('leave', +req.params.id) ?? (() => { throw notFound('Leave'); })();
    const status = str(req.body?.status);
    if (!['Approved', 'Rejected', 'Pending'].includes(status)) throw bad('Approve or reject');
    if (l.type === 'Unpaid' && store.all('payslips', `WHERE staffId = ? AND payrunId IN (SELECT id FROM payruns WHERE status != 'Draft' AND month BETWEEN ? AND ?)`, l.staffId, l.fromDate.slice(0, 7), l.toDate.slice(0, 7)).length)
      throw bad('This unpaid leave is in a month whose payroll is already approved');
    const row = store.update('leave', l.id, { status, decidedBy: status === 'Pending' ? null : req.user!.name })!;
    log(req, 'leave.decide', `${status} ${l.type.toLowerCase()} leave for ${store.get('staff', l.staffId)?.name} (${l.fromDate} to ${l.toDate})`);
    return row;
  }));
  r.delete('/leave/:id', h((req) => {
    const l = store.get('leave', +req.params.id) ?? (() => { throw notFound('Leave'); })();
    if (l.status === 'Approved' && !req.perms?.admin) throw forbidden('Only an admin can delete approved leave');
    store.remove('leave', l.id);
    log(req, 'leave.delete', `Deleted ${l.type.toLowerCase()} leave for ${store.get('staff', l.staffId)?.name} (${l.fromDate} to ${l.toDate})`, l);
  }));

  // ------------------------------------------------------------ payroll
  r.get('/payroll/items', h(() => store.settings().payItems ?? []));
  r.put('/payroll/items', h((req) => {
    need(req, 'admin');
    const list = req.body?.items;
    if (!Array.isArray(list)) throw bad('No items sent');
    for (const i of list) {
      if (!str(i.name) || !['allowance', 'deduction'].includes(i.kind) || !['fixed', 'percent'].includes(i.method) || !(Number(i.amount) >= 0)) throw bad(`Pay item "${i.name || '?'}": check its kind, method and amount`);
      if (i.method === 'percent' && Number(i.amount) > 100) throw bad(`${i.name}: a percentage cannot be over 100`);
    }
    const s = store.settings();
    store.saveSettings({ ...s, payItems: list.map((i: any) => ({ name: str(i.name), kind: i.kind, method: i.method, amount: Number(i.amount) })) });
    log(req, 'payroll.items', `Changed the school's pay items: ${list.map((i: any) => `${i.name} ${i.method === 'percent' ? `${i.amount}%` : i.amount}`).join(', ') || 'none'}`);
    return store.settings().payItems;
  }));

  const runOr404 = (id: number) => store.get('payruns', id) ?? (() => { throw notFound('Pay run'); })();
  const slips = (runId: number): Row[] => store.all('payslips', 'WHERE payrunId = ? ORDER BY staffName', runId).map((p) => ({ ...p, lines: JSON.parse(p.lines || '[]') }));
  const totals = (list: Row[]) => ({ gross: r2(list.reduce((a, p) => a + p.gross, 0)), deductions: r2(list.reduce((a, p) => a + p.deductions, 0)), net: r2(list.reduce((a, p) => a + p.net, 0)), count: list.length });
  const generate = (run: Row) => store.tx(() => {
    store.db.prepare('DELETE FROM payslips WHERE payrunId = ?').run(run.id);
    const active = store.all('staff', "WHERE status != 'Left' AND baseSalary > 0 ORDER BY name");
    for (const st of active) {
      const p = payslipFor(store, st, run.month);
      store.db.prepare('INSERT INTO payslips (payrunId, staffId, staffName, position, base, lines, gross, deductions, net) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(run.id, p.staffId, p.staffName, p.position ?? null, p.base, p.lines, p.gross, p.deductions, p.net);
    }
    return active.length;
  });

  r.get('/payruns', h(() => store.all('payruns', 'ORDER BY month DESC').map((p) => ({ ...p, ...totals(store.all('payslips', 'WHERE payrunId = ?', p.id)) }))));
  r.get('/payruns/:id', h((req) => {
    const run = runOr404(+req.params.id);
    const list = slips(run.id);
    const st = new Map(store.all('staff').map((s) => [s.id, s]));
    return { run, totals: totals(list), payslips: list.map((p) => ({ ...p, bankName: st.get(p.staffId)?.bankName ?? '', bankAccount: st.get(p.staffId)?.bankAccount ?? '' })) };
  }));
  r.post('/payruns', h((req) => {
    const month = str(req.body?.month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('Pick the month');
    if (store.all('payruns', 'WHERE month = ?', month).length) throw bad(`There is already a pay run for ${month}`);
    const run = store.insert('payruns', { month, status: 'Draft', createdBy: req.user!.name, createdAt: nowIso() });
    const n = generate(run);
    if (!n) { store.remove('payruns', run.id); throw bad('No active staff with a base pay: add pay to the staff records first'); }
    log(req, 'payrun.create', `Prepared the ${month} payroll (${n} payslips, net ${totals(store.all('payslips', 'WHERE payrunId = ?', run.id)).net})`);
    return run;
  }));
  r.post('/payruns/:id/recalculate', h((req) => {
    const run = runOr404(+req.params.id);
    if (run.status !== 'Draft') throw bad('Only a draft pay run can be recalculated');
    const n = generate(run);
    log(req, 'payrun.recalculate', `Recalculated the ${run.month} payroll (${n} payslips)`);
    return { count: n };
  }));
  r.post('/payruns/:id/approve', h((req) => {
    need(req, 'admin');
    const run = runOr404(+req.params.id);
    if (run.status !== 'Draft') throw bad('Already approved');
    store.update('payruns', run.id, { status: 'Approved', approvedBy: req.user!.name, approvedAt: nowIso() });
    log(req, 'payrun.approve', `Approved the ${run.month} payroll (net ${totals(store.all('payslips', 'WHERE payrunId = ?', run.id)).net}); payslips are now frozen`);
    return runOr404(run.id);
  }));
  r.post('/payruns/:id/paid', h((req) => {
    const run = runOr404(+req.params.id);
    if (run.status !== 'Approved') throw bad(run.status === 'Paid' ? 'Already marked paid' : 'An admin must approve it first');
    store.update('payruns', run.id, { status: 'Paid', paidAt: nowIso() });
    log(req, 'payrun.paid', `Marked the ${run.month} payroll as paid`);
    return runOr404(run.id);
  }));
  r.delete('/payruns/:id', h((req) => {
    const run = runOr404(+req.params.id);
    if (run.status !== 'Draft') throw bad('An approved pay run cannot be deleted');
    store.tx(() => { store.db.prepare('DELETE FROM payslips WHERE payrunId = ?').run(run.id); store.db.prepare('DELETE FROM payruns WHERE id = ?').run(run.id); });
    log(req, 'payrun.delete', `Deleted the draft ${run.month} payroll`);
  }));
  r.get('/payruns/:id/bank.csv', (req, res, next) => {
    try {
      need(req, 'hr');
      const run = runOr404(+req.params.id);
      const st = new Map(store.all('staff').map((s) => [s.id, s]));
      const cell = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = slips(run.id).map((p) => [p.staffName, st.get(p.staffId)?.bankName, st.get(p.staffId)?.bankAccount, p.net.toFixed(2)].map(cell).join(','));
      logActivity(store, req, { category: 'hr', action: 'payrun.bank', summary: `Downloaded the bank payment file for ${run.month}` });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="payroll-${run.month}-bank.csv"`);
      res.send('﻿' + ['Name,Bank,Account,Net pay', ...lines].join('\r\n'));
    } catch (e) { next(e); }
  });
  return r;
}

