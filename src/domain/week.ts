/**
 * Weekday vocabulary and ordering. The displayed week always runs
 * Monday-first; the only configurable thing is which trailing day(s) are
 * non-class days (see WeekendMode).
 *
 * The weekday *names* are not here. They are language-dependent and come from
 * `Intl` via `i18n/format`; what this module owns is the identity of a day
 * and the order the week is drawn in.
 */

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const ALL_WEEKDAYS_MONDAY_FIRST: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/**
 * Which day(s) are treated as non-class days and hidden from the grid.
 * "none" keeps the full seven-day week visible — that is the "weekends on"
 * end of the weekend switch in Settings.
 */
export type WeekendMode = "saturdaySunday" | "sundayOnly" | "none";

export const ALL_WEEKEND_MODES: WeekendMode[] = ["saturdaySunday", "sundayOnly", "none"];

const WEEKEND_DAYS_BY_MODE: Record<WeekendMode, ReadonlySet<Weekday>> = {
  saturdaySunday: new Set(["saturday", "sunday"]),
  sundayOnly: new Set(["sunday"]),
  none: new Set(),
};

const WEEKEND_DAYS: ReadonlySet<Weekday> = new Set(["saturday", "sunday"]);

/** Calendar weekend, independent of whether the day is hidden from the grid. */
export function isWeekendDay(day: Weekday): boolean {
  return WEEKEND_DAYS.has(day);
}

export function getOrderedWeekdays(weekendMode: WeekendMode): Weekday[] {
  const weekend = WEEKEND_DAYS_BY_MODE[weekendMode];
  return ALL_WEEKDAYS_MONDAY_FIRST.filter((day) => !weekend.has(day));
}

const JS_DAY_INDEX_TO_WEEKDAY: Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Maps `Date#getDay()` (Sunday = 0) onto the app's weekday vocabulary. */
export function weekdayFromJsDayIndex(index: number): Weekday {
  return JS_DAY_INDEX_TO_WEEKDAY[index];
}

/** Local wall-clock weekday, for highlighting "today" — not stored data. */
export function getCurrentWeekday(): Weekday {
  return weekdayFromJsDayIndex(new Date().getDay());
}
