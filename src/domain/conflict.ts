/**
 * "Is this slot free?" asked at the two levels the app actually edits at.
 *
 * A series-level change has to hold for every date the series meets, so it
 * is checked against recurrence overlap. A single-occurrence change only has
 * to hold on one date, so it is checked against what that one date resolves
 * to — which is stricter in one direction and far looser in the other, and
 * getting them the same way round is the whole point of separating them.
 */

import { resolveOccurrences, type Occurrence, type OccurrenceSource } from "@/domain/occurrence";
import { slotsCollide, type OccupiedSlot } from "@/domain/recurrence";
import { occupiedSlotIds } from "@/domain/timetable";
import type { Weekday } from "@/domain/week";
import type { Placement, RecurrenceType, TimeSlot } from "@/types/models";

export interface PlacementCandidate {
  /** The placement being moved, so it is not counted against itself. */
  placementId?: string;
  weekday: Weekday;
  timeSlotId: string;
  slotSpan: number;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
}

/**
 * Two classes may share a weekday and period as long as they never actually
 * meet on the same date — an alternating pair of biweekly classes, or a
 * one-off in a week its neighbour skips.
 */
export function findPlacementConflict(
  timeSlots: TimeSlot[],
  placements: Placement[],
  candidate: PlacementCandidate,
): Placement | undefined {
  const occupied: OccupiedSlot = {
    weekday: candidate.weekday,
    slotIds: occupiedSlotIds(timeSlots, candidate.timeSlotId, candidate.slotSpan),
    recurrenceType: candidate.recurrenceType,
    startsOn: candidate.startsOn,
    endsOn: candidate.endsOn,
  };

  return placements.find(
    (placement) =>
      !placement.deletedAt &&
      placement.id !== candidate.placementId &&
      slotsCollide(
        { ...placement, slotIds: occupiedSlotIds(timeSlots, placement.timeSlotId, placement.slotSpan) },
        occupied,
      ),
  );
}

export interface OccurrenceCandidate {
  /** The occurrence being moved, so it is not counted against itself. */
  occurrenceId: string;
  date: string;
  timeSlotId: string;
  slotSpan: number;
}

/** Anything already meeting on that one date, in any of the same periods. */
export function findOccurrenceConflict(
  source: OccurrenceSource,
  timeSlots: TimeSlot[],
  candidate: OccurrenceCandidate,
): Occurrence | undefined {
  const wanted = occupiedSlotIds(timeSlots, candidate.timeSlotId, candidate.slotSpan);

  return resolveOccurrences({ ...source, preview: null }, [candidate.date]).find((occurrence) => {
    if (occurrence.occurrenceId === candidate.occurrenceId) return false;
    const taken = occupiedSlotIds(timeSlots, occurrence.placement.timeSlotId, occurrence.placement.slotSpan);
    return taken.some((slotId) => wanted.includes(slotId));
  });
}
