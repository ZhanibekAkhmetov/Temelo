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
 */

import { resolveOccurrences, type Occurrence, type OccurrenceSource } from "@/domain/occurrence";
import { occurrenceDates } from "@/domain/recurrence";
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
}

export interface OccurrenceCandidate {
  /** The occurrence being moved, so it is never counted against itself. */
  occurrenceId: string;
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
 */
export function findPlacementConflict(source: ConflictSource, candidate: PlacementCandidate): Occurrence | undefined {
  return firstClashOn(
    source,
    occurrenceDates(candidate),
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
