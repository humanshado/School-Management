import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store, SAMPLE_FILE } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { bandPoints, gpaOf } from '../src/analytics.ts';
import request, { client } from './request.ts';

async function school() {
  const store = new Store(':memory:');
  store.load(JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')));
  const app = createApp(store);
  const admin = (m: string, p: string, b?: unknown) => request(app, m, p, b);
  await admin('GET', '/api/meta');
  return { store, app, admin };
}

test('GPA: A=4 ... E=0 unless the band has its own points', async () => {
  const { store } = await school();
  const s = store.settings();
  assert.deepEqual([85, 72, 65, 55, 10].map((m) => bandPoints(s, m)), [4, 3, 2, 1, 0]);
  assert.equal(gpaOf(s, { Maths: 85, English: 55 }), 2.5);
  s.gradeBands[0].points = 5;
  assert.equal(bandPoints(s, 90), 5);
  assert.equal(gpaOf(s, {}), null);
});

test('report cards and the gradebook carry the GPA', async () => {
  const { admin } = await school();
  const rc = (await admin('GET', '/api/report-cards?class=6B&term=Term%203')).body.cards[0];
  assert.equal(typeof rc.gpa, 'number');
  assert.equal(typeof rc.gpaCumulative, 'number');
  assert.ok(rc.gpa >= 0 && rc.gpa <= 4);
  const gb = (await admin('GET', '/api/gradebook?class=6B&term=Term%203')).body;
  assert.ok(gb.learners.every((l: any) => typeof l.gpa === 'number'));
});

test('invoices list the fee items; the statement balance matches the engine', async () => {
  const { admin } = await school();
  // learner 1 (1A, Grade 1) takes Lunch and Transport: 350 + 45 + 75 + 90 = 560
  const inv = (await admin('GET', '/api/fees/invoices?learner=1&term=Term%203')).body[0];
  assert.deepEqual(inv.lines.map((l: any) => [l.item, l.amount]), [['Tuition · Grade 1', 350], ['Books & activities', 45], ['Lunch', 75], ['Transport', 90]]);
  assert.equal(inv.total, 560);
  assert.equal(inv.invoiceNo, 'INV-Term3-S-1A-01');
  const st = (await admin('GET', '/api/fees/statement/1')).body;
  const fees = (await admin('GET', '/api/fees?class=1A')).body.learners.find((l: any) => l.id === 1);
  // payments are only recorded from Term 3, so the statement starts there: earlier terms are never shown as unpaid
  assert.equal(st.rows.filter((r: any) => r.charge).length, 1);
  assert.equal(st.balance, inv.balance);
  assert.equal(st.balance, st.rows.reduce((a: number, r: any) => a + r.charge - r.payment, 0));
  assert.equal(st.rows.at(-1).balance, st.balance);
  assert.equal(inv.balance, fees.balance, 'this term\'s invoice balance = the Fees screen');
  const cls = (await admin('GET', '/api/fees/invoices?class=1A')).body;
  assert.equal(cls.length, 20);
});

test('reports: each role sees only its reports; figures add up', async () => {
  const { app, admin } = await school();
  const list = (await admin('GET', '/api/reports')).body.map((r: any) => r.id);
  assert.deepEqual(list, ['enrolment', 'attendance', 'attendance-trend', 'subjects', 'performers', 'academic-trend', 'collections', 'arrears', 'fees-by-class', 'admissions', 'library', 'transport', 'staff']);
  for (const id of list) assert.equal((await admin('GET', `/api/reports/${id}`)).status, 200, id);
  const en = (await admin('GET', '/api/reports/enrolment')).body;
  assert.equal(en.kpis[0].value, 280);
  assert.equal(en.tables[0].rows.reduce((a: number, r: any) => a + r.total, 0), 280);
  const ar = (await admin('GET', '/api/reports/arrears')).body;
  const fees = (await admin('GET', '/api/fees')).body;
  assert.equal(ar.kpis[0].value, fees.learners.filter((l: any) => l.balance > 0.005).reduce((a: number, l: any) => a + l.balance, 0));
  assert.equal(ar.tables[0].rows.reduce((a: number, r: any) => a + r.n, 0), ar.tables[1].rows.length, 'every debtor is in one age bucket');
  const col = (await admin('GET', '/api/reports/collections?from=2026-01-01&to=2026-12-31')).body;
  assert.equal(col.kpis[1].value, 418, 'every sample payment');
  await admin('POST', '/api/users', { username: 'tch', name: 'T', role: 'teacher', password: 'password-123' });
  const t = client(app); await t('POST', '/api/auth/login', { username: 'tch', password: 'password-123' });
  const tl = (await t('GET', '/api/reports')).body.map((r: any) => r.id);
  assert.deepEqual(tl, ['enrolment', 'attendance', 'attendance-trend', 'subjects', 'performers', 'academic-trend']);
  assert.equal((await t('GET', '/api/reports/arrears')).status, 403);
  assert.equal((await t('GET', '/api/fees/statement/1')).status, 403);
});

test('families can open their own invoice and statement only', async () => {
  const { app, admin } = await school();
  await admin('POST', '/api/users', { username: 'mum', name: 'Mum', role: 'parent', learnerIds: [1], password: 'password-123' });
  const p = client(app); await p('POST', '/api/auth/login', { username: 'mum', password: 'password-123' });
  assert.equal((await p('GET', '/api/portal/learners/1/invoice')).body.total, 560);
  assert.equal((await p('GET', '/api/portal/learners/1/statement')).status, 200);
  assert.equal((await p('GET', '/api/portal/learners/2/statement')).status, 403);
});

test('the sample school\'s demo data is consistent (no clashes; payroll runs)', async () => {
  const { loadSample } = await import('../src/db.ts');
  const store = new Store(':memory:');
  loadSample(store);
  const app = createApp(store);
  const admin = (m: string, p: string, b?: unknown) => request(app, m, p, b);
  await admin('GET', '/api/meta');
  const tt = store.all('timetable');
  assert.equal(tt.length, 14 * 40);
  const slot = new Set<string>();
  for (const l of tt) { const k = `${l.teacher}|${l.day}|${l.period}`; assert.ok(!slot.has(k), `teacher clash ${k}`); slot.add(k); }
  assert.ok(store.all('riders').length > 0);
  assert.equal((await admin('GET', '/api/routes')).body.items.flatMap((r: any) => r.riders).filter((x: any) => !x.billed).length, 0, 'every rider pays the transport fee');
  const run = await admin('POST', '/api/payruns', { month: '2026-11' });
  assert.equal(run.status, 200);
  assert.equal((await admin('GET', `/api/payruns/${run.body.id}`)).body.totals.count, 25);
  // an exam can be edited without tripping over the others
  const ex = store.all('exams')[0];
  assert.equal((await admin('PUT', `/api/exams/${ex.id}`, { notes: 'Bring a calculator' })).status, 200);
  assert.equal((await admin('GET', '/api/loans?status=overdue')).body.length, 2, 'due 26 Oct and 15 Oct; the one due today is not late yet');
});
