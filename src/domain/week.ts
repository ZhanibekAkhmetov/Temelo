/**
 * Weekday vocabulary and ordering. The displayed week always runs
 * Monday-first; the only configurable thing is which trailing day(s) are
 * non-class days (see WeekendMode).
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

/** Which day(s) are treated as non-class days and hidden from the grid. */
export type WeekendMode = "saturdaySunday" | "sundayOnly";

export const WEEKEND_MODE_LABEL: Record<WeekendMode, string> = {
  saturdaySunday: "Saturday & Sunday",
  sundayOnly: "Sunday only",
};

export const ALL_WEEKEND_MODES: WeekendMode[] = ["saturdaySunday", "sundayOnly"];

const WEEKEND_DAYS_BY_MODE: Record<WeekendMode, ReadonlySet<Weekday>> = {
  saturdaySunday: new Set(["saturday", "sunday"]),
  sundayOnly: new Set(["sunday"]),
};

export const WEEKDAY_SHORT_LABEL: Record<Weekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

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

/** Local wall-clock weekday, for highlighting "today" — not stored data. */
export function getCurrentWeekday(): Weekday {
  return JS_DAY_INDEX_TO_WEEKDAY[new Date().getDay()];
}
