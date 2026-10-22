/**
 * Thorough examination dates under LOLER regulation 9: lifting accessories and
 * equipment for lifting people at least every 6 months, other lifting equipment
 * (e.g. the crane) at least every 12 months, unless a written scheme of examination
 * sets other intervals (HSE, "Thorough examination of lifting equipment").
 */
export const CRANE_EXAM_MONTHS = 12;
export const ACCESSORY_EXAM_MONTHS = 6;

/** "YYYY-MM-DD" plus whole months, clamped to the end of shorter months. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export type DateStatus = 'ok' | 'expired' | 'future' | 'missing';

export interface ExamStatus {
  status: DateStatus;
  /** Last day the examination covers. */
  dueBy: string | null;
  message: string;
}

const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Is a thorough examination dated `examDate` still in date on `liftDate`? */
export function examStatus(examDate: string | null, liftDate: string, months: number): ExamStatus {
  if (!isDate(examDate)) return { status: 'missing', dueBy: null, message: 'Enter the date of the last thorough examination.' };
  if (examDate > liftDate) return { status: 'future', dueBy: null, message: 'The examination date is after the lift date. Check it.' };
  const dueBy = addMonths(examDate, months);
  if (liftDate > dueBy) {
    return { status: 'expired', dueBy, message: `Out of date: next examination was due by ${dueBy} (${months}-month interval).` };
  }
  return { status: 'ok', dueBy, message: `In date for the lift. Next examination due by ${dueBy}.` };
}

/** Is a card or certificate with expiry date `expiry` valid on `liftDate`? */
export function expiryStatus(expiry: string | null, liftDate: string): ExamStatus {
  if (!isDate(expiry)) return { status: 'missing', dueBy: null, message: 'Enter the expiry date.' };
  if (expiry < liftDate) return { status: 'expired', dueBy: expiry, message: `Expired on ${expiry}.` };
  return { status: 'ok', dueBy: expiry, message: `Valid until ${expiry}.` };
}
