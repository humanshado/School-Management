import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'sms-up-'));
const { Store, SAMPLE_FILE } = await import('../src/db.ts');
const { createApp } = await import('../src/app.ts');
const { default: request, client } = await import('./request.ts');

async function school() {
  const store = new Store(':memory:');
  store.load(JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')));
  const app = createApp(store);
  const admin = (m: string, p: string, b?: unknown) => request(app, m, p, b);
  await admin('GET', '/api/meta');
  return { store, app, admin };
}

test('timetable: a teacher or room cannot be in two lessons at once; teachers can only read', async () => {
  const { app, admin } = await school();
  const set = (b: any) => admin('PUT', '/api/timetable/slot', b);
  assert.equal((await set({ className: '6A', day: 1, period: 0, subject: 'Maths', teacher: 'Ms. Hana', room: 'Room 11' })).status, 200);
  const clash = await set({ className: '6B', day: 1, period: 0, subject: 'English', teacher: 'Ms. Hana' });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /Ms\. Hana already teaches 6A \(Maths\) on Mon period 1/);
  assert.match((await set({ className: '6B', day: 1, period: 0, subject: 'English', teacher: 'Mr. Samuel', room: 'Room 11' })).body.error, /Room 11 is already used by 6A/);
  assert.equal((await set({ className: '6B', day: 1, period: 0, subject: 'English', teacher: 'Mr. Samuel', room: 'Room 12' })).status, 200);
  // replacing a class's own lesson is fine; clearing works
  assert.equal((await set({ className: '6A', day: 1, period: 0, subject: 'Science', teacher: 'Ms. Hana', room: 'Room 11' })).status, 200);
  assert.equal((await admin('GET', '/api/timetable?class=6A')).body.entries[0].subject, 'Science');
  await admin('POST', '/api/users', { username: 'hana', name: 'Ms. Hana', role: 'teacher', teacherName: 'Ms. Hana', password: 'password-123' });
  const t = client(app);
  await t('POST', '/api/auth/login', { username: 'hana', password: 'password-123' });
  assert.equal((await t('GET', '/api/timetable?teacher=Ms.%20Hana')).body.entries.length, 1);
  assert.equal((await t('PUT', '/api/timetable/slot', { className: '6A', day: 2, period: 0, subject: 'Maths' })).status, 403);
});

test('cover: an absent teacher\'s lessons need cover; only free teachers can take them', async () => {
  const { admin } = await school();
  const set = (b: any) => admin('PUT', '/api/timetable/slot', b);
  await set({ className: '6A', day: 3, period: 1, subject: 'Maths', teacher: 'Ms. Hana' });
  await set({ className: '6A', day: 3, period: 2, subject: 'English', teacher: 'Ms. Hana' });
  await set({ className: '6B', day: 3, period: 1, subject: 'Science', teacher: 'Mr. Samuel' });
  // 2026-11-04 is a Wednesday (day 3)
  const day = await admin('POST', '/api/covers/absent', { date: '2026-11-04', teacher: 'Ms. Hana' });
  assert.equal(day.status, 200);
  assert.equal(day.body.covers.length, 2);
  assert.ok(Array.isArray(day.body.teachers) && day.body.canEdit === true, 'write replies have the same shape as reads');
  const p1 = day.body.covers.find((c: any) => c.lesson.period === 1);
  assert.ok(!p1.free.includes('Mr. Samuel'), 'busy teaching 6B');
  assert.ok(!p1.free.includes('Ms. Hana'), 'absent');
  assert.ok(p1.free.includes('Ms. Grace'));
  assert.match((await admin('PUT', `/api/covers/${p1.id}`, { substitute: 'Mr. Samuel' })).body.error, /not free/);
  assert.equal((await admin('PUT', `/api/covers/${p1.id}`, { substitute: 'Ms. Grace' })).status, 200);
  // Ms. Grace is now busy in period 1, but free in period 2
  const again = (await admin('GET', '/api/covers?date=2026-11-04')).body;
  const p2 = again.covers.find((c: any) => c.lesson.period === 2);
  assert.ok(p2.free.includes('Ms. Grace'));
  assert.equal((await admin('POST', '/api/covers/absent', { date: '2026-11-07', teacher: 'Ms. Hana' })).status, 400, 'weekend');
  assert.equal((await admin('DELETE', '/api/covers/absent?date=2026-11-04&teacher=Ms.%20Hana')).body.covers.length, 0);
});

test('exams: class, room and invigilator clashes are refused; families see their class exams', async () => {
  const { app, admin } = await school();
  const ex = (b: any) => admin('POST', '/api/exams', { term: 'Term 3', title: 'Final', ...b });
  assert.equal((await ex({ className: '6A', subject: 'Maths', date: '2026-11-25', start: '09:00', end: '10:30', room: 'Hall', invigilator: 'Ms. Grace' })).status, 200);
  assert.match((await ex({ className: '6A', subject: 'English', date: '2026-11-25', start: '10:00', end: '11:00' })).body.error, /6A already has Maths/);
  assert.match((await ex({ className: '6B', subject: 'English', date: '2026-11-25', start: '10:00', end: '11:00', room: 'Hall' })).body.error, /Hall is already used/);
  assert.match((await ex({ className: '6B', subject: 'English', date: '2026-11-25', start: '10:00', end: '11:00', invigilator: 'Ms. Grace' })).body.error, /already invigilating/);
  assert.equal((await ex({ className: '6A', subject: 'English', date: '2026-11-25', start: '10:30', end: '11:30' })).status, 200, 'back to back is fine');
  assert.match((await ex({ className: '6B', subject: 'Maths', date: '2026-11-20', start: '09:00', end: '10:00' })).body.error, /holiday/);
  const kid = (await admin('GET', '/api/students')).body.find((s: any) => s.className === '6A');
  await admin('POST', '/api/users', { username: 'mum', name: 'Mum', role: 'parent', learnerIds: [kid.id], password: 'password-123' });
  const p = client(app);
  await p('POST', '/api/auth/login', { username: 'mum', password: 'password-123' });
  const sch = (await p('GET', `/api/portal/learners/${kid.id}/schedule`)).body;
  assert.deepEqual(sch.exams.map((e: any) => e.subject), ['Maths', 'English']);
  assert.equal((await p('GET', '/api/exams')).status, 403);
});

test('admissions: closed by default; apply, upload, move through stages, enrol into a class', async () => {
  const { store, app, admin } = await school();
  const pub = client(app);
  const form = { firstName: 'Amina', lastName: 'K.', gradeApplying: 'Grade 3', guardianName: 'Fatima K.', guardianPhone: '555-0999', guardianEmail: 'fatima@family.example' };
  assert.equal((await pub('POST', '/api/public/applications', form)).status, 403, 'closed');
  assert.equal((await admin('PUT', '/api/applications/settings', { open: true, intro: 'Welcome' })).status, 200);
  assert.equal((await pub('GET', '/api/public/admissions')).body.open, true);
  assert.equal((await pub('POST', '/api/public/applications', { ...form, gradeApplying: 'Grade 99' })).status, 400);
  assert.equal((await pub('POST', '/api/public/applications', { ...form, website: 'spam' })).status, 400, 'honeypot');
  const sent = await pub('POST', '/api/public/applications', form);
  assert.equal(sent.status, 200);
  assert.match(sent.body.ref, /^APP-2026-0001$/);
  // upload with the token (raw)
  const server = app.listen(0); const { port } = server.address() as any;
  const up = await fetch(`http://127.0.0.1:${port}/api/public/applications/${sent.body.token}/files`, { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'X-Filename': 'birth.pdf' }, body: '%PDF-1.4' });
  const wrong = await fetch(`http://127.0.0.1:${port}/api/public/applications/not-a-token/files`, { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'X-Filename': 'x.pdf' }, body: 'x' });
  server.close();
  assert.equal(up.status, 200);
  assert.equal(wrong.status, 404);
  // the public cannot read applications
  assert.equal((await pub('GET', '/api/applications')).status, 401);
  const list = (await admin('GET', '/api/applications')).body;
  assert.equal(list.counts.Applied, 1);
  const a = list.items[0];
  assert.equal(a.files[0].filename, 'birth.pdf');
  assert.ok(!('token' in a), 'the upload token is never shown');
  assert.equal((await admin('PUT', `/api/applications/${a.id}`, { status: 'Enrolled' })).status, 400, 'enrol through Enrol');
  assert.equal((await admin('PUT', `/api/applications/${a.id}`, { status: 'Offered' })).status, 200);
  const en = await admin('POST', `/api/applications/${a.id}/enrol`, { className: '3A' });
  assert.equal(en.status, 200);
  assert.equal(en.body.student.className, '3A');
  assert.equal(en.body.student.guardianPhone, '555-0999');
  assert.equal((await admin('GET', `/api/files?ownerType=student&ownerId=${en.body.student.id}`)).body[0].filename, 'birth.pdf', 'documents move to the learner');
  assert.equal(store.get('applications', a.id)!.status, 'Enrolled');
  assert.equal((await admin('POST', `/api/applications/${a.id}/enrol`, { className: '3A' })).status, 400, 'only once');
});
