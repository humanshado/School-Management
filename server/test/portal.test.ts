import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'sms-up-'));
const { Store, SAMPLE_FILE } = await import('../src/db.ts');
const { createApp } = await import('../src/app.ts');
const { default: request, client } = await import('./request.ts');

/** Sample school; learner 221 is in 6A (Ms. Hana), learner 1 is in 1A. */
async function school() {
  const store = new Store(':memory:');
  store.load(JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')));
  const app = createApp(store);
  const admin = (m: string, p: string, b?: unknown) => request(app, m, p, b);
  await admin('GET', '/api/meta');
  const a6 = store.all('students', "WHERE className = '6A' ORDER BY id")[0];
  const mk = (u: any) => admin('POST', '/api/users', { password: 'password-123', ...u });
  assert.equal((await mk({ username: 'mum', name: 'A Parent', role: 'parent', learnerIds: [a6.id] })).status, 200);
  assert.equal((await mk({ username: 'kid', name: 'A Student', role: 'student', learnerIds: [1] })).status, 200);
  assert.equal((await mk({ username: 'hana', name: 'Ms. Hana', role: 'teacher', teacherName: 'Ms. Hana' })).status, 200);
  const as = async (username: string) => { const c = client(app); assert.equal((await c('POST', '/api/auth/login', { username, password: 'password-123' })).status, 200); return c; };
  return { store, app, admin, as, a6 };
}

test('parent and student logins need learners; a parent sees only their own learner', async () => {
  const { admin, as, a6 } = await school();
  assert.equal((await admin('POST', '/api/users', { username: 'p2', name: 'P', role: 'parent', password: 'password-123' })).status, 400);
  assert.equal((await admin('POST', '/api/users', { username: 's2', name: 'S', role: 'student', learnerIds: [1, 2], password: 'password-123' })).status, 400);
  const p = await as('mum');
  const me = (await p('GET', '/api/portal/me')).body;
  assert.deepEqual(me.learners.map((l: any) => l.id), [a6.id]);
  const ov = await p('GET', `/api/portal/learners/${a6.id}`);
  assert.equal(ov.status, 200);
  assert.equal(ov.body.learner.className, '6A');
  assert.ok(!('flags' in ov.body.attendance) && !JSON.stringify(ov.body).includes('reasons'), 'no risk flags for families');
  assert.equal((await p('GET', '/api/portal/learners/1')).status, 403);
  assert.equal((await p('GET', `/api/portal/learners/${a6.id}/report`)).body.card.student.id, a6.id);
  // and none of the staff screens
  for (const path of ['/api/students', '/api/meta', '/api/today', '/api/classes', '/api/fees', '/api/homework', '/api/activity'])
    assert.equal((await p('GET', path)).status, 403, path);
  // staff cannot use the portal API
  assert.equal((await admin('GET', '/api/portal/me')).status, 403);
  // a receipt of another learner is refused
  const other = (await admin('GET', '/api/fees')).body.recent.find((x: any) => x.studentId !== a6.id);
  assert.equal((await p('GET', `/api/portal/payments/${other.id}`)).status, 403);
});

test('homework: teacher posts for own class only; the family sees it; files follow the same rules', async () => {
  const { app, admin, as, a6 } = await school();
  const t = await as('hana');
  assert.equal((await t('POST', '/api/homework', { className: '6B', title: 'x' })).status, 403);
  const hw = await t('POST', '/api/homework', { className: '6A', subject: 'Maths', title: 'Fractions p.12', dueOn: '2026-11-09' });
  assert.equal(hw.status, 200);
  assert.equal(hw.body.postedBy, 'Ms. Hana');
  // attach a file (raw upload)
  const up = await rawUpload(app, 'hana', `/api/files?ownerType=homework&ownerId=${hw.body.id}`, 'sheet.pdf', '%PDF-1.4 test');
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.mime, 'application/pdf');
  const bad = await rawUpload(app, 'hana', `/api/files?ownerType=homework&ownerId=${hw.body.id}`, 'evil.html', '<script>');
  assert.equal(bad.status, 400);
  const p = await as('mum');
  const list = (await p('GET', `/api/portal/learners/${a6.id}/homework`)).body;
  assert.equal(list.homework[0].title, 'Fractions p.12');
  assert.equal(list.homework[0].files[0].filename, 'sheet.pdf');
  const dl = await rawGet(app, 'mum', `/api/files/${up.body.id}`);
  assert.equal(dl.status, 200);
  assert.match(dl.disposition, /^attachment/);
  assert.equal(dl.text, '%PDF-1.4 test');
  // the student in 1A cannot open a 6A file; nor upload anything
  assert.equal((await rawGet(app, 'kid', `/api/files/${up.body.id}`)).status, 403);
  assert.equal((await rawUpload(app, 'kid', `/api/files?ownerType=homework&ownerId=${hw.body.id}`, 'a.pdf', 'x')).status, 403);
  // learner documents are admin only
  assert.equal((await rawUpload(app, 'hana', `/api/files?ownerType=student&ownerId=${a6.id}`, 'birth.pdf', 'x')).status, 403);
  assert.equal((await rawUpload(app, 'admin', `/api/files?ownerType=student&ownerId=${a6.id}`, 'birth.pdf', 'x')).status, 200);
  assert.equal((await admin('GET', `/api/files?ownerType=student&ownerId=${a6.id}`)).body.length, 1);
  // deleting the homework deletes its file
  assert.equal((await t('DELETE', `/api/homework/${hw.body.id}`)).status, 200);
  assert.equal((await rawGet(app, 'mum', `/api/files/${up.body.id}`)).status, 404);
});

test('notices: teachers post to their own class; families see everyone / families / their class', async () => {
  const { admin, as, a6 } = await school();
  const t = await as('hana');
  assert.equal((await t('POST', '/api/announcements', { title: 'All staff', audience: 'staff' })).status, 403);
  assert.equal((await t('POST', '/api/announcements', { title: '6A trip', audience: 'class:6A' })).status, 200);
  assert.equal((await admin('POST', '/api/announcements', { title: 'Staff meeting', audience: 'staff' })).status, 200);
  assert.equal((await admin('POST', '/api/announcements', { title: 'Sports day', audience: 'everyone', pinned: true })).status, 200);
  assert.equal((await admin('POST', '/api/announcements', { title: '1A only', audience: 'class:1A' })).status, 200);
  const p = await as('mum');
  const seen = (await p('GET', '/api/portal/notices')).body.map((n: any) => n.title);
  assert.deepEqual(seen.sort(), ['6A trip', 'Sports day']);
  assert.equal(seen.includes('Staff meeting'), false);
  void a6;
});

// ---- raw helpers (uploads and downloads are not JSON)
async function login(app: any, username: string) {
  const server = app.listen(0); const { port } = server.address();
  const pw = username === 'admin' ? 'admin-pass-1' : 'password-123';
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ username, password: pw }) });
  server.close();
  return r.headers.getSetCookie()[0].split(';')[0];
}
async function rawUpload(app: any, user: string, path: string, name: string, data: string) {
  const cookie = await login(app, user);
  const server = app.listen(0); const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { Cookie: cookie, 'X-Requested-With': 'fetch', 'X-Filename': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' }, body: data });
    return { status: r.status, body: await r.json() };
  } finally { server.close(); }
}
async function rawGet(app: any, user: string, path: string) {
  const cookie = await login(app, user);
  const server = app.listen(0); const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Cookie: cookie } });
    return { status: r.status, disposition: r.headers.get('content-disposition') ?? '', text: await r.text() };
  } finally { server.close(); }
}
