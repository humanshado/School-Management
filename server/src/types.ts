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
  gradeBands: { band: string; from: number; meaning: string; points?: number }[];
  optionalFees: { name: string; amount: number }[];
  subjects: string[];
  relationships: string[];
  genders: string[];
  streams: string[];
  terms: { name: string; start: string; end: string; feesDue: string | null }[];
  holidays: { name: string; type: string; date: string }[];
  keyDates: { label: string; date: string }[];
  templates: Record<'absent' | 'risk' | 'report' | 'fees', Template>;
  /** the school day's periods (timetable); a default day is used when empty */
  periods?: { name: string; start: string; end: string }[];
  admissionsOpen?: boolean;
  admissionsIntro?: string;
  /** library: loan length in days and the fine per overdue day (0 = no fines) */
  loanDays?: number;
  finePerDay?: number;
  /** payroll: allowances and deductions applied to every member of staff unless their record overrides them */
  payItems?: { name: string; kind: 'allowance' | 'deduction'; method: 'fixed' | 'percent'; amount: number }[];
}
