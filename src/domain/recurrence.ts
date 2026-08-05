/**
 * Resolving recurring placements onto concrete calendar dates. Now that the
 * timetable shows one specific week at a time, "does this class happen in
 * this cell" is a date question, not just a weekday question — and so is
 * "does this class clash with that one".
 */

import { weekdayOfIsoDate, weeksBetweenIso } from "@/domain/calendar";
import { addDaysIso, isIsoDateBeforeOrEqual } from "@/domain/date";
import { ALL_WEEKDAYS_MONDAY_FIRST, type Weekday } from "@/domain/week";
import type { RecurrenceType } from "@/types/models";

/** The scheduling-relevant part of a placement — no identity, no timestamps. */
export interface RecurringSlot {
  weekday: Weekday;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
}

/** A placement resolved to the periods it actually occupies. */
export interface OccupiedSlot extends RecurringSlot {
  slotIds: string[];
}

/**
 * Upper bound on the weekly steps a clash check will walk, so a mistyped
 * far-future end date can't turn into a long loop. 520 weeks is ten years.
 */
const MAX_OCCURRENCE_STEPS = 520;

/** The first date on or after `iso` that falls on `weekday`. */
export function firstOccurrenceOnOrAfter(iso: string, weekday: Weekday): string {
  const target = ALL_WEEKDAYS_MONDAY_FIRST.indexOf(weekday);
  const current = ALL_WEEKDAYS_MONDAY_FIRST.indexOf(weekdayOfIsoDate(iso));
  return addDaysIso(iso, (target - current + 7) % 7);
}

/**
 * Whether a placement meets on one specific calendar date.
 *
 * Everything here is a function of the placement's own anchor and the date
 * passed in — which callers take from the immutable week a page is
 * rendering. Nothing reads a "currently displayed" week, so an alternating
 * class cannot change which weeks it appears in while the pager is moving.
 */
export function occursOn(slot: RecurringSlot, isoDate: string): boolean {
  if (slot.recurrenceType === "once") return isoDate === slot.startsOn;
  if (weekdayOfIsoDate(isoDate) !== slot.weekday) return false;
  if (!isIsoDateBeforeOrEqual(slot.startsOn, isoDate)) return false;
  if (!isIsoDateBeforeOrEqual(isoDate, slot.endsOn)) return false;
  if (slot.recurrenceType === "biweekly") {
    // Parity of the whole-week distance from the placement's first
    // occurrence: an integer, from dates alone.
    const anchor = firstOccurrenceOnOrAfter(slot.startsOn, slot.weekday);
    return weeksBetweenIso(anchor, isoDate) % 2 === 0;
  }
  return true;
}

/**
 * True when two placements would overlap on the same day — same weekday, at
 * least one period in common, and at least one date where both meet.
 * Checked date by date rather than by weekday alone, so a one-off and a
 * biweekly class can legitimately share a period on weeks where neither
 * actually meets.
 */
export function slotsCollide(a: OccupiedSlot, b: OccupiedSlot): boolean {
  if (a.weekday !== b.weekday) return false;
  if (!a.slotIds.some((slotId) => b.slotIds.includes(slotId))) return false;

  const from = a.startsOn > b.startsOn ? a.startsOn : b.startsOn;
  const until = a.endsOn < b.endsOn ? a.endsOn : b.endsOn;
  if (from > until) return false;

  let date = firstOccurrenceOnOrAfter(from, a.weekday);
  for (let step = 0; date <= until && step < MAX_OCCURRENCE_STEPS; step++) {
    if (occursOn(a, date) && occursOn(b, date)) return true;
    date = addDaysIso(date, 7);
  }
  // A one-off sits on a single date that the weekly walk above can miss
  // when it isn't on the slot's own weekday.
  if (a.recurrenceType === "once") return occursOn(b, a.startsOn);
  if (b.recurrenceType === "once") return occursOn(a, b.startsOn);
  return false;
}
