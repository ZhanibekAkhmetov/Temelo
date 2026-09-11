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

import { getOrderedWeekdays, type WeekendMode } from "@/domain/week";
import type { AppFormat } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { TimeSlot } from "@/types/models";

export interface TimetableShape {
  weekendMode: WeekendMode;
  /** First period's start and last period's end. */
  dayStart: string | null;
  dayEnd: string | null;
}

/** The shape of the timetable currently loaded into the working tables. */
export function shapeOfActive(weekendMode: WeekendMode, timeSlots: TimeSlot[]): TimetableShape {
  const ordered = [...timeSlots].sort((a, b) => a.position - b.position);
  return {
    weekendMode,
    dayStart: ordered[0]?.startTime ?? null,
    dayEnd: ordered[ordered.length - 1]?.endTime ?? null,
  };
}

/** "Mon–Fri", from the weekdays the grid actually shows. */
export function daysLabel(t: Translate, format: AppFormat, weekendMode: WeekendMode): string {
  const days = getOrderedWeekdays(weekendMode);
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";
  if (first === last) return format.weekdayShort(first);
  return t("timetables.daysRange", {
    first: format.weekdayShort(first),
    last: format.weekdayShort(last),
  });
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
  const days = daysLabel(t, format, shape.weekendMode);
  const hours = hoursLabel(t, shape);
  return hours ? t("timetables.summary", { days, hours }) : days;
}
