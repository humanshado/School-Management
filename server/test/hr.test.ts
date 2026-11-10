import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store, SAMPLE_FILE } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import request, { client } from './request.ts';

async function school() {
  const store = new Store(':memory:');
  store.load(JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')));
  const app = createApp(store);
  const admin = (m: string, p: string, b?: unknown) => request(app, m, p, b);
  await admin('GET', '/api/meta');
  await admin('POST', '/api/users', { username: 'bursar', name: 'Mr. Bursar', role: 'bursar', password: 'password-123' });
  await admin('POST', '/api/users', { username: 'tch', name: 'Teacher', role: 'teacher', password: 'password-123' });
  const as = async (u: string) => { const c = client(app); await c('POST', '/api/auth/login', { username: u, password: 'password-123' }); return c; };
  return { store, app, admin, as };
}

test('payroll: pay items, staff overrides, unpaid leave; draft -> approved (frozen) -> paid', async () => {
  const { admin, as } = await school();
  const b = await as('bursar');
  assert.equal((await b('PUT', '/api/payroll/items', { items: [] })).status, 403, 'only an admin sets the pay items');
  await admin('PUT', '/api/payroll/items', { items: [
    { name: 'Housing', kind: 'allowance', method: 'percent', amount: 10 },
    { name: 'Pension', kind: 'deduction', method: 'percent', amount: 8 },
    { name: 'PAYE', kind: 'deduction', method: 'percent', amount: 7.5 },
  ] });
  const ann = (await b('POST', '/api/staff', { name: 'Ann', position: 'Teacher', baseSalary: 1000, bankName: 'First Bank', bankAccount: '0123' })).body;
  // Ben has no pension and an extra fixed allowance
  const ben = (await b('POST', '/api/staff', { name: 'Ben', position: 'Driver', baseSalary: 500, payItems: [{ name: 'Pension', kind: 'deduction', method: 'percent', amount: null }, { name: 'Uniform', kind: 'allowance', method: 'fixed', amount: 20 }] })).body;
  // Ann: 2 days unpaid leave in Nov 2026 (Mon 9, Tue 10); 21 working days in Nov (Founders' Day 20th and the 30th are holidays -> 19)
  const lv = (await b('POST', '/api/leave', { staffId: ann.id, type: 'Unpaid', fromDate: '2026-11-07', toDate: '2026-11-10', reason: 'family' })).body;
  assert.equal(lv.days, 2, 'the weekend is not counted');
  await b('PUT', `/api/leave/${lv.id}`, { status: 'Approved' });
  const run = (await b('POST', '/api/payruns', { month: '2026-11' })).body;
  assert.equal(run.status, 'Draft');
  const view = (await b('GET', `/api/payruns/${run.id}`)).body;
  const a = view.payslips.find((p: any) => p.staffName === 'Ann'), n = view.payslips.find((p: any) => p.staffName === 'Ben');
  // Ann: gross 1100; deductions 80 + 75 + unpaid 1000/19*2 = 105.26 -> 260.26; net 839.74
  assert.equal(a.gross, 1100);
  assert.equal(a.deductions, 260.26);
  assert.equal(a.net, 839.74);
  assert.ok(a.lines.some((l: any) => l.name === 'Unpaid leave' && l.note === '2 of 19 working days'));
  // Ben: gross 500 + 50 + 20 = 570; deductions PAYE 37.5; net 532.5
  assert.deepEqual([n.gross, n.deductions, n.net], [570, 37.5, 532.5]);
  assert.equal(view.totals.net, 1372.24);
  assert.match((await b('POST', '/api/payruns', { month: '2026-11' })).body.error, /already a pay run/);
  // approval is admin-only; then it is frozen
  assert.equal((await b('POST', `/api/payruns/${run.id}/approve`)).status, 403);
  assert.equal((await admin('POST', `/api/payruns/${run.id}/approve`)).status, 200);
  assert.match((await b('POST', `/api/payruns/${run.id}/recalculate`)).body.error, /draft/);
  assert.match((await b('DELETE', `/api/payruns/${run.id}`)).body.error, /cannot be deleted/);
  assert.match((await b('PUT', `/api/leave/${lv.id}`, { status: 'Rejected' })).body.error, /already approved/);
  assert.equal((await b('POST', `/api/payruns/${run.id}/paid`)).body.status, 'Paid');
  assert.match((await admin('DELETE', `/api/staff/${ann.id}`)).body.error, /payslips/);
  void ben;
});

test('HR is private: teachers and parents cannot see staff, salaries or payroll', async () => {
  const { as } = await school();
  const t = await as('tch');
  for (const p of ['/api/staff', '/api/payruns', '/api/leave', '/api/staff-attendance', '/api/payroll/items']) assert.equal((await t('GET', p)).status, 403, p);
});

test('staff register: approved leave shows as LV; teachers can be added as staff', async () => {
  const { admin } = await school();
  assert.equal((await admin('POST', '/api/staff/from-teachers')).body.added, 18);
  assert.equal((await admin('POST', '/api/staff/from-teachers')).body.added, 0, 'only once');
  const staff = (await admin('GET', '/api/staff')).body;
  const s1 = staff[0];
  const lv = (await admin('POST', '/api/leave', { staffId: s1.id, type: 'Sick', fromDate: '2026-11-04', toDate: '2026-11-04' })).body;
  await admin('PUT', `/api/leave/${lv.id}`, { status: 'Approved' });
  const reg = (await admin('GET', '/api/staff-attendance?date=2026-11-04')).body;
  assert.equal(reg.staff.find((x: any) => x.id === s1.id).mark, 'LV');
  assert.match((await admin('POST', '/api/leave', { staffId: s1.id, type: 'Annual', fromDate: '2026-11-03', toDate: '2026-11-05' })).body.error, /already has sick leave/);
  const marks = reg.staff.map((x: any) => ({ staffId: x.id, mark: x.id === staff[1].id ? 'A' : x.mark }));
  assert.equal((await admin('POST', '/api/staff-attendance', { date: '2026-11-04', marks })).status, 200);
  const sum = (await admin('GET', '/api/staff-attendance/summary?month=2026-11')).body;
  assert.equal(sum.staff.find((x: any) => x.id === staff[1].id).absent, 1);
});
