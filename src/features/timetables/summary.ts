/**
 * The one-line description of a timetable that the management screens show.
 *
 * "Mon–Fri · 07:30–15:10", and nothing else. Deliberately not a record count,
 * a schema version or an id: the user is choosing between timetables they made
 * themselves, and what tells two of those apart is which days they cover and
 * what hours the day runs — not how many rows are behind them.
 *
 * No period count either, and that is a translation decision rather than a
 * design one. "{count} periods" needs a plural rule in every language it is
 * translated into, and Russian needs three of them, to avoid printing
 * "1 periods" the one time somebody configures a single-period day. The hours
 * span says more and inflects nothing — the same reasoning the academic-day
 * row in Settings already follows.
 */

import { ALL_WEEKDAYS_MONDAY_FIRST, type Weekday } from "@/domain/week";
import type { AppFormat } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { TimeSlot } from "@/types/models";

export interface TimetableShape {
  visibleWeekdays: Weekday[];
  /** First period's start and last period's end. */
  dayStart: string | null;
  dayEnd: string | null;
}

/** The shape of the timetable currently loaded into the working tables. */
export function shapeOfActive(visibleWeekdays: Weekday[], timeSlots: TimeSlot[]): TimetableShape {
  const ordered = [...timeSlots].sort((a, b) => a.position - b.position);
  return {
    visibleWeekdays,
    dayStart: ordered[0]?.startTime ?? null,
    dayEnd: ordered[ordered.length - 1]?.endTime ?? null,
  };
}

/**
 * "Mon–Fri", from the weekdays the grid actually shows — and, now that any set
 * of days can be shown, "Mon, Wed, Fri" or "Mon–Wed, Sat" for one that is not
 * a single run.
 *
 * A run of three or more days is a range; one or two days are named. "Mon–Tue"
 * says nothing "Mon, Tue" does not, and reads as a typo for the longer range.
 */
export function daysLabel(t: Translate, format: AppFormat, days: readonly Weekday[]): string {
  const ordered = ALL_WEEKDAYS_MONDAY_FIRST.filter((day) => days.includes(day));
  const runs: Weekday[][] = [];
  for (const day of ordered) {
    const run = runs[runs.length - 1];
    const previous = run?.[run.length - 1];
    if (run && previous && ALL_WEEKDAYS_MONDAY_FIRST.indexOf(day) === ALL_WEEKDAYS_MONDAY_FIRST.indexOf(previous) + 1) {
      run.push(day);
    } else {
      runs.push([day]);
    }
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? t("timetables.daysRange", {
            first: format.weekdayShort(run[0]),
            last: format.weekdayShort(run[run.length - 1]),
          })
        : run.map((day) => format.weekdayShort(day)).join(", "),
    )
    .join(", ");
}

/** "07:30–15:10", or null when the timetable has no periods at all. */
export function hoursLabel(t: Translate, shape: TimetableShape): string | null {
  if (!shape.dayStart || !shape.dayEnd) return null;
  return t("settings.academicDaySummary", { start: shape.dayStart, end: shape.dayEnd });
}

/**
 * The whole line, or just the days when the timetable has no periods — which
 * cannot happen through the app, but a damaged archive is input rather than
 * something we wrote.
 */
export function timetableSummary(t: Translate, format: AppFormat, shape: TimetableShape): string {
  const days = daysLabel(t, format, shape.visibleWeekdays);
  const hours = hoursLabel(t, shape);
  return hours ? t("timetables.summary", { days, hours }) : days;
}
