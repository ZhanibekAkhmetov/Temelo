/**
 * Weekday vocabulary and ordering. The displayed week always runs
 * Monday-first; what is configurable is which of its seven days a timetable
 * shows (`visibleWeekdays` in its settings) — any non-empty subset since
 * Beta 2, and one of three weekend presets before it (see WeekendMode).
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
 * Which day(s) are treated as non-class days and hidden from the grid — the
 * Beta 1 setting, kept as a legacy description of the visible days.
 *
 * Beta 2 stores the visible days themselves, but this is still written next
 * to them, in `settings.weekend_mode` and in every snapshot, because a build
 * that predates the change reads nothing else: it is what keeps an older
 * Temelo able to open a database or a `.temelo` written by this one. See
 * `weekendModeCovering`.
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

/** The days a legacy weekend preset shows, Monday first. */
export function getOrderedWeekdays(weekendMode: WeekendMode): Weekday[] {
  const weekend = WEEKEND_DAYS_BY_MODE[weekendMode];
  return ALL_WEEKDAYS_MONDAY_FIRST.filter((day) => !weekend.has(day));
}

/**
 * A set of days as the app keeps one: real weekdays only, each once, Monday
 * first — or null when nothing usable is left, because a timetable that shows
 * no day at all is not a state the grid can draw.
 *
 * Input is `unknown`-shaped on purpose: this is what reads a stored column, a
 * snapshot field and a route parameter, all of which are input.
 */
export function normalizeVisibleWeekdays(days: readonly unknown[]): Weekday[] | null {
  const wanted = new Set(days.filter((day): day is string => typeof day === "string"));
  const ordered = ALL_WEEKDAYS_MONDAY_FIRST.filter((day) => wanted.has(day));
  const unknown = [...wanted].some((day) => !(ALL_WEEKDAYS_MONDAY_FIRST as string[]).includes(day));
  if (unknown || ordered.length === 0) return null;
  return ordered;
}

/** A set of days as one text value, for a column or a route parameter. */
export function serializeWeekdays(days: readonly Weekday[]): string {
  return days.join(",");
}

/** The reverse of `serializeWeekdays`; null for anything that is not a usable set. */
export function parseWeekdays(text: string | null | undefined): Weekday[] | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  return normalizeVisibleWeekdays(text.split(",").map((part) => part.trim()));
}

/**
 * The legacy preset to write beside a set of visible days: the narrowest one
 * that still shows every day this set shows.
 *
 * "Narrowest that covers" rather than "nearest", because the only reader is an
 * older build, and the one mistake it must not make is hiding a day the user
 * has classes on. Mon/Wed/Fri reads there as Mon–Fri; Tue–Sat as Mon–Sat; a
 * set with Sunday in it as the whole week.
 */
export function weekendModeCovering(days: readonly Weekday[]): WeekendMode {
  if (days.includes("sunday")) return "none";
  if (days.includes("saturday")) return "sundayOnly";
  return "saturdaySunday";
}

/** Whether two sets of visible days are the same set. */
export function sameWeekdays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  return a.length === b.length && a.every((day, index) => day === b[index]);
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
