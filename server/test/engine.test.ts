import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from './request.ts';
import { Store } from '../src/db.ts';
import { recalc, termMarks, weekday, dayNum } from '../src/engine.ts';
import { createApp } from '../src/app.ts';

/** A tiny school: one class of three learners, Term 2 (previous) and Term 3 (current), "today" pinned to 2026-09-16. */
function school(overrides: Record<string, any> = {}) {
  const store = new Store(':memory:');
  store.load({
    settings: {
      schoolName: 'Test School', schoolContact: 'x', currencySymbol: '$', currencyDecimals: 0, useFees: true,
      lateCountsPresent: true, riskAttendance: 0.9, riskDrop: 5, principal: 'P', currentTerm: 'Term 3',
      sampleMode: true, sampleAnchor: '2026-09-16',
      grades: [{ name: 'Grade 1', tuition: 300, books: 50 }], optionalFees: [{ name: 'Lunch', amount: 70 }],
      assessmentTypes: [{ name: 'Test', weight: 40 }, { name: 'Exam', weight: 60 }],
      subjects: ['Maths', 'English'], gradeBands: [{ band: 'A', from: 80, meaning: '' }, { band: 'B', from: 0, meaning: '' }],
      terms: [
        { name: 'Term 2', start: '2026-04-27', end: '2026-07-31', feesDue: '2026-05-15' },
        { name: 'Term 3', start: '2026-09-07', end: '2026-12-04', feesDue: '2026-09-11' },
      ],
      holidays: [{ name: 'Founders', type: 'Public holiday', date: '2026-09-14' }], keyDates: [], payMethods: ['Cash'],
      studentStatuses: ['Active', 'Left'], relationships: [], genders: [], streams: [],
      templates: { absent: { subject: '{First} absent', body: 'Dear {Guardian}' }, risk: { subject: '', body: '{Details}' }, report: { subject: '', body: '' }, fees: { subject: '{Overdue}', body: '' } },
      ...overrides,
    },
    classes: [{ id: 1, name: '1A', grade: 'Grade 1', stream: 'A', teacher: 'Ms. G' }],
    students: [
      { id: 1, firstName: 'Ann', lastName: 'A', className: '1A', status: 'Active', optionalFees: 'lunch' },
      { id: 2, firstName: 'Ben', lastName: 'B', className: '1A', status: 'Active' },
      { id: 3, firstName: 'Cat', lastName: 'C', className: '1A', status: 'Left' },
    ],
    registers: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-15', '2026-09-16']
      .map((date, i) => ({ id: i + 1, date, className: '1A', present: 2, enrolled: 2 })),
    attendance: [
      { id: 1, learnerId: 2, date: '2026-09-08', className: '1A', mark: 'A' },
      { id: 2, learnerId: 2, date: '2026-09-09', className: '1A', mark: 'E' },
      { id: 3, learnerId: 2, date: '2026-09-10', className: '1A', mark: 'L' },
      { id: 4, learnerId: 2, date: '2026-07-01', className: '1A', mark: 'A' }, // another term: ignored
    ],
    assessments: [
      { id: 1, term: 'Term 3', className: '1A', subject: 'Maths', name: 'Test', weight: 40, outOf: 50 },
      { id: 2, term: 'Term 3', className: '1A', subject: 'Maths', name: 'Exam', weight: 60, outOf: 100 },
      { id: 3, term: 'Term 3', className: '1A', subject: 'English', name: 'Exam', weight: 60, outOf: 100 },
      { id: 4, term: 'Term 2', className: '1A', subject: 'Maths', name: 'Exam', weight: 100, outOf: 100 },
    ],
    marks: [[1, 1, 1, 40], [2, 2, 1, 70], [3, 3, 1, 90], [4, 4, 1, 90], [5, 2, 2, 50], [6, 4, 2, 52]],
    payments: [{ id: 1, studentId: 1, receiptNo: 'R-2026-0001', date: '2026-09-07', term: 'Term 3', amount: 420, method: 'Cash' }],
    paymentPlans: [],
  });
  return store;
}

test('weekday: 2026-09-07 is a Monday', () => {
  assert.equal(weekday(dayNum('2026-09-07')), 1);
  assert.equal(weekday(dayNum('2026-09-13')), 7);
});

test('term marks are weighted by assessment and scaled by "out of", rounded half up', () => {
  const s = school();
  const tm = termMarks(s, s.settings(), 'Term 3');
  // Maths: (40 * 40/50*100 + 60 * 70) / 100 = (3200 + 4200) / 100 = 74
  assert.deepEqual(tm.get(1), { Maths: 74, English: 90 });
  assert.deepEqual(tm.get(2), { Maths: 50 });
});

test('attendance: A and E are absent, L counts as present unless switched off', () => {
  let c = recalc(school());
  const ben = c.byId.get(2)!;
  assert.equal(ben.taken, 7);
  assert.equal(ben.absent, 2);
  assert.equal(ben.late, 1);
  assert.equal(ben.present, 5);
  assert.ok(Math.abs(ben.att! - 5 / 7) < 1e-9);
  c = recalc(school({ lateCountsPresent: false }));
  assert.equal(c.byId.get(2)!.present, 4);
});

test('fees: grade fees + optional fees; overdue after the due date', () => {
  const c = recalc(school());
  const ann = c.byId.get(1)!, ben = c.byId.get(2)!;
  assert.equal(ann.billed, 420); // 300 + 50 + Lunch 70 ("lunch" matches any case)
  assert.equal(ann.balance, 0);
  assert.equal(ann.feeStatus, 'Paid');
  assert.equal(ben.billed, 350);
  assert.equal(ben.overdue, 350);
  assert.equal(ben.feeStatus, 'Unpaid · 5 days');
});

test('a payment plan that is on time stops fees being overdue', () => {
  const s = school();
  s.insert('paymentPlans', { studentId: 2, term: 'Term 3', agreedOn: '2026-09-10', instalment: 100, nextDue: '2026-09-30' });
  const ben = recalc(s).byId.get(2)!;
  assert.equal(ben.overdue, 0);
  assert.equal(ben.feeStatus, 'Plan · next 09/30');
});

test('flags: low attendance + average drop + overdue fees = at risk; inactive learners ignored', () => {
  const c = recalc(school());
  const ben = c.byId.get(2)!;
  // avg 50 vs 52 last term: -2 is not a drop of 5, so 2 flags (attendance, fees)
  assert.deepEqual(ben.reasons, ['attendance', 'fees']);
  assert.deepEqual(c.riskIds, [2]);
  assert.equal(c.kpis.learners, 2);
  assert.equal(c.byId.get(3)!.active, false);
  assert.equal(c.byId.get(1)!.pos, 1);
  assert.equal(c.byId.get(2)!.pos, 2);
});

test('fees switched off: no bills and only two possible flags', () => {
  const c = recalc(school({ useFees: false }));
  assert.equal(c.byId.get(2)!.billed, 0);
  assert.equal(c.flagMax, 2);
  assert.deepEqual(c.riskIds, []);
});

test('API: save a register, then the engine sees it', async () => {
  const store = school();
  const app = createApp(store);
  const get = await request(app, 'GET', '/api/register?class=1A&date=2026-09-16');
  assert.equal(get.status, 200);
  assert.equal(get.body.learners.length, 2); // the learner who left is not on the register
  assert.equal(get.body.prevDay, '2026-09-15');
  assert.equal(get.body.nextDay, '2026-09-17');
  const save = await request(app, 'POST', '/api/register', { className: '1A', date: '2026-09-16', marks: [{ learnerId: 1, mark: 'A' }, { learnerId: 2, mark: 'P' }] });
  assert.deepEqual(save.body, { present: 1, enrolled: 2 });
  assert.equal(recalc(store).byId.get(1)!.absent, 1);
  const future = await request(app, 'POST', '/api/register', { className: '1A', date: '2026-09-17', marks: [] });
  assert.equal(future.status, 400);
});

test('API: payments get the next receipt number and validation errors are 400s', async () => {
  const app = createApp(school());
  const ok = await request(app, 'POST', '/api/payments', { studentId: 2, amount: 100, method: 'Cash' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.receiptNo, 'R-2026-0002');
  assert.equal(ok.body.term, 'Term 3');
  const badAmt = await request(app, 'POST', '/api/payments', { studentId: 2, amount: -5 });
  assert.equal(badAmt.status, 400);
  const fees = await request(app, 'GET', '/api/fees?class=1A');
  assert.equal(fees.body.learners.find((l: any) => l.id === 2).balance, 250);
});

test('API: marks over "out of" are rejected; messages fill template tags', async () => {
  const app = createApp(school());
  const r = await request(app, 'PUT', '/api/marks', { marks: [{ assessmentId: 1, learnerId: 2, mark: 60 }] });
  assert.equal(r.status, 400);
  const m = await request(app, 'POST', '/api/messages', { kind: 'absent', learnerIds: [2] });
  assert.equal(m.body[0].subject, 'Ben absent');
  assert.equal(m.body[0].body, 'Dear Parent / Guardian');
});
