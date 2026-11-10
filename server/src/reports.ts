/** Report cards (staff screens and the parent portal), with GPA. */
import type { Row, Store } from './db.ts';
import { band, fullName, termMarks, termInfo, type Calc } from './engine.ts';
import { gpaHistory, gpaOf } from './analytics.ts';

export function buildReportCard(store: Store, st: Row, term: string, c: Calc) {
  const s = store.settings();
  const x = c.byId.get(st.id)!;
  const mates = c.students.filter((y) => y.active && y.className === st.className);
  const prev = termInfo(s, term).prev;
  const prevMarks = prev ? termMarks(store, s, prev).get(st.id) ?? {} : {};
  const cm = store.all('comments', 'WHERE learnerId = ? AND term = ?', st.id, term)[0];
  const cls = store.all('classes', 'WHERE name = ?', st.className)[0];
  const terms = s.terms ?? [];
  const nextTerm = terms[terms.findIndex((t) => t.name === term) + 1];
  return {
    student: { id: st.id, name: fullName(st), firstName: st.firstName, learnerNo: st.learnerNo, className: st.className, guardianName: st.guardianName, guardianEmail: st.guardianEmail },
    classLabel: cls ? (cls.grade ? `${cls.grade}${cls.stream ?? ''}` : cls.name) : st.className,
    classTeacher: cls?.teacher ?? '', term,
    subjects: s.subjects.map((subj) => {
      const v = mates.map((y) => y.marks[subj]).filter((m) => m !== undefined);
      const mark = x.marks[subj] ?? null;
      return {
        subject: subj, mark, band: mark !== null ? band(s, mark)?.band ?? '' : '', meaning: mark !== null ? band(s, mark)?.meaning ?? '' : '',
        classAvg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null, prev: prevMarks[subj] ?? null,
      };
    }),
    avg: x.avg, band: x.avg !== null ? band(s, x.avg)?.band ?? '' : '', chg: x.chg, pos: x.pos,
    classSize: mates.filter((y) => y.avg !== null).length,
    attendance: { present: x.present, taken: x.taken, absent: x.absent, late: x.late, att: x.att },
    teacherComment: cm?.teacherComment ?? '', principalComment: cm?.principalComment ?? '',
    nextTermStarts: nextTerm?.start ?? null,
    gpa: gpaOf(s, x.marks), gpaCumulative: gpaHistory(store, st.id, term).cumulative,
  };
}
