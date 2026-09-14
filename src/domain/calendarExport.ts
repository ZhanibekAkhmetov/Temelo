/**
 * A timetable as a bounded list of dated meetings, for handing to a calendar.
 *
 * ## The one rule this module exists to keep
 *
 * It does not know how recurrence works, and it must never learn. Every
 * occurrence here comes out of `resolveOccurrences` — the same function the
 * grid draws from, the same one the clash check asks and the same one the
 * reminder plan is built on. So weekly and alternating classes, one-offs, the
 * timetable's start as a lower bound, moved occurrences, deleted occurrences
 * and the two halves of a "this and future" split are already decided by the
 * time anything below sees them, and an exported calendar cannot disagree with
 * what the app visibly shows for the same dates. A second recurrence
 * implementation written for calendar export would be a second set of answers,
 * and the one place its bugs would surface is inside somebody else's calendar
 * app, weeks later.
 *
 * That is also why the export is bounded and why bounding it is not a
 * limitation to apologise for. A Temelo timetable has a start and deliberately
 * no end (see `types/models`), so "export the whole thing" is not a finite
 * request. Asking for a date range turns it into one, and once the range is
 * finite, enumerating its dates and resolving each one is both exact and cheap
 * — a year is 366 resolver calls over data already in memory.
 *
 * ## What a caller has to supply
 *
 * A `CalendarExportSource`, which a `TimetableSnapshot` already satisfies
 * structurally. That is deliberate: the active timetable and an archived one
 * both reach the exporter as a snapshot, so there is one path for both and an
 * archive is never restored, touched or written in order to be exported.
 */

import { diffInDaysIso } from "@/domain/calendar";
import { addDaysIso } from "@/domain/date";
import { domainError, type DomainError } from "@/domain/errors";
import { resolveOccurrences } from "@/domain/occurrence";
import { occupiedSlotIds } from "@/domain/timetable";
import type { Course, OccurrenceException, Placement, TimeSlot } from "@/types/models";

/**
 * The longest range a single export may cover, in days, inclusive of both ends.
 *
 * A full year plus a day, so that "this academic year" is expressible whichever
 * day it starts on and a leap year does not fall a day short. It is a guard
 * rather than a product decision: the work is linear in the number of days, and
 * without a cap a mistyped year would ask for a file with a hundred thousand
 * events in it. Nothing a student actually wants to put in their phone's
 * calendar is longer than this.
 */
export const MAX_CALENDAR_EXPORT_DAYS = 366;

/** How far the suggested range reaches: one teaching half-year. */
const DEFAULT_CALENDAR_EXPORT_MONTHS = 6;

/** An inclusive range of calendar dates. Both ends are exported. */
export interface CalendarExportRange {
  from: string;
  to: string;
}

/**
 * What the exporter reads of a timetable.
 *
 * Structurally a subset of `TimetableSnapshot`, so both an active timetable and
 * an archived one can be passed straight in. Written out as its own interface
 * rather than imported, because the domain does not depend on the storage layer
 * — `storage/snapshot` imports from here, not the other way round.
 */
export interface CalendarExportSource {
  timetable: { name: string; anchorDate: string };
  timeSlots: TimeSlot[];
  courses: Course[];
  placements: Placement[];
  exceptions: OccurrenceException[];
}

/**
 * One meeting of a class, resolved and dated: what becomes one event.
 *
 * Deliberately not an iCalendar concept. It carries no UID, no escaping and no
 * timezone, because those are facts about a file format and `storage/
 * calendarFile` owns them. What it carries is what the timetable actually says,
 * which is a date, two local times and the class as it reads on that date —
 * overrides already applied, because the resolver applied them.
 */
export interface CalendarOccurrence {
  /** The series this belongs to, and the date it has *in* that series. */
  placementId: string;
  occurrenceDate: string;
  /** The date it actually happens on; differs from the above when it moved. */
  date: string;
  /** Local `HH:mm` of the first period it occupies. */
  startTime: string;
  /** Local `HH:mm` of the end of the last period it occupies. */
  endTime: string;
  summary: string;
  /** The room, or "" when the class has none. */
  location: string;
  /** Teacher and notes as one block, or "" when it has neither. */
  description: string;
}

/**
 * How the description is worded, supplied by the caller.
 *
 * The same arrangement `domain/reminderSchedule` uses and for the same reason:
 * the words depend on the chosen language, and the domain has no business
 * knowing which one that is. A teacher's name alone in a calendar entry is
 * ambiguous — it could be anyone — so it is labelled, and the label is a
 * translation.
 */
export interface CalendarExportText {
  /** "Teacher: Ivanova", "Lehrkraft: Ivanova". */
  teacher: (name: string) => string;
}

/* ------------------------------------------------------------------- range */

/**
 * The same day of the month `months` later, clamped to that month's last day.
 *
 * 14 September plus six months is 14 March; 31 August plus six months is 28 or
 * 29 February rather than a rolled-over 2 or 3 March, which is what naive
 * arithmetic on a `Date` produces and what would make the suggested range
 * occasionally land a few days past the month the user was thinking of.
 */
function addMonthsClampedIso(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const firstOfTarget = new Date(year, month - 1 + months, 1);
  const lastDayOfTarget = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfTarget);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${firstOfTarget.getFullYear()}-${pad(firstOfTarget.getMonth() + 1)}-${pad(clampedDay)}`;
}

/** How many days a range covers, counting both ends. */
export function calendarExportRangeDays(range: CalendarExportRange): number {
  return diffInDaysIso(range.from, range.to) + 1;
}

/**
 * The range the export flow opens on.
 *
 * From is where the useful part of the timetable starts, and that differs
 * between the two things a user can export:
 *
 *  - an **active** timetable is something they are living in, so the interesting
 *    part is from today onwards. Exporting the weeks they have already sat
 *    through would fill their calendar with history. Today, unless the
 *    timetable has not started yet, in which case its own start date — because
 *    nothing resolves before it and a range beginning earlier would only have
 *    empty days at the front.
 *  - an **archived** timetable is history by definition. Today is almost
 *    certainly past the end of it, so anchoring on today would suggest a range
 *    containing nothing at all. Its start date is the only sensible offer.
 *
 * To is six months further on, which is about a teaching half-year and is
 * comfortably inside the maximum. The cap is applied anyway, so that the
 * suggested range is always one the validator would accept.
 */
export function defaultCalendarExportRange(input: {
  /** The timetable's start date — `Timetable.anchorDate`. */
  anchorDate: string;
  /** Today, for an active timetable; null for an archive, which is history. */
  today: string | null;
}): CalendarExportRange {
  const from = input.today !== null && input.today > input.anchorDate ? input.today : input.anchorDate;
  const suggested = addMonthsClampedIso(from, DEFAULT_CALENDAR_EXPORT_MONTHS);
  const capped = addDaysIso(from, MAX_CALENDAR_EXPORT_DAYS - 1);
  return { from, to: suggested < capped ? suggested : capped };
}

/**
 * Why a range cannot be exported, or null when it can.
 *
 * Deliberately only two rules, and neither of them touches what the user typed.
 * A range that starts before the timetable does is *not* an error: the resolver
 * already returns nothing for those dates, so the export is simply shorter than
 * the range, and refusing it would mean explaining a distinction the user has
 * no reason to care about. A range containing no classes is not an error here
 * either — it is a result, and the UI says so rather than the validator.
 */
export function validateCalendarExportRange(range: CalendarExportRange): DomainError | null {
  if (range.to < range.from) return domainError("errors.calendarRangeInvalid");
  if (calendarExportRangeDays(range) > MAX_CALENDAR_EXPORT_DAYS) {
    return domainError("errors.calendarRangeTooLong", { days: MAX_CALENDAR_EXPORT_DAYS });
  }
  return null;
}

/* ------------------------------------------------------------- occurrences */

/** Every date in an inclusive range, in order. */
function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDaysIso(date, 1)) dates.push(date);
  return dates;
}

/** The teacher and the notes as one block; "" when the class has neither. */
function describe(teacher: string, notes: string, text: CalendarExportText): string {
  const parts: string[] = [];
  if (teacher.trim().length > 0) parts.push(text.teacher(teacher));
  if (notes.trim().length > 0) parts.push(notes);
  return parts.join("\n");
}

/**
 * Every meeting inside the range, in the order a calendar would list them.
 *
 * The resolver is asked once, for the whole range, and everything after that is
 * a lookup: which periods the class occupies (`occupiedSlotIds`, the same rule
 * the grid's blocks are sized by, which truncates a span that would run past
 * the end of the configured day), and what that makes its start and end times.
 *
 * Two things are dropped rather than exported, and both match what the grid
 * does with them:
 *
 *  - a `pending` occurrence, which is an edit the user has not committed to any
 *    series yet. It is drawn on screen while the scope chooser is open and it
 *    is not part of the timetable; a snapshot never carries one, so this is a
 *    guard rather than a live case.
 *  - an occurrence whose period is not in the timetable. The grid cannot draw
 *    one either (`resolveWeekBlocks` returns nothing for it), and an event with
 *    no time is not an event.
 *
 * Sorted by date, then by start time, then by name, so that exporting the same
 * timetable twice produces byte-identical files. Nothing downstream depends on
 * the order, but a file that changes for no reason is a file nobody can diff.
 */
export function calendarOccurrencesIn(
  source: CalendarExportSource,
  range: CalendarExportRange,
  text: CalendarExportText,
): CalendarOccurrence[] {
  const ordered = [...source.timeSlots].sort((a, b) => a.position - b.position);
  const slotById = new Map(ordered.map((slot) => [slot.id, slot]));

  const occurrences = resolveOccurrences(
    {
      placements: source.placements,
      courses: source.courses,
      exceptions: source.exceptions,
      // The timetable's start, exactly as every other caller passes it: nothing
      // occurs before it, and a series that starts with the timetable reaches
      // back as far as it does.
      timetableStart: source.timetable.anchorDate,
    },
    datesBetween(range.from, range.to),
  );

  const events = occurrences.flatMap<CalendarOccurrence>((occurrence) => {
    if (occurrence.pending) return [];

    const occupied = occupiedSlotIds(ordered, occurrence.placement.timeSlotId, occurrence.placement.slotSpan);
    if (occupied.length === 0) return [];

    const first = slotById.get(occupied[0]);
    const last = slotById.get(occupied[occupied.length - 1]);
    if (!first || !last) return [];

    return [
      {
        placementId: occurrence.basePlacement.id,
        occurrenceDate: occurrence.occurrenceDate,
        date: occurrence.date,
        startTime: first.startTime,
        endTime: last.endTime,
        summary: occurrence.course.name,
        location: occurrence.course.room,
        description: describe(occurrence.course.teacher, occurrence.course.notes, text),
      },
    ];
  });

  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.summary.localeCompare(b.summary) ||
      a.placementId.localeCompare(b.placementId),
  );
}
