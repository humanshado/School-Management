export interface Template { subject: string; body: string }

export interface Settings {
  schoolName: string;
  schoolAddress: string;
  schoolContact: string;
  currencySymbol: string;
  currencyDecimals: number;
  useFees: boolean;
  lateCountsPresent: boolean;
  /** 0..1: a learner is flagged when term attendance is under this */
  riskAttendance: number;
  /** a learner is flagged when the term average is down by this many points (or more) vs the previous term */
  riskDrop: number;
  principal: string;
  currentTerm: string;
  /** Sample mode pins "today" to sampleAnchor so the sample data looks live */
  sampleMode: boolean;
  sampleAnchor: string | null;
  grades: { name: string; tuition: number; books: number }[];
  assessmentTypes: { name: string; weight: number }[];
  payMethods: string[];
  studentStatuses: string[];
  /** highest band first; "from" = the lowest mark in the band */
  gradeBands: { band: string; from: number; meaning: string }[];
  optionalFees: { name: string; amount: number }[];
  subjects: string[];
  relationships: string[];
  genders: string[];
  streams: string[];
  terms: { name: string; start: string; end: string; feesDue: string | null }[];
  holidays: { name: string; type: string; date: string }[];
  keyDates: { label: string; date: string }[];
  templates: Record<'absent' | 'risk' | 'report' | 'fees', Template>;
}

export interface Kpis {
  learners: number; classes: number; risk: number; watch: number;
  regTaken: number; regNot: number; presentToday: number; enrolledToday: number;
  billed: number; paid: number; balance: number; overdueCount: number; overdueAmount: number; plans: number;
  receiptsToday: number; receiptsTodayAmount: number; week: number; weeks: number; schoolDays: number; ready: number;
}

export type Role = 'admin' | 'teacher' | 'bursar';
export interface User { id: number; username: string; name: string; role: Role; teacherName: string | null; active: number }
export interface Perms { role: Role; admin: boolean; teach: boolean; fees: boolean; classes: string[] | null }

export interface Meta {
  user: User; perms: Perms;
  settings: Settings; today: string; term: string; termStart: string | null; termEnd: string | null; feesDue: string | null;
  schoolDay: boolean; holiday: string; kpis: Kpis; classes: string[]; teachers: string[];
}

export interface StudentStats {
  id: number; name: string; firstName: string; className: string; learnerNo: string; active: boolean;
  taken: number; present: number; absent: number; late: number; att: number | null; avg: number | null; prev: number | null;
  chg: number | null; pos: number | null; billed: number; paid: number; paidBefore: number; balance: number; overdue: number;
  hasPlan: boolean; planNext: string | null; flags: number; flagText: string; feeStatus: string; marks: Record<string, number>; reasons: string[];
}

export interface ClassStats {
  id: number; name: string; label: string; grade: string; teacher: string; room: string; n: number;
  att: number | null; avg: number | null; billed: number; paid: number; balance: number; overdue: number; plans: number;
  registersTaken: number; today: 'Yes' | 'No' | ''; todayPresent: number; todayEnrolled: number;
}

export interface Student {
  id: number; learnerNo: string; firstName: string; lastName: string; className: string; dob: string | null; gender: string;
  status: string; enrolmentDate: string | null; optionalFees: string; guardianName: string; relationship: string;
  guardianPhone: string; guardianEmail: string; address: string; medicalNote: string; notes: string; stats?: StudentStats;
}

export interface Message { learnerId: number; name: string; to: string; subject: string; body: string }
