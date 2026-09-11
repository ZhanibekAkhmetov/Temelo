/**
 * Resolving recurring placements onto concrete calendar dates. Now that the
 * timetable shows one specific week at a time, "does this class happen in
 * this cell" is a date question, not just a weekday question — and so is
 * "does this class clash with that one".
 */

import { diffInDaysIso, startOfWeekIso, weekdayOfIsoDate, weeksBetweenIso } from "@/domain/calendar";
import { addDaysIso, isIsoDateBeforeOrEqual } from "@/domain/date";
import { ALL_WEEKDAYS_MONDAY_FIRST, type Weekday } from "@/domain/week";
import type { RecurrenceType } from "@/types/models";

/**
 * The end date of a series that does not end.
 *
 * A sentinel rather than a nullable column, and that is a deliberate trade.
 * Every date in this app is an ISO `YYYY-MM-DD` string compared with plain
 * string comparison — in the domain, in the UI, and in `placements.ends_on`,
 * which is `NOT NULL`. Allowing null would have meant a special case at every
 * one of those sites and a table rebuild to permit it; a date that sorts after
 * every real one means `occursOn`'s existing `date <= endsOn` test is already
 * the right test, and not one stored row had to change shape.
 *
 * It is never shown to anyone. `isOpenEndedSeries` is what the rest of the app
 * asks, and the only code that has to think about the sentinel at all is the
 * code that *enumerates* dates rather than testing one.
 */
export const OPEN_ENDED_DATE = "9999-12-31";

/** Whether a series runs indefinitely rather than stopping on a real date. */
export function isOpenEndedSeries(endsOn: string): boolean {
  return endsOn >= OPEN_ENDED_DATE;
}

/** The scheduling-relevant part of a placement — no identity, no timestamps. */
export interface RecurringSlot {
  weekday: Weekday;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
}

/**
 * Upper bound on the weekly steps any enumeration will walk. 520 weeks is ten
 * years — past anything a real timetable's clash check needs to reach, and the
 * backstop that stops an open-ended series ever becoming a long loop.
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
export function occurrenceDates(slot: RecurringSlot, horizon: string = OPEN_ENDED_DATE): string[] {
  if (slot.startsOn > slot.endsOn) return [];
  // A one-off *is* its date. Its weekday field is decoration and must not be
  // consulted, because nothing keeps the two in step.
  if (slot.recurrenceType === "once") return [slot.startsOn];

  // An open-ended series has no last date of its own, so enumerating it is only
  // meaningful up to a horizon the caller can justify — see `clashHorizon`.
  // The step cap is still underneath, for a caller that passes none.
  const until = slot.endsOn < horizon ? slot.endsOn : horizon;

  const dates: string[] = [];
  let date = firstOccurrenceOnOrAfter(slot.startsOn, slot.weekday);
  for (let step = 0; date <= until && step < MAX_OCCURRENCE_STEPS; step++) {
    if (occursOn(slot, date)) dates.push(date);
    date = addDaysIso(date, 7);
  }
  return dates;
}

/** The dates a timetable mentions, as far as a clash check has to look. */
export interface ClashHorizonSource {
  placements: { startsOn: string; endsOn: string; deletedAt: string | null }[];
  exceptions: { originalDate: string; effectiveDate: string; deletedAt: string | null }[];
}

/** Two weeks — the longest period any recurrence rule in Temelo has. */
const CLASH_HORIZON_TAIL_DAYS = 14;

/**
 * How far ahead "does this series clash with anything" has to be asked, now
 * that series do not end.
 *
 * The argument is short and it is the whole reason a bounded answer is also a
 * complete one. A base recurrence rule repeats with a period of one week or
 * two, so two open-ended series that clash at all clash again within a
 * fortnight of the moment both are running. A *bounded* series — a one-off, or
 * the earlier half of a series a "this and future" edit split — can only be
 * clashed with on or before its own last date. An exception is a single dated
 * event. So every clash that exists anywhere has an instance at or before
 *
 *     max(every real date the timetable names) + 2 weeks
 *
 * and looking that far is exactly as conclusive as looking forever, at a cost
 * proportional to the data rather than to the calendar.
 *
 * `startsOn` is in the maximum for the open-ended series that has not begun
 * yet: a class starting in two years still has to be compared against the one
 * already sitting in that slot. The sentinel itself is excluded, because
 * "forever" is not a date the check needs to reach.
 */
export function clashHorizon(source: ClashHorizonSource, from: string): string {
  let latest = from < OPEN_ENDED_DATE ? from : OPEN_ENDED_DATE;

  const extend = (date: string) => {
    if (date > latest && date < OPEN_ENDED_DATE) latest = date;
  };

  for (const placement of source.placements) {
    if (placement.deletedAt) continue;
    extend(placement.startsOn);
    extend(placement.endsOn);
  }
  for (const exception of source.exceptions) {
    if (exception.deletedAt) continue;
    extend(exception.originalDate);
    extend(exception.effectiveDate);
  }

  return addDaysIso(latest, CLASH_HORIZON_TAIL_DAYS);
}

/** A series' own inclusive date range, apart from how it repeats inside it. */
export interface SeriesRange {
  startsOn: string;
  endsOn: string;
}

/**
 * Where a series' date range lands when it follows one of its occurrences
 * from `fromDate` to `toDate`.
 *
 * Both ends move together, by whole days, so the series keeps the same first
 * occurrence relative to wherever it now meets. That is what preserves an
 * every-two-week class's parity across a move: parity is counted from a
 * placement's own first occurrence, and a start date left behind on the old
 * weekday would be re-read against the new one — silently re-anchoring the
 * whole series onto the other half of the fortnight.
 *
 * A one-off needs no special case: its range is its single date, so shifting
 * the range *is* moving it.
 *
 * An open end does not move. "Forever" is not a date, so shifting it by three
 * days would be meaningless even if it were harmless — and it is not harmless:
 * a shifted sentinel is no longer the sentinel, so the series would quietly
 * become one that stops on an invented day in the year 9999.
 */
export function seriesRangeMovedTo(range: SeriesRange, fromDate: string, toDate: string): SeriesRange {
  const shift = diffInDaysIso(fromDate, toDate);
  if (shift === 0) return { startsOn: range.startsOn, endsOn: range.endsOn };
  return {
    startsOn: addDaysIso(range.startsOn, shift),
    endsOn: isOpenEndedSeries(range.endsOn) ? range.endsOn : addDaysIso(range.endsOn, shift),
  };
}

/**
 * The start date a newly created class should carry.
 *
 * An every-two-week class meets on alternating weeks counted from its own
 * first occurrence, so its start date is not merely when it begins — it is
 * which half of the fortnight it belongs to. Anchoring every new one at the
 * same place would put every alternating class the user creates on the same
 * half of the fortnight, and so into permanent conflict with each other. The
 * week the user tapped is the week they meant, so that is the anchor.
 *
 * A weekly class meets every week wherever it is anchored, so all its start
 * date decides is how far *back* it is visible. It takes the timetable's own
 * anchor — the week the timetable was created in — so a class added in
 * November is still there when the user pages back to October, which is what a
 * timetable is for. If they are looking at a week *earlier* than that anchor
 * when they add it, the tapped week wins instead: a class must always appear
 * in the cell that was tapped.
 */
export function defaultSeriesStartDate(
  recurrenceType: RecurrenceType,
  tappedDate: string,
  timetableAnchor: string,
): string {
  if (recurrenceType !== "weekly") return tappedDate;
  const tappedWeekStart = startOfWeekIso(tappedDate);
  return timetableAnchor < tappedWeekStart ? timetableAnchor : tappedWeekStart;
}

/**
 * The end date a newly created series carries: none.
 *
 * A one-off is the only class that really stops, and its end is its own date
 * rather than anything this decides.
 */
export function defaultSeriesEndDate(): string {
  return OPEN_ENDED_DATE;
}
