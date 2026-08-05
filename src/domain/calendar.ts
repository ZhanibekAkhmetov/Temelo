/**
 * Calendar navigation math over ISO date strings: which Monday a week
 * starts on, which dates a displayed week covers, the six-row grid a month
 * picker draws, and the human-facing labels for both. date.ts owns the ISO
 * representation itself; this module owns everything built on top of it.
 *
 * All arithmetic goes through a local `Date` constructed from the ISO
 * parts, never from `Date.parse`, so a date never shifts across a time-zone
 * boundary on its way in or out.
 */

import { addDaysIso } from "@/domain/date";
import { ALL_WEEKDAYS_MONDAY_FIRST, weekdayFromJsDayIndex, type Weekday } from "@/domain/week";

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_SHORT_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const WEEKDAY_SHORT_BY_JS_INDEX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_GRID_WEEKS = 6;
const DAYS_PER_WEEK = 7;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function weekdayOfIsoDate(iso: string): Weekday {
  return weekdayFromJsDayIndex(toLocalDate(iso).getDay());
}

/** Monday of the week containing `iso` — the app always renders Monday-first. */
export function startOfWeekIso(iso: string): string {
  const mondayFirstIndex = (toLocalDate(iso).getDay() + 6) % DAYS_PER_WEEK;
  return addDaysIso(iso, -mondayFirstIndex);
}

export function addWeeksIso(iso: string, weeks: number): string {
  return addDaysIso(iso, weeks * DAYS_PER_WEEK);
}

export function addMonthsIso(iso: string, months: number): string {
  const date = toLocalDate(iso);
  return toIso(new Date(date.getFullYear(), date.getMonth() + months, 1));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffInDaysIso(from: string, to: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((toLocalDate(to).getTime() - toLocalDate(from).getTime()) / MS_PER_DAY);
}

/**
 * Whole weeks between two dates that fall on the same weekday. Rounded, and
 * calculated from calendar dates only, so a daylight-saving change inside
 * the range cannot turn an exact number of weeks into a fraction — which is
 * what alternating-week recurrence depends on being exact.
 */
export function weeksBetweenIso(from: string, to: string): number {
  return Math.round(diffInDaysIso(from, to) / DAYS_PER_WEEK);
}

/** The seven dates of the week starting at `weekStartIso`, keyed by weekday. */
export function weekDatesFrom(weekStartIso: string): Record<Weekday, string> {
  const dates = {} as Record<Weekday, string>;
  ALL_WEEKDAYS_MONDAY_FIRST.forEach((day, index) => {
    dates[day] = addDaysIso(weekStartIso, index);
  });
  return dates;
}

export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

function year(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** e.g. "August 2026" — the month-picker header. */
export function monthYearLabel(iso: string): string {
  return `${MONTH_LABELS[monthIndex(iso)]} ${year(iso)}`;
}

/** e.g. "AUG 2026" — the timetable header, matching the reference design. */
export function monthShortYearLabel(iso: string): string {
  return `${MONTH_SHORT_LABELS[monthIndex(iso)].toUpperCase()} ${year(iso)}`;
}

/** e.g. "Thu, 6 Aug 2026" — the collapsed state of a date field. */
export function formatIsoLong(iso: string): string {
  const date = toLocalDate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${WEEKDAY_SHORT_BY_JS_INDEX[date.getDay()]}, ${date.getDate()} ${MONTH_SHORT_LABELS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Six Monday-first weeks covering the month containing `iso`, including the
 * leading/trailing days of the neighbouring months. Always six rows so the
 * picker's height never changes between months — which is what lets the
 * expand animation run against a fixed height.
 */
export function monthGridWeeks(iso: string): string[][] {
  const firstOfMonth = `${iso.slice(0, 7)}-01`;
  const gridStart = startOfWeekIso(firstOfMonth);
  return Array.from({ length: MONTH_GRID_WEEKS }, (_, weekIndex) =>
    Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex) => addDaysIso(gridStart, weekIndex * DAYS_PER_WEEK + dayIndex)),
  );
}

export const MONTH_GRID_ROW_COUNT = MONTH_GRID_WEEKS;
