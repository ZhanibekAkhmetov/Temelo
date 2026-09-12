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
  /** Always the parity anchor; also the first date only when the series does not start with the timetable. */
  startsOn: string;
  endsOn: string;
  /**
   * Whether the series reaches back as far as the timetable does — see
   * `seriesLowerBound`. Absent reads as false, which is the behaviour every
   * series had before the distinction existed.
   */
  startsWithTimetable?: boolean;
}

/**
 * The first date a series may meet on.
 *
 * `startsOn` used to answer three different questions at once, and the reason
 * moving a timetable's start earlier brought nothing back is that it could only
 * give one answer:
 *
 *  A. how far back the *timetable* reaches — `Timetable.anchorDate`, passed in
 *     here as `timetableStart`;
 *  B. which half of the fortnight an alternating class falls on — always
 *     `startsOn`, counted from the first occurrence on or after it;
 *  C. where a series genuinely begins — the later half of a "this and future"
 *     split, or a start date the user chose in the editor.
 *
 * A series that `startsWithTimetable` is part of the timetable's pattern: its
 * bound is A, and its `startsOn` is only B. Every other series is bounded by
 * C, which is its own `startsOn`. So moving the timetable's start earlier
 * extends an ordinary weekly or alternating class into the newly included
 * weeks — on the same parity, because B does not move — while a split's later
 * half still starts exactly where it was split.
 *
 * With no timetable start to go by, every series falls back to its own
 * `startsOn`: nothing is ever made to reach back without limit.
 */
export function seriesLowerBound(slot: RecurringSlot, timetableStart?: string | null): string {
  if (slot.recurrenceType === "once" || !slot.startsWithTimetable || !timetableStart) return slot.startsOn;
  return timetableStart;
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
 * Everything here is a function of the placement's own anchor, the
 * timetable's start and the date passed in — which callers take from the
 * immutable week a page is rendering. Nothing reads a "currently displayed"
 * week, so an alternating class cannot change which weeks it appears in while
 * the pager is moving.
 *
 * `timetableStart` only ever widens a series that starts with the timetable;
 * see `seriesLowerBound`. It is not also applied as a bound on its own here —
 * `resolveOccurrences` does that, for exceptions and previews as well.
 */
export function occursOn(slot: RecurringSlot, isoDate: string, timetableStart?: string | null): boolean {
  if (slot.recurrenceType === "once") return isoDate === slot.startsOn;
  if (weekdayOfIsoDate(isoDate) !== slot.weekday) return false;
  if (!isIsoDateBeforeOrEqual(seriesLowerBound(slot, timetableStart), isoDate)) return false;
  if (!isIsoDateBeforeOrEqual(isoDate, slot.endsOn)) return false;
  if (slot.recurrenceType === "biweekly") {
    // Parity of the whole-week distance from the placement's first
    // occurrence: an integer, from dates alone — and just as exact for a date
    // *before* that occurrence, which a series starting with the timetable
    // legitimately has. (-2 % 2 is -0, which is 0.)
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
export function hasOccurrenceBetween(
  slot: RecurringSlot,
  from: string,
  until: string,
  timetableStart?: string | null,
): boolean {
  if (from > until) return false;
  if (slot.recurrenceType === "once") return occursOn(slot, slot.startsOn) && slot.startsOn >= from && slot.startsOn <= until;

  let date = firstOccurrenceOnOrAfter(from, slot.weekday);
  for (let step = 0; date <= until && step < MAX_OCCURRENCE_STEPS; step++) {
    if (occursOn(slot, date, timetableStart)) return true;
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
export function occurrenceDates(
  slot: RecurringSlot,
  horizon: string = OPEN_ENDED_DATE,
  timetableStart?: string | null,
): string[] {
  // A one-off *is* its date. Its weekday field is decoration and must not be
  // consulted, because nothing keeps the two in step.
  if (slot.recurrenceType === "once") return slot.startsOn > slot.endsOn ? [] : [slot.startsOn];

  const from = seriesLowerBound(slot, timetableStart);
  if (from > slot.endsOn) return [];

  // An open-ended series has no last date of its own, so enumerating it is only
  // meaningful up to a horizon the caller can justify — see `clashHorizon`.
  // The step cap is still underneath, for a caller that passes none.
  const until = slot.endsOn < horizon ? slot.endsOn : horizon;

  const dates: string[] = [];
  let date = firstOccurrenceOnOrAfter(from, slot.weekday);
  for (let step = 0; date <= until && step < MAX_OCCURRENCE_STEPS; step++) {
    if (occursOn(slot, date, timetableStart)) dates.push(date);
    date = addDaysIso(date, 7);
  }
  return dates;
}

/**
 * The first date a series actually meets on, as the user sees it — which for
 * a series that starts with the timetable is not its stored anchor but the
 * first matching week on or after the timetable's start. What the class
 * editor shows as the series' start date.
 */
export function firstSeriesDate(slot: RecurringSlot, timetableStart?: string | null): string {
  if (slot.recurrenceType === "once") return slot.startsOn;
  let date = firstOccurrenceOnOrAfter(seriesLowerBound(slot, timetableStart), slot.weekday);
  // At most one extra week: the first matching weekday is either on the
  // series' parity or exactly one week off it.
  if (!occursOn(slot, date, timetableStart)) date = addDaysIso(date, 7);
  return date;
}

/**
 * The same parity anchor, moved back by whole fortnights until it is on or
 * before `limit`.
 *
 * For a series that starts with the timetable, `startsOn` is only a parity
 * anchor and can legitimately be later than an occurrence the user can see.
 * A split cutting such a series *before* its anchor would otherwise leave the
 * earlier half ending before it "starts" — which every validator in the app
 * rightly refuses. Fourteen days at a time is a no-op for an alternating
 * class's parity and for a weekly class's weekday alike.
 */
export function anchorOnOrBefore(startsOn: string, limit: string): string {
  if (startsOn <= limit) return startsOn;
  const fortnights = Math.ceil(diffInDaysIso(limit, startsOn) / 14);
  return addDaysIso(startsOn, -14 * fortnights);
}

/** What `inferStartsWithTimetable` reads of each placement. */
export interface SeriesHistoryRecord {
  id: string;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * For placements saved before the distinction existed: which of them start
 * with the timetable.
 *
 * Every repeating series does, except the later half of a "this and future"
 * split — and a split leaves a trace that can be recognised after the fact,
 * because it writes both halves in one moment:
 *
 *  - the earlier half gets a real end date: the day before the split;
 *  - the later half starts at the edited occurrence, which is that day plus
 *    whatever distance the user dragged it — within a week or so either way;
 *  - the earlier half's `updatedAt` and the later half's `createdAt` are the
 *    same timestamp, and the earlier one already existed.
 *
 * So a series is taken to be a split's later half when some other repeating
 * series, created no later than it and last updated no earlier than it was
 * created, ended between fourteen days before its start and twelve days
 * after. Soft-deleted series count as earlier halves — deleting the earlier
 * half must not let the later one leak back into its weeks.
 *
 * The rule errs one way only. A series wrongly recognised as a later half
 * keeps exactly the behaviour every series had before this change; one wrongly
 * missed would be drawn a second time inside weeks its earlier half already
 * covers. Only the first is harmless, so the window is generous.
 *
 * Migration v7 applies the same rule in SQL, written out there as literals for
 * the usual reason; the harness checks the two agree. This copy is for archive
 * snapshots written before v7, which carry no flag of their own.
 */
export function inferStartsWithTimetable(placements: SeriesHistoryRecord[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const series of placements) {
    if (series.recurrenceType === "once") {
      result.set(series.id, false);
      continue;
    }
    const windowStart = addDaysIso(series.startsOn, -14);
    const windowEnd = addDaysIso(series.startsOn, 12);
    const isLaterHalf = placements.some(
      (earlier) =>
        earlier.id !== series.id &&
        earlier.recurrenceType !== "once" &&
        !isOpenEndedSeries(earlier.endsOn) &&
        earlier.endsOn >= windowStart &&
        earlier.endsOn <= windowEnd &&
        earlier.createdAt <= series.createdAt &&
        earlier.updatedAt >= series.createdAt,
    );
    result.set(series.id, !isLaterHalf);
  }
  return result;
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
 * A weekly class meets every week wherever it is anchored. A new class starts
 * with the timetable (`startsWithTimetable`), so how far back it is visible is
 * the timetable's start and not this date at all; the timetable's start is
 * still what it is given, so the stored anchor reads sensibly, and the tapped
 * week wins when it is earlier.
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
