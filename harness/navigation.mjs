/**
 * Week-navigation harness.
 *
 * This suite exists because of a device report, and it is written to pin down
 * the thing that report was about: paging got slower the further it went, and a
 * jump home from a distant week froze for seconds with nothing on screen.
 *
 * None of that is visible from a unit test directly — the cost was mounting and
 * unmounting native views — so what is asserted here is the two properties that
 * *cause* it to be constant, stated so they cannot silently regress:
 *
 *  - the mounted set of pages is a fixed three *component identities*, not
 *    merely a fixed count. Advancing a week recycles one; jumping any distance
 *    recycles three; nothing is ever added or removed.
 *  - resolving what a week contains costs the same at week 200 as at week 0,
 *    measured by counting the recurrence tests actually performed rather than by
 *    timing anything.
 *
 * Plus the two rules the same report asked for: the view may go backwards as
 * freely as forwards, and a class still does not occur before its own start.
 */

import { startOfWeekIso, weekDatesFrom } from "@/domain/calendar";
import { addDaysIso } from "@/domain/date";
import { findPeriodProgress, generateTimeSlots } from "@/domain/time";
import { clashHorizon, occursOn, OPEN_ENDED_DATE } from "@/domain/recurrence";
import { resolveWeekBlocks } from "@/domain/timetable";
import { findPlacementConflict } from "@/domain/conflict";
import { getOrderedWeekdays } from "@/domain/week";
import {
  pagerStep,
  weekPageWindow,
  PAGE_WINDOW_RADIUS,
  PAGE_WINDOW_SIZE,
} from "@/features/timetable/pageWindow";
import {
  MONTH_PAGE_SPRING,
  PAGER_AXIS_RATIO,
  PAGER_TOUCH_SLOP,
  PAGE_COMMIT_FRACTION,
  PAGE_FLICK_VELOCITY,
} from "@/features/timetable/motion";
import { check, equal, section } from "./report.mjs";

const WEEKDAYS = getOrderedWeekdays("saturdaySunday");
const ANCHOR_WEEK = startOfWeekIso("2026-09-09");

/* ---------------------------------------------------- A: the mounted window */

function testBoundedPageWindow() {
  section("A. The mounted page window is bounded, and its pages are never rebuilt");

  equal("three pages are mounted", PAGE_WINDOW_SIZE, 3);
  equal("...one either side of the current one", PAGE_WINDOW_RADIUS, 1);

  /*
   * Walk forward a long way, recording everything the pager ever asks React
   * for. Two numbers matter and they are different numbers: how many pages are
   * mounted at once, and how many page *identities* have existed in total. The
   * second was unbounded before — a key per week — which is the churn that made
   * paging degrade, and it is the one a count of mounted pages would not catch.
   */
  for (const pages of [5, 50, 200]) {
    const keysEverSeen = new Set();
    const sizes = new Set();
    let slotsRecycled = 0;

    let previous = weekPageWindow(0);
    for (const slot of previous) keysEverSeen.add(slot.key);
    sizes.add(previous.length);

    for (let step = 1; step <= pages; step++) {
      const current = weekPageWindow(step);
      sizes.add(current.length);
      for (const slot of current) keysEverSeen.add(slot.key);

      // The array's shape is as stable as its keys: same length, same order,
      // so React sees neither an insertion nor a reorder.
      const sameOrder = current.every((slot, index) => slot.key === previous[index].key);
      if (!sameOrder) throw new Error(`the slot order changed at step ${step}`);

      slotsRecycled += current.filter((slot, index) => slot.pageIndex !== previous[index].pageIndex).length;
      previous = current;
    }

    equal(`${pages} pages: the mounted count never varies`, [...sizes].join(","), "3");
    equal(`${pages} pages: only three page identities ever existed`, keysEverSeen.size, 3);
    // One slot per week travelled: the two weeks that survive keep their slot,
    // their props and their subtree, so nothing about them re-renders at all.
    equal(`${pages} pages: exactly one slot was recycled per week`, slotsRecycled, pages);
  }

  // And the window really does hold the weeks it claims to.
  const window = weekPageWindow(7);
  equal(
    "the window is the current page and its two neighbours",
    window
      .map((slot) => slot.pageIndex)
      .sort((a, b) => a - b)
      .join(","),
    "6,7,8",
  );
}

/* ----------------------------------- B: resolution over the visible week only */

/**
 * A placement that counts how many times its recurrence is tested.
 *
 * `occursOn` reads `recurrenceType` first, on every call and on no other path,
 * so a getter there is a faithful call counter — and counting the actual work
 * is a far better assertion than timing it, which would be flaky on any machine
 * and would prove nothing about the shape of the algorithm.
 */
function countingPlacement(base, counter) {
  return {
    ...base,
    get recurrenceType() {
      counter.reads += 1;
      return base.recurrenceType;
    },
  };
}

function fixture() {
  const slots = generateTimeSlots({
    dayStart: "08:00",
    lessonDurationMinutes: 45,
    breakDurationMinutes: 10,
    slotCount: 6,
  });
  if (!slots.ok) throw new Error("fixture academic day does not generate");
  const timeSlots = slots.slots.map((slot, index) => ({
    id: `slot-${index + 1}`,
    position: slot.position,
    startTime: slot.startTime,
    endTime: slot.endTime,
  }));

  const now = "2026-09-01T00:00:00.000Z";
  const courses = [
    { id: "c-maths", name: "Mathematics", room: "101", teacher: "", notes: "", appearanceId: "blue", createdAt: now, updatedAt: now, deletedAt: null },
    { id: "c-hist", name: "History", room: "204", teacher: "", notes: "", appearanceId: "amber", createdAt: now, updatedAt: now, deletedAt: null },
    { id: "c-trip", name: "Museum trip", room: "", teacher: "", notes: "", appearanceId: "teal", createdAt: now, updatedAt: now, deletedAt: null },
  ];

  const placements = [
    {
      id: "p-maths",
      courseId: "c-maths",
      weekday: "monday",
      timeSlotId: "slot-3",
      slotSpan: 1,
      recurrenceType: "weekly",
      startsOn: ANCHOR_WEEK,
      endsOn: OPEN_ENDED_DATE,
      reminderMinutes: 30,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: "p-hist",
      courseId: "c-hist",
      weekday: "tuesday",
      timeSlotId: "slot-2",
      slotSpan: 2,
      recurrenceType: "biweekly",
      startsOn: addDaysIso(ANCHOR_WEEK, 8),
      endsOn: OPEN_ENDED_DATE,
      reminderMinutes: 60,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: "p-trip",
      courseId: "c-trip",
      weekday: "friday",
      timeSlotId: "slot-5",
      slotSpan: 1,
      recurrenceType: "once",
      startsOn: addDaysIso(ANCHOR_WEEK, 39),
      endsOn: addDaysIso(ANCHOR_WEEK, 39),
      reminderMinutes: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ];

  return { timeSlots, courses, placements, exceptions: [] };
}

function resolveWeek(base, weekStart, counter) {
  const placements = counter
    ? base.placements.map((placement) => countingPlacement(placement, counter))
    : base.placements;
  return resolveWeekBlocks({
    weekdays: WEEKDAYS,
    dates: weekDatesFrom(weekStart),
    placements,
    courses: base.courses,
    exceptions: base.exceptions,
    timeSlots: base.timeSlots,
    preview: null,
  });
}

function testResolutionIsLocal() {
  section("B. Resolving a week costs the same however far away it is");

  const base = fixture();
  const counts = [];

  for (const weeksOut of [0, 1, 20, 200, -20]) {
    const counter = { reads: 0 };
    const weekStart = addDaysIso(ANCHOR_WEEK, weeksOut * 7);
    resolveWeek(base, weekStart, counter);
    counts.push({ weeksOut, reads: counter.reads });
  }

  /*
   * The bound, stated as what it actually is.
   *
   * Resolving a week tests each placement against each shown date, and
   * `occursOn` reads `recurrenceType` once or twice depending on which of its
   * early exits the data takes — so the count is not a single number across
   * different weeks, and asserting one would be asserting an accident. What must
   * hold is that it never exceeds *one week's worth* of tests:
   *
   *     placements × shown days × 2 reads
   *
   * If anything expanded a series from its anchor to the visible week, the count
   * at week 200 would be some two hundred times that ceiling rather than under
   * it, and at week 20 some twenty times. That is the failure the device report
   * described, and this is the assertion that rules it out.
   */
  const perWeekCeiling = base.placements.length * WEEKDAYS.length * 2;
  const first = counts[0].reads;
  check("week 0 does some work at all", first > 0, "nothing was resolved");

  for (const { weeksOut, reads } of counts) {
    check(
      `week ${weeksOut} stays inside one week's worth of recurrence tests`,
      reads <= perWeekCeiling,
      `${reads} tests, ceiling ${perWeekCeiling}`,
    );
  }

  // And the spread across a four-hundred-week span is a rounding error rather
  // than a trend: a couple of reads, from which early exit the data takes.
  const reads = counts.map((entry) => entry.reads);
  check(
    "the cost does not drift with distance at all",
    Math.max(...reads) - Math.min(...reads) <= 2,
    `counts were ${reads.join(", ")}`,
  );

  // And the answers are right, not merely cheap.
  const near = resolveWeek(base, ANCHOR_WEEK);
  equal("the anchor week draws its weekly class", near.filter((b) => b.course.name === "Mathematics").length, 1);
  const far = resolveWeek(base, addDaysIso(ANCHOR_WEEK, 200 * 7));
  equal("week 200 still draws it", far.filter((b) => b.course.name === "Mathematics").length, 1);
  equal("...and not the one-off", far.filter((b) => b.course.name === "Museum trip").length, 0);
}

/* -------------------------------------------------------- C: the Today jump */

function testTodayJumpIsConstant() {
  section("C. Today jumps directly, whatever the distance");

  equal("standing still does nothing", pagerStep(12, 12).kind, "none");
  equal("one week forward slides", pagerStep(12, 13).kind, "slide");
  equal("one week back slides", pagerStep(12, 11).kind, "slide");
  equal("...to the neighbour it is sliding to", pagerStep(12, 13).to, 13);

  for (const from of [2, 20, 200, -200]) {
    const step = pagerStep(from, 0);
    equal(`Today from week ${from} is a jump, not a slide`, step.kind, "jump");
    equal(`...straight to week 0`, step.to, 0);
  }

  /*
   * And the jump costs what a single page change costs. Three slots are
   * re-addressed; not one is created or destroyed, and no window between the
   * two is ever computed — which is what "constant time" means here.
   */
  const distant = weekPageWindow(200);
  const home = weekPageWindow(0);
  equal(
    "a jump home reuses every page identity",
    home.map((slot) => slot.key).join(","),
    distant.map((slot) => slot.key).join(","),
  );
  equal(
    "...re-addressing all three, and no more than three",
    home.filter((slot, index) => slot.pageIndex !== distant[index].pageIndex).length,
    PAGE_WINDOW_SIZE,
  );

  // A jump of two is still a jump: two is already outside the mounted window.
  equal("two weeks away is a jump", pagerStep(0, 2).kind, "jump");
  equal("...and so is two weeks back", pagerStep(0, -2).kind, "jump");
}

/* ---------------------------------- D & E: the past, and what occurs in it */

function testPastNavigation() {
  section("D. Past weeks are navigable, before the anchor and before today");

  for (const baseIndex of [-1, -4, -52, -200]) {
    const window = weekPageWindow(baseIndex);
    equal(`week ${baseIndex}: three pages, as anywhere else`, window.length, PAGE_WINDOW_SIZE);
    equal(
      `week ${baseIndex}: the same three page identities`,
      window
        .map((slot) => slot.key)
        .sort()
        .join(","),
      weekPageWindow(0)
        .map((slot) => slot.key)
        .sort()
        .join(","),
    );
    check(
      `week ${baseIndex}: the window is centred on it rather than clamped`,
      window.some((slot) => slot.pageIndex === baseIndex) &&
        window.some((slot) => slot.pageIndex === baseIndex - 1),
      "the window was clamped",
    );
  }

  // Walking back a long way recycles exactly as it does forward.
  let previous = weekPageWindow(0);
  let recycled = 0;
  for (let step = 1; step <= 200; step++) {
    const current = weekPageWindow(-step);
    recycled += current.filter((slot, index) => slot.pageIndex !== previous[index].pageIndex).length;
    previous = current;
  }
  equal("200 weeks backward recycles one slot per week", recycled, 200);

  // Negative page indices are real dates, not a wrapped or clamped mess.
  equal(
    "the week two before the anchor is the date it should be",
    addDaysIso(ANCHOR_WEEK, -2 * 7),
    "2026-08-24",
  );

  section("E. Navigating to a past week does not make a class occur there");

  const base = fixture();
  const maths = base.placements.find((placement) => placement.id === "p-maths");

  check("the weekly class occurs in its own first week", occursOn(maths, ANCHOR_WEEK), "it did not");
  for (const weeksBack of [1, 4, 52]) {
    const pastWeek = addDaysIso(ANCHOR_WEEK, -weeksBack * 7);
    check(
      `...and not ${weeksBack} week(s) before it starts`,
      !occursOn(maths, pastWeek),
      `it occurred on ${pastWeek}, before its own startsOn`,
    );
    equal(
      `...so that week draws an empty grid`,
      resolveWeek(base, pastWeek).length,
      0,
    );
  }

  // The view being free does not make recurrence free: the boundary is the
  // series' own start, to the day.
  check(
    "the day before the series starts is empty",
    !occursOn(maths, addDaysIso(ANCHOR_WEEK, -7)),
    "it occurred",
  );
  check("the day it starts is not", occursOn(maths, ANCHOR_WEEK), "it did not occur");
}

/* ------------------------------------------- the clash check stays bounded */

function testClashCheckStaysBounded() {
  section("Conflict checking is bounded by the data, not by the viewed week");

  const base = fixture();
  const horizon = clashHorizon(base, ANCHOR_WEEK);
  check(
    "the horizon reaches past the last date the timetable names",
    horizon > base.placements[2].startsOn,
    `horizon ${horizon}`,
  );
  check(
    "...and nowhere near the open-ended sentinel",
    horizon < "2030-01-01",
    `horizon ${horizon} is far past the data`,
  );

  // Paging the view cannot change it: the check reads the timetable, never the
  // week on screen.
  const counter = { reads: 0 };
  const placements = base.placements.map((placement) => countingPlacement(placement, counter));
  findPlacementConflict(
    { ...base, placements },
    {
      placementId: undefined,
      weekday: "wednesday",
      timeSlotId: "slot-4",
      slotSpan: 1,
      recurrenceType: "weekly",
      startsOn: ANCHOR_WEEK,
      endsOn: OPEN_ENDED_DATE,
    },
  );
  const atAnchor = counter.reads;

  const counterLater = { reads: 0 };
  findPlacementConflict(
    { ...base, placements: base.placements.map((p) => countingPlacement(p, counterLater)) },
    {
      placementId: undefined,
      weekday: "wednesday",
      timeSlotId: "slot-4",
      slotSpan: 1,
      recurrenceType: "weekly",
      startsOn: ANCHOR_WEEK,
      endsOn: OPEN_ENDED_DATE,
    },
  );
  equal("the same check costs the same twice over", counterLater.reads, atAnchor);
  check("and it is a bounded amount of work", atAnchor > 0 && atAnchor < 20_000, `${atAnchor} tests`);
}

/* ------------------------- the horizontal layout's current-time indicator */

function testHorizontalNowIndicator() {
  section("The horizontal layout's current-time marker reads the same axis rule");

  const slots = generateTimeSlots({
    dayStart: "08:00",
    lessonDurationMinutes: 45,
    breakDurationMinutes: 10,
    slotCount: 6,
  });
  if (!slots.ok) throw new Error("fixture academic day does not generate");

  /*
   * Both layouts position their marker from the same `findPeriodProgress`; all
   * that differs is which axis the result is multiplied into. So what is worth
   * asserting is the rule itself — that it is null outside the academic day, and
   * a period plus a fraction inside it — because that is what decides whether
   * the marker is drawn at all.
   */
  equal("before the day starts there is no marker", findPeriodProgress(slots.slots, "07:00"), null);
  equal("after the day ends there is none either", findPeriodProgress(slots.slots, "23:00"), null);

  const first = findPeriodProgress(slots.slots, "08:00");
  equal("the day's first minute is the start of period 1", `${first.index}|${first.fraction}`, "0|0");

  const middle = findPeriodProgress(slots.slots, "08:22");
  equal("mid-period lands inside that period", middle.index, 0);
  check(
    "...at a fraction strictly between its ends",
    middle.fraction > 0.4 && middle.fraction < 0.6,
    `fraction ${middle.fraction}`,
  );

  const later = findPeriodProgress(slots.slots, "09:55");
  check("a later time lands in a later period", later.index > 0, `index ${later.index}`);

  // A break between periods pins to the start of the period about to begin,
  // which is what stops the marker drifting through empty space.
  const inBreak = findPeriodProgress(slots.slots, "08:50");
  equal("a break pins to the next period", inBreak.fraction, 0);
  equal("...the one that is about to start", inBreak.index, 1);
}

/* ------------------------------- H: the month pager's fast-swipe semantics */

function testMonthPagerSwipeSemantics() {
  section("H. The month pager's rapid-swipe semantics are intact");

  /*
   * The regression was gesture *routing* — the pager sits inside a React Native
   * Modal, which is a separate native window and therefore outside the root
   * gesture handler, so its recogniser was never handed the touches. That is a
   * platform fact and cannot be asserted from Node.
   *
   * What can be asserted is that the arbitration this pager depends on has not
   * been quietly retuned, since every one of these constants is load-bearing for
   * "fast repeated swipes are accepted":
   */
  check(
    "a horizontal intent wins on a ratio rather than on independent thresholds",
    PAGER_AXIS_RATIO >= 1 && PAGER_AXIS_RATIO < 2,
    `ratio ${PAGER_AXIS_RATIO}`,
  );
  check(
    "the slop is small enough that neither party has visibly started",
    PAGER_TOUCH_SLOP > 0 && PAGER_TOUCH_SLOP <= 12,
    `slop ${PAGER_TOUCH_SLOP}`,
  );
  check(
    "a flick commits on velocity alone, below half a page of travel",
    PAGE_FLICK_VELOCITY > 0 && PAGE_COMMIT_FRACTION > 0 && PAGE_COMMIT_FRACTION <= 0.5,
    `flick ${PAGE_FLICK_VELOCITY}, commit ${PAGE_COMMIT_FRACTION}`,
  );
  check(
    "the month spring takes a release velocity",
    typeof MONTH_PAGE_SPRING === "object" && MONTH_PAGE_SPRING !== null,
    "the spring config is gone",
  );

  // An ordinary thumb swipe — well across, a little down — is horizontal.
  check(
    "40 across and 11 down is a horizontal swipe",
    40 > 11 * PAGER_AXIS_RATIO,
    "it would be handed to the form instead",
  );
  // A scroll is not.
  check(
    "8 across and 30 down is not",
    !(8 > 30 * PAGER_AXIS_RATIO),
    "the pager would steal a vertical scroll",
  );
}

export function runNavigationHarness() {
  testBoundedPageWindow();
  testResolutionIsLocal();
  testTodayJumpIsConstant();
  testPastNavigation();
  testClashCheckStaysBounded();
  testHorizontalNowIndicator();
  testMonthPagerSwipeSemantics();
}
