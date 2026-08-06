/**
 * Concrete occurrences: what a recurring placement actually turns into on a
 * given calendar date, once its one-off exceptions have been folded in.
 *
 * A placement is a rule; an occurrence is one meeting of it. Everything the
 * grid draws, everything a gesture picks up and everything an edit is
 * "about" is an occurrence, so the identity of one — placement plus the date
 * it has *in the base series* — is defined here and used everywhere else.
 * That identity survives a move: an occurrence that was dragged to another
 * day is still the same occurrence, drawn somewhere else.
 */

import { weekdayOfIsoDate } from "@/domain/calendar";
import { occursOn } from "@/domain/recurrence";
import type { Weekday } from "@/domain/week";
import type { Course, OccurrenceException, Placement } from "@/types/models";

/**
 * Stable identity of one occurrence. Deliberately built from the date in the
 * base series rather than the date it is drawn on, so moving it does not
 * turn it into a different occurrence.
 */
export function occurrenceIdFor(placementId: string, originalDate: string): string {
  return `${placementId}|${originalDate}`;
}

export interface Occurrence {
  occurrenceId: string;
  /** The placement as this occurrence is scheduled — overrides applied. */
  placement: Placement;
  /** The course as this occurrence reads — overrides applied. */
  course: Course;
  /** The series record behind it, before any override. */
  basePlacement: Placement;
  baseCourse: Course;
  /** The exception this occurrence comes from, when it has one. */
  exception: OccurrenceException | null;
  /** Date this occurrence has in the base series. */
  occurrenceDate: string;
  /** Date it is actually drawn on. */
  date: string;
  weekday: Weekday;
  /** True while this is an uncommitted edit awaiting a scope choice. */
  pending: boolean;
}

/**
 * An edit that has been made but not yet applied to any series: drawn where
 * it would land, in place of the occurrence it came from, so the scope
 * chooser has something to talk about.
 */
export interface OccurrencePreview {
  /** The occurrence it stands in for; that one is not drawn while this is. */
  occurrenceId: string;
  occurrenceDate: string;
  /** Date the edit would land on. */
  date: string;
  /** Placement with the proposed schedule already applied. */
  placement: Placement;
  /** Course with the proposed fields already applied. */
  course: Course;
}

export interface OccurrenceSource {
  placements: Placement[];
  courses: Course[];
  exceptions: OccurrenceException[];
  preview?: OccurrencePreview | null;
}

/** The placement as an exception schedules it; the weekday follows the date. */
export function placementWithOverrides(base: Placement, exception: OccurrenceException | null): Placement {
  if (!exception) return base;
  return {
    ...base,
    weekday: weekdayOfIsoDate(exception.effectiveDate),
    timeSlotId: exception.timeSlotId ?? base.timeSlotId,
    slotSpan: exception.slotSpan ?? base.slotSpan,
  };
}

/** The course as an exception describes it; unset overrides follow the course. */
export function courseWithOverrides(base: Course, exception: OccurrenceException | null): Course {
  if (!exception) return base;
  return {
    ...base,
    name: exception.name ?? base.name,
    room: exception.room ?? base.room,
    teacher: exception.teacher ?? base.teacher,
    notes: exception.notes ?? base.notes,
  };
}

/**
 * Whether an exception still belongs to its series.
 *
 * Membership is judged on the date the occurrence has in the series, not on
 * where it was moved to — an occurrence dragged past the end of term is
 * still that occurrence, and shortening the term is what removes it.
 */
function withinSeries(placement: Placement, exception: OccurrenceException): boolean {
  return placement.startsOn <= exception.originalDate && exception.originalDate <= placement.endsOn;
}

function exceptionsByPlacement(exceptions: OccurrenceException[]): Map<string, OccurrenceException[]> {
  const byPlacement = new Map<string, OccurrenceException[]>();
  for (const exception of exceptions) {
    if (exception.deletedAt) continue;
    const bucket = byPlacement.get(exception.placementId);
    if (bucket) bucket.push(exception);
    else byPlacement.set(exception.placementId, [exception]);
  }
  return byPlacement;
}

/**
 * Every occurrence falling on the given dates.
 *
 * Each placement contributes at most one occurrence per date, from exactly
 * one of two routes: its own recurrence rule, or an exception that has been
 * moved onto that date. A date carrying an exception never also carries the
 * base occurrence it replaced, which is what keeps an edited occurrence from
 * being drawn twice — including when it was moved into another week, where
 * the suppression and the drawing happen on different dates entirely.
 */
export function resolveOccurrences(source: OccurrenceSource, dates: string[]): Occurrence[] {
  const { placements, courses, exceptions, preview } = source;
  const byPlacement = exceptionsByPlacement(exceptions);
  const wanted = new Set(dates);
  const found: Occurrence[] = [];

  for (const placement of placements) {
    if (placement.deletedAt) continue;
    const course = courses.find((candidate) => candidate.id === placement.courseId && !candidate.deletedAt);
    if (!course) continue;

    const placementExceptions = byPlacement.get(placement.id) ?? [];

    for (const date of wanted) {
      const replaced = placementExceptions.find((exception) => exception.originalDate === date);
      if (occursOn(placement, date) && !replaced) {
        found.push({
          occurrenceId: occurrenceIdFor(placement.id, date),
          placement,
          course,
          basePlacement: placement,
          baseCourse: course,
          exception: null,
          occurrenceDate: date,
          date,
          // Read from the date rather than from the placement, so a
          // one-off — whose date is its own, not its weekday's — is always
          // drawn in the column its date actually falls in.
          weekday: weekdayOfIsoDate(date),
          pending: false,
        });
      }
    }

    for (const exception of placementExceptions) {
      if (exception.state === "cancelled") continue;
      if (!wanted.has(exception.effectiveDate)) continue;
      if (!withinSeries(placement, exception)) continue;
      const effective = placementWithOverrides(placement, exception);
      found.push({
        occurrenceId: occurrenceIdFor(placement.id, exception.originalDate),
        placement: effective,
        course: courseWithOverrides(course, exception),
        basePlacement: placement,
        baseCourse: course,
        exception,
        occurrenceDate: exception.originalDate,
        date: exception.effectiveDate,
        weekday: effective.weekday,
        pending: false,
      });
    }
  }

  if (!preview) return found;

  // The uncommitted edit replaces the occurrence it was made on, wherever
  // that occurrence would otherwise have been drawn.
  const withoutEdited = found.filter((occurrence) => occurrence.occurrenceId !== preview.occurrenceId);
  if (!wanted.has(preview.date)) return withoutEdited;

  const baseCourse = courses.find((candidate) => candidate.id === preview.placement.courseId) ?? preview.course;
  withoutEdited.push({
    occurrenceId: preview.occurrenceId,
    placement: preview.placement,
    course: preview.course,
    basePlacement: preview.placement,
    baseCourse,
    exception: null,
    occurrenceDate: preview.occurrenceDate,
    date: preview.date,
    weekday: preview.placement.weekday,
    pending: true,
  });
  return withoutEdited;
}
