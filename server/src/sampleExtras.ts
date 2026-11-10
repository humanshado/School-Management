/**
 * Demo data for the modules that are not in the Excel workbook (timetable, exams, library, transport, staff & payroll,
 * homework, notices, admissions), added when the sample school is loaded so every screen has something to show.
 * Deterministic: the same every time.
 */
import type { Store } from './db.ts';

const BOOKS: [string, string, string, number][] = [
  ["Charlotte's Web", 'E. B. White', 'Fiction', 3], ['Matilda', 'Roald Dahl', 'Fiction', 2], ['The Gruffalo', 'Julia Donaldson', 'Picture books', 2],
  ['Things Fall Apart', 'Chinua Achebe', 'Fiction', 2], ['Anna Hibiscus', 'Atinuke', 'Fiction', 3], ['The Boy Who Harnessed the Wind', 'William Kamkwamba', 'Biography', 2],
  ['Ada Twist, Scientist', 'Andrea Beaty', 'Picture books', 2], ['Holes', 'Louis Sachar', 'Fiction', 2], ['Wonder', 'R. J. Palacio', 'Fiction', 2],
  ['The Lion, the Witch and the Wardrobe', 'C. S. Lewis', 'Fiction', 2], ['Oxford Children\'s Dictionary', 'Oxford', 'Reference', 4], ['Children\'s World Atlas', 'Collins', 'Reference', 2],
  ['First Encyclopedia of Science', 'Usborne', 'Science', 2], ['Maths Puzzles for Clever Kids', 'Gareth Moore', 'Maths', 2], ['Journey to Jo\'burg', 'Beverley Naidoo', 'Fiction', 2],
  ['The Wonky Donkey', 'Craig Smith', 'Picture books', 1], ['Long Walk to Freedom (abridged)', 'Nelson Mandela', 'Biography', 1], ['How Things Work', 'DK', 'Science', 2],
];
const EXTRA_STAFF: [string, string, string, number][] = [
  ['Ms. Adaeze', 'Principal', 'Leadership', 2600], ['Mr. Okoro', 'Driver', 'Transport', 520], ['Mrs. Wanjiru', 'Driver', 'Transport', 520],
  ['Ms. Bisi', 'Bursar', 'Office', 1300], ['Mr. Kato', 'Librarian', 'Library', 900], ['Mrs. Amina', 'Cook', 'Kitchen', 480], ['Mr. Joseph', 'Groundskeeper', 'Facilities', 450],
];

export function addSampleExtras(store: Store) {
  const s = store.settings();
  if (store.all('timetable').length || store.all('books').length) return; // already there
  const classes = store.all('classes', 'ORDER BY name');
  const subjects = s.subjects;
  store.tx(() => {
    const ins = (t: string, row: Record<string, unknown>) => {
      const k = Object.keys(row);
      return Number(store.db.prepare(`INSERT INTO ${t} (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`).run(...(Object.values(row) as any[])).lastInsertRowid);
    };
    // ---- timetable: 8 periods x 5 days, subjects rotating, the class teacher teaches (no clashes)
    const weekly = [...subjects, ...subjects, ...subjects, ...subjects, ...subjects].slice(0, 40);
    classes.forEach((c, ci) => {
      for (let d = 1; d <= 5; d++) for (let p = 0; p < 8; p++) {
        const subj = weekly[(d * 8 + p + ci * 3) % weekly.length];
        ins('timetable', { className: c.name, day: d, period: p, subject: subj, teacher: c.teacher, room: subj === 'Phys. Ed.' ? 'Sports field' : c.room });
      }
    });
    // ---- exams for the current term: Maths and English, one class per slot so rooms never clash
    const exDays = ['2026-11-24', '2026-11-25', '2026-11-26'];
    classes.forEach((c, ci) => {
      ins('exams', { term: s.currentTerm, className: c.name, subject: 'Maths', title: 'Term exam', date: exDays[ci % 3], start: '08:30', end: '10:00', room: c.room, invigilator: c.teacher });
      ins('exams', { term: s.currentTerm, className: c.name, subject: 'English', title: 'Term exam', date: exDays[ci % 3], start: '10:30', end: '12:00', room: c.room, invigilator: c.teacher });
    });
    // ---- library
    const bookIds = BOOKS.map(([title, author, category, copies], i) => ins('books', { title, author, category, copies, shelf: `${category[0]}${(i % 4) + 1}` }));
    const learners = store.all('students', 'ORDER BY id');
    const today = s.sampleAnchor ?? '2026-11-04';
    const loans: [number, number, string, string, string | null][] = [
      [0, 5, '2026-10-21', '2026-11-04', null], [1, 22, '2026-10-28', '2026-11-11', null], [3, 211, '2026-10-12', '2026-10-26', null],
      [4, 40, '2026-10-26', '2026-11-09', null], [7, 150, '2026-10-01', '2026-10-15', null], [8, 98, '2026-10-05', '2026-10-19', '2026-10-18'],
    ];
    for (const [b, li, on, due, back] of loans) {
      const st = learners[li]; if (!st) continue;
      ins('loans', { bookId: bookIds[b], borrowerType: 'learner', borrowerId: st.id, borrowerName: `${st.firstName} ${st.lastName} (${st.className})`, borrowedOn: on, dueOn: due, returnedOn: back, issuedBy: 'Mr. Kato' });
    }
    void today;
    // ---- transport: riders are the learners who pay the transport fee
    const routes = [
      { name: 'North', vehicle: 'Bus 1', driver: 'Mr. Okoro', driverPhone: '555-0301', capacity: 70, stops: [['Alder Street', '06:55', '15:40'], ['Market Square', '07:10', '15:25'], ['Hill Road', '07:25', '15:10']] },
      { name: 'South', vehicle: 'Bus 2', driver: 'Mrs. Wanjiru', driverPhone: '555-0302', capacity: 70, stops: [['River Bridge', '06:50', '15:45'], ['Church Corner', '07:05', '15:30'], ['Valley Clinic', '07:20', '15:15']] },
    ];
    const stopIds: number[][] = routes.map((r) => {
      const id = ins('routes', { name: r.name, vehicle: r.vehicle, driver: r.driver, driverPhone: r.driverPhone, capacity: r.capacity });
      (r as any).id = id;
      return r.stops.map(([name, am, pm], i) => ins('stops', { routeId: id, name, amTime: am, pmTime: pm, seq: i + 1 }));
    });
    learners.filter((x) => /transport/i.test(x.optionalFees ?? '')).forEach((x, i) => {
      const ri = i % 2;
      ins('riders', { learnerId: x.id, routeId: (routes[ri] as any).id, stopId: stopIds[ri][Math.floor(i / 2) % 3] });
    });
    for (const r of routes) for (const [date, dir, dep, arr] of [['2026-11-03', 'AM', '06:50', '07:45'], ['2026-11-03', 'PM', '15:05', '15:55'], ['2026-11-04', 'AM', '06:52', '07:48']])
      ins('trips', { routeId: (r as any).id, date, direction: dir, departedAt: dep, arrivedAt: arr, driver: r.driver, loggedBy: 'Office' });
    // ---- staff & payroll
    for (const t of store.all('teachers', 'ORDER BY name')) ins('staff', { name: t.name, position: 'Teacher', department: 'Teaching', phone: t.phone, email: t.email, status: 'Active', teacherName: t.name, hireDate: '2022-01-10', baseSalary: 1150, bankName: 'Valley Bank', bankAccount: `0100${String(t.id).padStart(4, '0')}` });
    EXTRA_STAFF.forEach(([name, position, department, pay], i) => ins('staff', { name, position, department, status: 'Active', hireDate: '2021-09-01', baseSalary: pay, bankName: 'Valley Bank', bankAccount: `0200${String(i + 1).padStart(4, '0')}` }));
    // ---- homework & notices
    for (const [cls, subj, title, due] of [['6A', 'Maths', 'Fractions: exercise 4B, questions 1–12', '2026-11-06'], ['6B', 'English', 'Read chapter 3 and write a half-page summary', '2026-11-09'], ['3A', 'Science', 'Bring a leaf from three different trees', '2026-11-05']])
      ins('homework', { className: cls, subject: subj, title, details: '', setOn: '2026-11-03', dueOn: due, postedBy: classes.find((c) => c.name === cls)?.teacher ?? 'Teacher', at: '2026-11-03T08:00:00.000Z' });
    ins('announcements', { title: "Founders' Day holiday", body: "School is closed on Friday 20 November for Founders' Day.", audience: 'everyone', pinned: 1, postedBy: 'Ms. Adaeze', at: '2026-11-02T07:00:00.000Z' });
    ins('announcements', { title: 'Term 3 exams', body: 'Maths and English exams run 24–26 November. The timetable is in the portal.', audience: 'families', pinned: 0, postedBy: 'Ms. Adaeze', at: '2026-11-03T07:00:00.000Z' });
    ins('announcements', { title: 'Staff meeting Thursday 15:30', body: 'Report card deadlines and exam invigilation.', audience: 'staff', pinned: 0, postedBy: 'Ms. Adaeze', at: '2026-11-03T12:00:00.000Z' });
    // ---- admissions
    ins('applications', { ref: 'APP-2026-0001', status: 'Interview', firstName: 'Tariq', lastName: 'O.', dob: '2019-05-12', gender: 'M', gradeApplying: 'Grade 1', guardianName: 'Halima O.', relationship: 'Mother', guardianPhone: '555-0611', guardianEmail: 'halima@family.example', submittedAt: '2026-10-20T09:00:00.000Z', updatedAt: '2026-10-27T09:00:00.000Z', interviewAt: '2026-11-10T10:00', token: 'sample-1' });
    ins('applications', { ref: 'APP-2026-0002', status: 'Applied', firstName: 'Lena', lastName: 'M.', dob: '2016-02-03', gender: 'F', gradeApplying: 'Grade 4', guardianName: 'Peter M.', relationship: 'Father', guardianPhone: '555-0612', previousSchool: 'Riverside Primary', submittedAt: '2026-11-02T18:30:00.000Z', updatedAt: '2026-11-02T18:30:00.000Z', token: 'sample-2' });
    // ---- settings for the new modules
    store.db.prepare('UPDATE settings SET json = ? WHERE id = 1').run(JSON.stringify({
      ...s, loanDays: 14, finePerDay: 0,
      payItems: [{ name: 'Housing', kind: 'allowance', method: 'percent', amount: 10 }, { name: 'Pension', kind: 'deduction', method: 'percent', amount: 8 }, { name: 'PAYE', kind: 'deduction', method: 'percent', amount: 7.5 }],
    }));
  });
}
