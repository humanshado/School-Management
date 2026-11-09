import type { Settings } from './types';

export const money = (s: Settings | undefined, x: number | null | undefined) => {
  if (x === null || x === undefined) return '–';
  const d = s?.currencyDecimals ?? 0;
  const v = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${x < 0 ? '-' : ''}${s?.currencySymbol ?? ''}${v}`;
};
export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(digits)}%`);
export const num1 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : (Math.round(x * 10) / 10).toFixed(1));
export const signed = (x: number | null | undefined) => (x === null || x === undefined ? '–' : `${x > 0 ? '+' : ''}${(Math.round(x * 10) / 10).toFixed(1)}`);

const d = (iso: string) => new Date(iso + 'T00:00:00Z');
export const fmtDate = (iso?: string | null) => (iso ? d(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
export const fmtDay = (iso?: string | null) => (iso ? d(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
export const fmtShort = (iso?: string | null) => (iso ? d(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
export const fmtLong = (iso?: string | null) => (iso ? d(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
export const addDays = (iso: string, n: number) => new Date(d(iso).getTime() + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((d(b).getTime() - d(a).getTime()) / 86400000);

export const markClass = (m: string) => ({ P: 'm-p', A: 'm-a', L: 'm-l', E: 'm-e' })[m] ?? '';
export const bandOf = (s: Settings | undefined, mark: number | null | undefined) => {
  if (mark === null || mark === undefined || !s) return '';
  return s.gradeBands.find((b) => mark >= b.from - 1e-6)?.band ?? s.gradeBands[s.gradeBands.length - 1]?.band ?? '';
};
export const plural = (n: number, word: string, many = word + 's') => `${n} ${n === 1 ? word : many}`;
