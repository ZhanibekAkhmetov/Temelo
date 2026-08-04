/**
 * ISO calendar dates (YYYY-MM-DD) as plain strings throughout — never Date
 * timestamps — so term/placement date ranges stay independent of time zone
 * and local wall-clock time. Zero-padded ISO strings compare correctly with
 * plain string comparison, so no Date parsing is needed for ordering.
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ];
  return day >= 1 && day <= daysInMonth[month - 1];
}

/** Chronological comparison; both dates must already be valid ISO dates. */
export function isIsoDateBefore(a: string, b: string): boolean {
  return a < b;
}

export function isIsoDateBeforeOrEqual(a: string, b: string): boolean {
  return a <= b;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Today's date as a local calendar date, not a UTC-shifted one. */
export function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function addDaysIso(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const local = new Date(year, month - 1, day);
  local.setDate(local.getDate() + days);
  return `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}`;
}

/**
 * Conversion between the on-device display format (DD.MM.YYYY, entered as
 * 8 plain digits) and the internal storage format (ISO YYYY-MM-DD). Kept
 * here because it's a date-representation concern, not UI masking — the
 * masking itself (which digits are typed so far, colon/dot placement)
 * lives in the input components.
 */
export function isoToDmyDigits(iso: string): string {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${day}${month}${year}`;
}

export function dmyDigitsToIso(digits: string): string {
  if (digits.length !== 8) return "";
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  return `${year}-${month}-${day}`;
}

/** ISO -> DD.MM.YYYY for display; returns the input unchanged if it isn't a valid ISO date. */
export function formatIsoAsDmy(iso: string): string {
  const digits = isoToDmyDigits(iso);
  if (digits.length !== 8) return iso;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 8)}`;
}
