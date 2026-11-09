import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store, SAMPLE_FILE } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import request, { client } from './request.ts';

/** The sample school; Ms. Hana teaches 6A, Mr. Samuel 6B. */
function sampleApp() {
  const store = new Store(':memory:');
  store.load(JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')));
  return createApp(store);
}

async function withUsers() {
  const app = sampleApp();
  await request(app, 'GET', '/api/meta'); // sets up the admin
  const add = (u: any) => request(app, 'POST', '/api/users', { password: 'password-123', ...u });
  assert.equal((await add({ username: 'hana', name: 'Ms. Hana', role: 'teacher', teacherName: 'Ms. Hana' })).status, 200);
  assert.equal((await add({ username: 'floater', name: 'Supply Teacher', role: 'teacher' })).status, 200);
  assert.equal((await add({ username: 'bursar', name: 'Bursar', role: 'bursar' })).status, 200);
  const as = async (username: string) => {
    const c = client(app);
    const r = await c('POST', '/api/auth/login', { username, password: 'password-123' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return c;
  };
  return { app, as };
}

test('first run: setup creates the admin once; everything else needs a login', async () => {
  const app = sampleApp();
  const c = client(app);
  assert.deepEqual((await c('GET', '/api/auth/status')).body, { needsSetup: true, user: null });
  assert.equal((await c('GET', '/api/students')).status, 401);
  assert.equal((await c('POST', '/api/auth/setup', { username: 'x', name: 'A', password: 'short' })).status, 400);
  const ok = await c('POST', '/api/auth/setup', { username: 'Head', name: 'Head', password: 'long-enough-1' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, 'admin');
  assert.equal(ok.body.user.username, 'head');
  assert.match(ok.cookies[0], /HttpOnly/);
  assert.equal((await c('GET', '/api/students')).status, 200);
  assert.equal((await client(app)('POST', '/api/auth/setup', { username: 'evil', name: 'E', password: 'long-enough-1' })).status, 403);
});

test('login: wrong password is refused, then locked after 5 tries; logout ends the session', async () => {
  const app = sampleApp();
  await request(app, 'GET', '/api/meta');
  const c = client(app);
  assert.equal((await c('POST', '/api/auth/login', { username: 'nobody', password: 'x' })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await c('POST', '/api/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
  const locked = await c('POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-1' });
  assert.equal(locked.status, 429);
  // the lock is per username and address; the admin's existing session is unaffected, and logout ends it
  assert.equal((await request(app, 'GET', '/api/meta')).status, 200);
  assert.equal((await request(app, 'POST', '/api/auth/logout')).status, 200);
  assert.equal((await request(app, 'GET', '/api/meta')).status, 401);
});

test('changing requests without the app header are blocked (cross-site forms)', async () => {
  const app = sampleApp();
  const c = client(app, { csrfHeader: false });
  assert.equal((await c('POST', '/api/auth/setup', { username: 'admin', name: 'A', password: 'long-enough-1' })).status, 403);
});

test('teacher: own class only for registers and marks; no fees anywhere', async () => {
  const { as } = await withUsers();
  const t = await as('hana');
  const meta = (await t('GET', '/api/meta')).body;
  assert.deepEqual(meta.perms.classes, ['6A']);
  assert.equal(meta.kpis.billed, null);
  const reg = await t('GET', '/api/register?class=6B&date=2026-11-04');
  assert.equal(reg.status, 200);
  assert.equal(reg.body.canEdit, false);
  const marks = [{ learnerId: reg.body.learners[0].id, mark: 'P' }];
  assert.equal((await t('POST', '/api/register', { className: '6B', date: '2026-11-04', marks })).status, 403);
  const own = await t('GET', '/api/register?class=6A&date=2026-11-04');
  const save = await t('POST', '/api/register', { className: '6A', date: '2026-11-04', marks: own.body.learners.map((l: any) => ({ learnerId: l.id, mark: 'P' })) });
  assert.equal(save.status, 200);
  assert.equal((await t('GET', '/api/register?class=6A&date=2026-11-04')).body.takenBy, 'Ms. Hana');
  const a6b = (await t('GET', '/api/assessments?class=6B&term=Term%203&subject=Maths')).body.assessments[0];
  assert.equal((await t('PUT', '/api/marks', { marks: [{ assessmentId: a6b.id, learnerId: 1, mark: 50 }] })).status, 403);
  assert.equal((await t('GET', '/api/fees')).status, 403);
  assert.equal((await t('POST', '/api/payments', { studentId: 1, amount: 5 })).status, 403);
  const st = (await t('GET', '/api/students')).body.find((x: any) => x.stats.overdue === null);
  assert.ok(st, 'fee figures are hidden');
  assert.equal(st.stats.balance, null);
  assert.equal((await t('GET', `/api/students/${st.id}`)).body.payments.length, 0);
  assert.equal((await t('POST', '/api/students', { firstName: 'A', lastName: 'B', className: '6A' })).status, 403);
  assert.equal((await t('PUT', '/api/settings', { schoolName: 'X' })).status, 403);
  assert.equal((await t('GET', '/api/users')).status, 403);
  assert.equal((await t('PUT', '/api/comments', { learnerId: st.id, term: 'Term 3', principalComment: 'x' })).status, 403);
});

test('teacher with no linked teacher works on every class', async () => {
  const { as } = await withUsers();
  const t = await as('floater');
  assert.equal((await t('GET', '/api/meta')).body.perms.classes, null);
  assert.equal((await t('GET', '/api/register?class=6B&date=2026-11-04')).body.canEdit, true);
});

test('bursar: fees yes, registers and marks no', async () => {
  const { as } = await withUsers();
  const b = await as('bursar');
  assert.equal((await b('GET', '/api/fees')).status, 200);
  const pay = await b('POST', '/api/payments', { studentId: 1, amount: 10, method: 'Cash' });
  assert.equal(pay.status, 200);
  assert.equal((await b('GET', '/api/register?class=6A')).status, 403);
  assert.equal((await b('GET', '/api/gradebook?class=6A')).status, 403);
  assert.equal((await b('POST', '/api/messages', { kind: 'fees', learnerIds: [1] })).status, 200);
  assert.equal((await b('POST', '/api/messages', { kind: 'absent', learnerIds: [1] })).status, 403);
});

test('users: there is always an active admin; resets sign the person out', async () => {
  const { app, as } = await withUsers();
  const users = (await request(app, 'GET', '/api/users')).body;
  const me = users.find((u: any) => u.username === 'admin');
  assert.equal((await request(app, 'PUT', `/api/users/${me.id}`, { role: 'teacher' })).status, 400);
  assert.equal((await request(app, 'PUT', `/api/users/${me.id}`, { active: false })).status, 400);
  assert.equal((await request(app, 'DELETE', `/api/users/${me.id}`)).status, 400);
  assert.ok(!JSON.stringify(users).includes('passwordHash'));
  const b = await as('bursar');
  const bid = users.find((u: any) => u.username === 'bursar').id;
  assert.equal((await request(app, 'PUT', `/api/users/${bid}`, { password: 'new-password-9' })).status, 200);
  assert.equal((await b('GET', '/api/meta')).status, 401, 'old session ended');
  assert.equal((await request(app, 'POST', '/api/users', { username: 'BURSAR', name: 'x', role: 'bursar', password: 'password-123' })).status, 400, 'usernames are unique, any case');
});

test('change own password needs the current one', async () => {
  const { as } = await withUsers();
  const t = await as('hana');
  assert.equal((await t('PUT', '/api/auth/password', { current: 'nope', password: 'brand-new-pw' })).status, 400);
  assert.equal((await t('PUT', '/api/auth/password', { current: 'password-123', password: 'brand-new-pw' })).status, 200);
  assert.equal((await t('GET', '/api/meta')).status, 200, 'this session stays signed in');
});
