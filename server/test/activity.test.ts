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
  await admin('POST', '/api/users', { username: 'hana', name: 'Ms. Hana', role: 'teacher', teacherName: 'Ms. Hana', password: 'password-123' });
  const as = async (username: string) => {
    const c = client(app);
    assert.equal((await c('POST', '/api/auth/login', { username, password: 'password-123' })).status, 200);
    return c;
  };
  const latest = async (filter = '') => (await admin('GET', `/api/activity?limit=1${filter}`)).body.items[0];
  return { store, app, admin, as, latest };
}

test('payments: who recorded, edited and deleted each one, with the deleted payment kept', async () => {
  const { admin, as, latest } = await school();
  const b = await as('bursar');
  const pay = (await b('POST', '/api/payments', { studentId: 1, amount: 120, method: 'Cash' })).body;
  let e = await latest();
  assert.equal(e.userName, 'Mr. Bursar');
  assert.equal(e.role, 'bursar');
  assert.equal(e.category, 'fees');
  assert.equal(e.learnerId, 1);
  assert.match(e.summary, new RegExp(`^Recorded payment ${pay.receiptNo}: \\$120 for Xavier B\\. \\(1A\\), Term 3, Cash$`));
  await b('PUT', `/api/payments/${pay.id}`, { amount: 100 });
  e = await latest();
  assert.equal(e.action, 'payment.update');
  assert.deepEqual(e.details, { amount: [120, 100] });
  assert.match(e.summary, /amount \(120 → 100\)/);
  await b('DELETE', `/api/payments/${pay.id}`);
  e = await latest();
  assert.equal(e.action, 'payment.delete');
  assert.equal(e.details.receiptNo, pay.receiptNo);
  assert.equal(e.details.amount, 100);
  // a learner's history shows all three
  const hist = (await admin('GET', '/api/activity?learnerId=1')).body.items.map((x: any) => x.action);
  assert.deepEqual(hist.slice(0, 3), ['payment.delete', 'payment.update', 'payment.create']);
});

test('registers: first save, then only the marks that changed; a re-save with no change adds nothing', async () => {
  const { as, latest } = await school();
  const t = await as('hana');
  const reg = (await t('GET', '/api/register?class=6A&date=2026-11-01')).body; // a Sunday in the past: no register yet
  const marks = reg.learners.map((l: any) => ({ learnerId: l.id, mark: 'P' }));
  marks[0].mark = 'A';
  await t('POST', '/api/register', { className: '6A', date: '2026-11-01', marks });
  let e = await latest();
  assert.equal(e.action, 'register.take');
  assert.equal(e.userName, 'Ms. Hana');
  assert.match(e.summary, new RegExp(`^Took the register for 6A on 2026-11-01: ${marks.length - 1} of ${marks.length} present \\(${reg.learners[0].name} A\\)$`));
  marks[0].mark = 'L';
  await t('POST', '/api/register', { className: '6A', date: '2026-11-01', marks });
  e = await latest();
  assert.equal(e.action, 'register.change');
  assert.deepEqual(e.details.changes, [{ learner: reg.learners[0].name, from: 'A', to: 'L' }]);
  const id = e.id;
  await t('POST', '/api/register', { className: '6A', date: '2026-11-01', marks });
  assert.equal((await latest()).id, id, 'nothing new logged');
});

test('marks: only changed marks are logged, with the old value', async () => {
  const { as, latest } = await school();
  const t = await as('hana');
  const a = (await t('GET', '/api/assessments?class=6A&term=Term%203&subject=Maths')).body;
  const l = a.learners[0], aid = a.assessments[0].id, old = l.marks[aid];
  await t('PUT', '/api/marks', { marks: [{ assessmentId: aid, learnerId: l.id, mark: old }, { assessmentId: aid, learnerId: l.id, mark: old }] });
  const before = await latest();
  assert.notEqual(before.action, 'marks.save', 'unchanged marks are not logged');
  await t('PUT', '/api/marks', { marks: [{ assessmentId: aid, learnerId: l.id, mark: old === 50 ? 51 : 50 }] });
  const e = await latest();
  assert.equal(e.action, 'marks.save');
  assert.deepEqual(e.details, [{ assessment: `6A Maths ${a.assessments[0].name}`, learner: l.name, from: old, to: old === 50 ? 51 : 50 }]);
  assert.match(e.summary, /^Saved 1 mark in 6A Maths \(1 changed from an earlier mark: /);
});

test('logins: success and failure are logged, passwords never are', async () => {
  const { app, admin, latest } = await school();
  const c = client(app);
  await c('POST', '/api/auth/login', { username: 'bursar', password: 'not-the-password' });
  let e = await latest();
  assert.equal(e.action, 'login.failed');
  assert.equal(e.userName, 'Mr. Bursar');
  await c('POST', '/api/auth/login', { username: 'ghost', password: 'whatever-1' });
  e = await latest();
  assert.equal(e.userId, null);
  assert.match(e.summary, /no user called "ghost"/);
  await c('POST', '/api/auth/login', { username: 'bursar', password: 'password-123' });
  assert.equal((await latest()).action, 'login');
  const everything = JSON.stringify((await admin('GET', '/api/activity?limit=100')).body);
  for (const pw of ['password-123', 'not-the-password', 'whatever-1', 'admin-pass-1']) assert.ok(!everything.includes(pw), `${pw} leaked`);
  assert.ok(!everything.includes('scrypt$'));
});

test('only admins can read the log; nobody can change or delete it; clearing data keeps it', async () => {
  const { admin, as, latest } = await school();
  const b = await as('bursar');
  assert.equal((await b('GET', '/api/activity')).status, 403);
  assert.equal((await b('GET', '/api/activity.csv')).status, 403);
  assert.equal((await admin('DELETE', '/api/activity')).status, 404);
  assert.equal((await admin('PUT', '/api/activity/1', {})).status, 404);
  const n = (await admin('GET', '/api/activity?limit=100')).body.items.length;
  await admin('POST', '/api/admin/clear-data');
  const after = (await admin('GET', '/api/activity?limit=100')).body.items;
  assert.equal(after.length, n + 1);
  assert.equal((await latest()).action, 'data.clear');
});

test('settings and learner edits list what changed; filters and CSV work', async () => {
  const { app, admin, latest } = await school();
  await admin('PUT', '/api/settings', { schoolName: 'New Name Academy', riskDrop: 6 });
  let e = await latest();
  assert.equal(e.category, 'settings');
  assert.match(e.summary, /school name \(Alder Valley Academy → New Name Academy\)/);
  assert.match(e.summary, /at-risk drop \(5 → 6\)/);
  await admin('PUT', '/api/students/2', { guardianPhone: '=HYPERLINK("x")' });
  e = await latest();
  assert.equal(e.action, 'student.update');
  assert.match(e.summary, /^Edited learner Dina I\.: guardian phone/);
  const f = (await admin('GET', '/api/activity?category=settings')).body;
  assert.ok(f.items.every((x: any) => x.category === 'settings') && f.items.length >= 1);
  assert.equal((await admin('GET', '/api/activity?q=Dina')).body.items[0].action, 'student.update');
  // CSV: a formula typed into a field cannot run when the file is opened in Excel
  const csv = await (async () => {
    const server = app.listen(0);
    try {
      const { port } = server.address() as any;
      const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ username: 'admin', password: 'admin-pass-1' }) });
      const cookie = login.headers.getSetCookie()[0].split(';')[0];
      const r = await fetch(`http://127.0.0.1:${port}/api/activity.csv?category=students`, { headers: { Cookie: cookie } });
      assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
      return r.text();
    } finally { server.close(); }
  })();
  const lines = csv.trim().split('\r\n');
  assert.match(lines[0], /When \(UTC\),Who,Role,Area/);
  assert.ok(lines.length >= 2);
  assert.ok(!/,=HYPERLINK/.test(csv) && !/,"=HYPERLINK/.test(csv), 'formula is neutralised');
});
