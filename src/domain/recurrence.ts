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
 * Whether the slot meets at least once inside an inclusive date range.
 *
 * Splitting a series asks exactly this of the part that stays behind: a
 * placement whose remaining range contains no occurrence at all is not a
 * shortened series, it is one that no longer exists.
 */
export function hasOccurrenceBetween(slot: RecurringSlot, from: string, until: string): boolean {
  if (from > until) return false;
  if (slot.recurrenceType === "once") return occursOn(slot, slot.startsOn) && slot.startsOn >= from && slot.startsOn <= until;

  let date = firstOccurrenceOnOrAfter(from, slot.weekday);
  for (let step = 0; date <= until && step < MAX_OCCURRENCE_STEPS; step++) {
    if (occursOn(slot, date)) return true;
    date = addDaysIso(date, 7);
  }
  return false;
}

/**
 * Every date a slot actually meets on, in order.
 *
 * This is what "do these two clash" is answered from. Comparing recurrence
 * rules to each other means reasoning about weekday, range and parity all at
 * once — and a rule whose weekday field disagrees with its own date, which
 * is every one-off, has no honest answer at that level at all. Two lists of
 * concrete dates have exactly one question between them: do they share one.
 */
export function occurrenceDates(slot: RecurringSlot): string[] {
  if (slot.startsOn > slot.endsOn) return [];
  // A one-off *is* its date. Its weekday field is decoration and must not be
  // consulted, because nothing keeps the two in step.
  if (slot.recurrenceType === "once") return [slot.startsOn];

  const dates: string[] = [];
  let date = firstOccurrenceOnOrAfter(slot.startsOn, slot.weekday);
  for (let step = 0; date <= slot.endsOn && step < MAX_OCCURRENCE_STEPS; step++) {
    if (occursOn(slot, date)) dates.push(date);
    date = addDaysIso(date, 7);
  }
  return dates;
}

/**
 * The start date a newly created class should carry.
 *
 * An every-two-week class meets on alternating weeks counted from its own
 * first occurrence, so its start date is not merely when it begins — it is
 * which half of the fortnight it belongs to. Anchoring a new one at the term
 * start would put every alternating class the user ever creates on the same
 * half, and so into permanent conflict with each other. The week the user
 * tapped is the week they meant, so that is the anchor.
 *
 * A weekly class meets every week regardless of where it is anchored, so it
 * keeps starting at the beginning of term; a one-off is simply its own date.
 */
export function defaultSeriesStartDate(recurrenceType: RecurrenceType, tappedDate: string, termStart: string): string {
  return recurrenceType === "weekly" ? termStart : tappedDate;
}
