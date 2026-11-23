/**
 * "Is this slot free?"
 *
 * One rule answers it, at both levels the app edits at: two classes clash
 * exactly when they occupy a shared period on a shared *concrete date*.
 * Nothing here compares one recurrence rule against another. A candidate is
 * expanded into the dates it meets on, those dates are resolved into the
 * occurrences that actually happen — exceptions folded in — and the two are
 * intersected.
 *
 * Going through real dates is what makes the awkward cases fall out for
 * free rather than each needing its own clause: two alternating classes on
 * opposite weeks share a weekday, a period and a date range but never a
 * date; a one-off clashes only on its own day, whatever weekday its record
 * happens to name; and an occurrence that has been moved elsewhere leaves
 * its original slot free, because resolving that date no longer produces it.
 *
 * ## A clash is a question, not a veto
 *
 * Until Beta 2 a clash refused the edit outright. Real timetables have
 * intentional overlaps — a lab that runs alongside a lecture, two optional
 * courses in one slot of which the student attends either — so a clash is now
 * reported as an *overlap* that the user may accept. Detection is exactly as
 * strict as it was; what changed is that every write path takes an
 * `allowOverlap` option, and without it answers with an `OverlapRefusal`
 * naming the class in the way, so the screen can ask "Add anyway?" instead of
 * saying no. Nothing is ever merged, replaced or discarded: two overlapping
 * classes are two placements, each with its own occurrences and reminders.
 */

import { domainError, type DomainError } from "@/domain/errors";
import { resolveOccurrences, type Occurrence, type OccurrenceSource } from "@/domain/occurrence";
import { clashHorizon, occurrenceDates } from "@/domain/recurrence";
import { occupiedSlotIds } from "@/domain/timetable";
import type { Weekday } from "@/domain/week";
import type { RecurrenceType, TimeSlot } from "@/types/models";

/** Everything a clash check reads: the stored timetable, exceptions included. */
export interface ConflictSource extends OccurrenceSource {
  timeSlots: TimeSlot[];
}

export interface PlacementCandidate {
  /** The series being edited, so it is never counted against itself. */
  placementId?: string;
  weekday: Weekday;
  timeSlotId: string;
  slotSpan: number;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
  /** Whether the candidate reaches back to the timetable's start; see `seriesLowerBound`. */
  startsWithTimetable?: boolean;
}

/** How a write treats an overlap it finds. */
export interface OverlapOptions {
  /**
   * The user has seen the overlap warning and confirmed it. Absent or false
   * means the write stops at the first overlap and reports it.
   */
  allowOverlap?: boolean;
}

/**
 * A write that stopped because it would overlap another class — the one case
 * of refusal the user can overrule.
 *
 * `overlapWith` is the course name as the conflicting occurrence reads, so the
 * warning names exactly what the user sees in that slot.
 */
export interface OverlapRefusal {
  ok: false;
  error: DomainError;
  overlapWith: string;
}

export function overlapRefusal(conflict: Occurrence): OverlapRefusal {
  return {
    ok: false,
    error: domainError("errors.overlapsWith", { name: conflict.course.name }),
    overlapWith: conflict.course.name,
  };
}

/** The part of a series that decides which cells, on which dates, it occupies. */
export type Occupancy = Pick<
  PlacementCandidate,
  "weekday" | "timeSlotId" | "slotSpan" | "recurrenceType" | "startsOn" | "endsOn" | "startsWithTimetable"
>;

/**
 * Whether two descriptions of a series occupy exactly the same cells on
 * exactly the same dates.
 *
 * An edit that leaves this unchanged — a rename, a new room, a reminder —
 * cannot introduce an overlap, so it is never asked about one. Without this,
 * every later edit of a class the user had deliberately overlapped would raise
 * the same warning again.
 */
export function sameOccupancy(a: Occupancy, b: Occupancy): boolean {
  return (
    a.weekday === b.weekday &&
    a.timeSlotId === b.timeSlotId &&
    a.slotSpan === b.slotSpan &&
    a.recurrenceType === b.recurrenceType &&
    a.startsOn === b.startsOn &&
    a.endsOn === b.endsOn &&
    Boolean(a.startsWithTimetable) === Boolean(b.startsWithTimetable)
  );
}

export interface OccurrenceCandidate {
  /**
   * The occurrence being moved, so it is never counted against itself. null
   * when the candidate is not a class yet — a range being dragged out on the
   * empty grid has nothing of its own to exclude.
   */
  occurrenceId: string | null;
  date: string;
  timeSlotId: string;
  slotSpan: number;
}

/**
 * The first occurrence standing in the way of something that would occupy
 * `slotSpan` periods from `timeSlotId` on each of `dates`.
 *
 * Every period of the span is compared, not just the one it starts in: a
 * two-period class reaches into the period below it, and a class sitting
 * only there is just as much in the way.
 */
function firstClashOn(
  source: ConflictSource,
  dates: string[],
  timeSlotId: string,
  slotSpan: number,
  isSelf: (occurrence: Occurrence) => boolean,
): Occurrence | undefined {
  if (dates.length === 0) return undefined;
  const wanted = occupiedSlotIds(source.timeSlots, timeSlotId, slotSpan);
  if (wanted.length === 0) return undefined;

  // An uncommitted edit is a proposal, not a class that is there; nothing is
  // ever blocked by a preview that may still be cancelled.
  return resolveOccurrences({ ...source, preview: null }, dates).find((occurrence) => {
    if (isSelf(occurrence)) return false;
    const taken = occupiedSlotIds(source.timeSlots, occurrence.placement.timeSlotId, occurrence.placement.slotSpan);
    return taken.some((slotId) => wanted.includes(slotId));
  });
}

/**
 * Whether a whole series can occupy a slot — checked on every date it meets,
 * because a series has to hold on all of them.
 *
 * "Every date it meets" is infinite now that a series can be open-ended, so
 * the dates are enumerated up to `clashHorizon` — the point past which the
 * answer cannot change, computed from the timetable's own dates. The check is
 * still conclusive; it is only the enumeration that is finite. See the
 * argument in `domain/recurrence`.
 */
export function findPlacementConflict(source: ConflictSource, candidate: PlacementCandidate): Occurrence | undefined {
  return firstClashOn(
    source,
    // From the timetable's start, for a candidate that reaches back to it: those
    // earlier weeks are weeks it will be drawn in, so they are weeks it must
    // be free in.
    occurrenceDates(candidate, clashHorizon(source, candidate.startsOn), source.timetableStart),
    candidate.timeSlotId,
    candidate.slotSpan,
    // The series being edited cannot clash with itself, and neither can its
    // own one-off exceptions — they are the same class.
    (occurrence) => occurrence.basePlacement.id === candidate.placementId,
  );
}

/**
 * Whether one occurrence can occupy a slot — checked on its single date, so
 * one lesson may legitimately sit where its own series never could.
 *
 * The same question a range being dragged out on empty grid asks, with no
 * occurrence of its own to exclude.
 */
export function findOccurrenceConflict(source: ConflictSource, candidate: OccurrenceCandidate): Occurrence | undefined {
  return firstClashOn(
    source,
    [candidate.date],
    candidate.timeSlotId,
    candidate.slotSpan,
    (occurrence) => occurrence.occurrenceId === candidate.occurrenceId,
  );
}
