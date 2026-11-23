/**
 * User-chosen start dates for repeating classes.
 *
 * Beta 2 lets a weekly or every-two-weeks class start on a date the user
 * picks, instead of reaching back as far as the timetable does. It is built
 * from what was already there — `startsOn` as the chosen date and
 * `startsWithTimetable` false — so what this proves is that every reader
 * honours the same bound, and that nothing about a class whose start was never
 * touched has moved:
 *
 *  - no occurrence, reminder, clash or exported event before the first lesson;
 *  - an alternating class counts its fortnight from that first lesson, and
 *    keeps counting from it through later edits;
 *  - a new start is a whole-series edit, and the exceptions a re-anchored rule
 *    no longer has are retired rather than left to draw stray lessons;
 *  - a split series cannot silently be stretched back over its other half.
 *
 * Run it with `node harness/run.mjs`.
 */

import { calendarOccurrencesIn } from "@/domain/calendarExport";
import {
  applyClassEditScope,
  blockedScopeReasons,
  classEditorSchedule,
  createPendingClassEdit,
  editorSeriesStart,
  onlyThisBlockedReason,
  thisAndFutureBlockedReason,
} from "@/domain/classEdit";
import { addDaysIso } from "@/domain/date";
import { findOccurrenceConflict, findPlacementConflict } from "@/domain/conflict";
import { resolveOccurrences } from "@/domain/occurrence";
import { firstSeriesDate, OPEN_ENDED_DATE } from "@/domain/recurrence";
import { planReminders } from "@/domain/reminderSchedule";
import { generateTimeSlots } from "@/domain/time";
import { check, equal, section } from "./report.mjs";

const NOW = "2026-09-11T09:00:00.000Z";
const START = "2026-09-07"; // the timetable's start, a Monday
const TEXT = { startsIn: (lead) => `in ${lead}`, room: (room) => `Room ${room}` };

function slots() {
  const result = generateTimeSlots({ dayStart: "08:00", lessonDurationMinutes: 45, breakDurationMinutes: 10, slotCount: 4 });
  if (!result.ok) throw new Error("fixture academic day does not generate");
  return result.slots.map((slot, index) => ({ id: `slot-${index + 1}`, ...slot }));
}

function course(id, name) {
  return { id, name, room: "", teacher: "", notes: "", appearanceId: "blue", createdAt: NOW, updatedAt: NOW, deletedAt: null };
}

function placement(id, courseId, fields) {
  return {
    id,
    courseId,
    weekday: "monday",
    timeSlotId: "slot-2",
    slotSpan: 1,
    recurrenceType: "weekly",
    startsOn: START,
    endsOn: OPEN_ENDED_DATE,
    startsWithTimetable: true,
    reminderMinutes: 15,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...fields,
  };
}

function exception(id, placementId, fields) {
  return {
    id,
    placementId,
    state: "modified",
    timeSlotId: null,
    slotSpan: null,
    name: null,
    room: null,
    teacher: null,
    notes: null,
    appearanceId: null,
    reminderMinutes: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...fields,
  };
}

function timetable(placements, exceptions = [], courses = [course("c-a", "Algebra"), course("c-b", "Biology")]) {
  return { timeSlots: slots(), courses, placements, exceptions, timetableStart: START };
}

/** Every Monday-ish date in a range, so "which weeks" questions are literal. */
function days(from, until) {
  const dates = [];
  for (let date = from; date <= until; date = addDaysIso(date, 1)) dates.push(date);
  return dates;
}

function drawn(state, placementId, from = "2026-08-01", until = "2026-12-31") {
  return resolveOccurrences(state, days(from, until))
    .filter((occurrence) => occurrence.basePlacement.id === placementId)
    .map((occurrence) => occurrence.date)
    .sort();
}

/** The editor's save of a start choice, made from the occurrence on `date`. */
function startEdit(state, placementId, date, start, extra = {}) {
  const occurrence = resolveOccurrences(state, [date]).find((candidate) => candidate.basePlacement.id === placementId);
  if (!occurrence) throw new Error(`no occurrence of ${placementId} on ${date}`);
  const base = occurrence.basePlacement;
  const schedule = classEditorSchedule({
    recurrenceType: extra.recurrenceType ?? base.recurrenceType,
    tappedDate: occurrence.date,
    onceDate: occurrence.date,
    timetableStart: state.timetableStart,
    base,
    start,
  });
  return createPendingClassEdit({
    occurrence,
    source: "editor",
    effectiveDate: occurrence.date,
    weekday: occurrence.weekday,
    timeSlotId: occurrence.placement.timeSlotId,
    slotSpan: occurrence.placement.slotSpan,
    name: extra.name ?? occurrence.course.name,
    recurrenceType: extra.recurrenceType ?? base.recurrenceType,
    startsOn: schedule.startsOn,
    endsOn: schedule.endsOn,
    startsWithTimetable: schedule.startsWithTimetable,
  }).draft;
}

/* ------------------------------------------ A: a class that starts later */

function testLaterStart() {
  section("Start A. A class that begins after the timetable starts");

  // As the editor saves a new weekly class with "Starts on 5 Oct".
  const schedule = classEditorSchedule({
    recurrenceType: "weekly",
    tappedDate: "2026-09-14",
    onceDate: "2026-09-14",
    timetableStart: START,
    start: { withTimetable: false, date: "2026-10-05" },
  });
  equal("the chosen date is the series' start", schedule.startsOn, "2026-10-05");
  equal("...it does not start with the timetable", schedule.startsWithTimetable, false);
  equal("...and it is open-ended", schedule.endsOn, OPEN_ENDED_DATE);

  const state = timetable([placement("p-a", "c-a", { startsOn: schedule.startsOn, startsWithTimetable: false })]);
  const dates = drawn(state, "p-a");
  equal("no occurrence is drawn before the chosen date", dates.filter((date) => date < "2026-10-05").length, 0);
  equal("...the first one is on it", dates[0], "2026-10-05");
  equal("...and it repeats every week after", dates.slice(0, 3).join(","), "2026-10-05,2026-10-12,2026-10-19");

  // A date that is not the class's weekday starts at the next one.
  const midweek = timetable([placement("p-a", "c-a", { startsOn: "2026-10-07", startsWithTimetable: false })]);
  equal("a Wednesday start for a Monday class first meets the next Monday", drawn(midweek, "p-a")[0], "2026-10-12");
  equal(
    "...which is what the editor names as the first lesson",
    firstSeriesDate({ weekday: "monday", recurrenceType: "weekly", startsOn: "2026-10-07", endsOn: OPEN_ENDED_DATE, startsWithTimetable: false }),
    "2026-10-12",
  );

  // Reminders, the calendar export and the clash check read the same bound.
  const plan = (fromDate) =>
    planReminders({ ...state, fromDate, now: Date.parse(`${fromDate}T00:00:00`), text: TEXT }).filter(
      (reminder) => reminder.placementId === "p-a",
    );
  equal("no reminder is planned in the weeks before it starts", plan("2026-09-14").length, 0);
  equal("...the window that reaches its start reminds only from it", plan("2026-09-28").map((reminder) => reminder.date).join(","), "2026-10-05");

  const snapshot = { timetable: { id: "t", name: "T", anchorDate: START, createdAt: NOW, updatedAt: NOW }, ...state };
  const events = calendarOccurrencesIn(snapshot, { from: START, to: "2026-10-31" }, { teacher: (name) => name });
  equal("the calendar export has nothing before the start", events[0]?.date, "2026-10-05");
  equal("...and every Monday from it", events.length, 4);

  const before = findOccurrenceConflict(state, { occurrenceId: null, date: "2026-09-28", timeSlotId: "slot-2", slotSpan: 1 });
  equal("a one-off in its slot before it starts overlaps nothing", before, undefined);
  const after = findOccurrenceConflict(state, { occurrenceId: null, date: "2026-10-12", timeSlotId: "slot-2", slotSpan: 1 });
  equal("...after it starts it overlaps it", after?.course.name, "Algebra");
  const series = findPlacementConflict(state, placement("p-new", "c-b", { recurrenceType: "biweekly", startsOn: "2026-09-14", endsOn: "2026-09-28", startsWithTimetable: false }));
  equal("a series that ends before it starts overlaps nothing", series, undefined);
}

/* ------------------------------------------------------- B: parity */

function testParity() {
  section("Start B. An alternating class counts its fortnight from its chosen first lesson");

  const state = timetable([placement("p-b", "c-b", { recurrenceType: "biweekly", startsOn: "2026-10-07", startsWithTimetable: false })]);
  equal(
    "first lesson on the Monday after a Wednesday start, then every other week",
    drawn(state, "p-b").slice(0, 3).join(","),
    "2026-10-12,2026-10-26,2026-11-09",
  );

  // A rename changes no week.
  const renamed = applyClassEditScope(state, startEdit(state, "p-b", "2026-10-26", undefined, { name: "Biology II" }), "all", NOW);
  check("a rename applies", renamed.ok, JSON.stringify(renamed.error ?? null));
  equal("...and the weeks are the same", drawn(renamed.next, "p-b").join(","), drawn(state, "p-b").join(","));

  // A new start one week later moves the class onto the other half.
  const moved = startEdit(state, "p-b", "2026-10-26", { withTimetable: false, date: "2026-10-19" });
  equal("a new start date is a start change", moved.changed.start, true);
  const all = applyClassEditScope(state, moved, "all", NOW);
  check("it applies to all occurrences", all.ok, JSON.stringify(all.error ?? null));
  equal(
    "...the first lesson is the new date, and the fortnight follows it",
    drawn(all.next, "p-b").slice(0, 3).join(","),
    "2026-10-19,2026-11-02,2026-11-16",
  );

  // Dragged a day later at "all": the series and its parity travel together.
  const occurrence = resolveOccurrences(all.next, ["2026-11-02"]).find((candidate) => candidate.basePlacement.id === "p-b");
  const { draft: drag } = createPendingClassEdit({
    occurrence,
    source: "move",
    effectiveDate: "2026-11-03",
    weekday: "tuesday",
    timeSlotId: "slot-2",
    slotSpan: 1,
  });
  const dragged = applyClassEditScope(all.next, drag, "all", NOW);
  check("the alternating class is moved to Tuesdays", dragged.ok, JSON.stringify(dragged.error ?? null));
  equal(
    "...still on the same fortnight, from the day after its start",
    drawn(dragged.next, "p-b").slice(0, 3).join(","),
    "2026-10-20,2026-11-03,2026-11-17",
  );

  // Back to "with the timetable": the anchor stays, so the weeks do too.
  const back = applyClassEditScope(all.next, startEdit(all.next, "p-b", "2026-11-02", { withTimetable: true }), "all", NOW);
  check("switching back to the timetable's start applies", back.ok, JSON.stringify(back.error ?? null));
  const reached = drawn(back.next, "p-b");
  equal("...it reaches back to the timetable's first matching week", reached[0], "2026-09-07");
  check(
    "...on the same half of the fortnight",
    reached.includes("2026-10-19") && reached.includes("2026-11-02") && !reached.includes("2026-10-26"),
    reached.slice(0, 6).join(","),
  );
}

/* ---------------------------------- C: scopes and exceptions under a new start */

function testScopesAndExceptions() {
  section("Start C. A start is a whole-series edit, and exceptions it orphans are retired");

  const state = timetable(
    [placement("p-b", "c-b", { recurrenceType: "biweekly", startsOn: "2026-10-12", startsWithTimetable: false })],
    [
      // Before the new start: out of range, and kept for a start moved back.
      exception("e-early", "p-b", { originalDate: "2026-10-12", effectiveDate: "2026-10-12", room: "Lab 1" }),
      // On the weeks the new start no longer meets: retired.
      exception("e-cancel", "p-b", { originalDate: "2026-10-26", effectiveDate: "2026-10-26", state: "cancelled" }),
      exception("e-moved", "p-b", { originalDate: "2026-11-09", effectiveDate: "2026-11-10" }),
    ],
  );

  const draft = startEdit(state, "p-b", "2026-10-12", { withTimetable: false, date: "2026-10-19" });
  check("only this occurrence is not offered for a new start", onlyThisBlockedReason(draft)?.key === "errors.startWholeSeries");
  check("...and neither is this and future", thisAndFutureBlockedReason(draft)?.key === "errors.startWholeSeries");
  equal("...so the chooser disables both", Object.keys(blockedScopeReasons(draft)).sort().join(","), "onlyThis,thisAndFuture");
  equal("this and future is refused if asked anyway", applyClassEditScope(state, draft, "thisAndFuture", NOW).ok, false);
  equal("...and so is only this", applyClassEditScope(state, draft, "onlyThis", NOW).ok, false);

  const all = applyClassEditScope(state, draft, "all", NOW);
  check("all occurrences applies", all.ok, JSON.stringify(all.error ?? null));
  const byId = (id) => all.next.exceptions.find((entry) => entry.id === id);
  equal("an exception before the new start is kept", byId("e-early").deletedAt, null);
  check("a cancellation on a week the class no longer meets is retired", byId("e-cancel").deletedAt !== null);
  check("...and so is a moved lesson from one", byId("e-moved").deletedAt !== null);
  equal(
    "nothing stray is drawn on the old weeks",
    drawn(all.next, "p-b", "2026-10-01", "2026-11-30").join(","),
    "2026-10-19,2026-11-02,2026-11-16,2026-11-30",
  );

  // A rename does not change the rule, so it retires nothing.
  const renamed = applyClassEditScope(state, startEdit(state, "p-b", "2026-10-12", undefined, { name: "Bio" }), "all", NOW);
  equal("a rename keeps every exception", renamed.next.exceptions.filter((entry) => entry.deletedAt).length, 0);
  equal("...and leaves every scope available", Object.keys(blockedScopeReasons(startEdit(state, "p-b", "2026-10-12", undefined, { name: "Bio" }))).length, 0);
}

/* --------------------------------- D: existing classes keep their behaviour */

function testExistingClasses() {
  section("Start D. Classes saved before Beta 2 keep their behaviour; splits stay apart");

  const ordinary = placement("p-a", "c-a", {});
  equal("an ordinary class opens as starting with the timetable", editorSeriesStart(ordinary, "2026-10-05", START).withTimetable, true);

  // A split: Algebra until 11 Oct, then a later half from 12 Oct.
  const earlier = placement("p-old", "c-a", { endsOn: "2026-10-11" });
  const later = placement("p-new", "c-a", { startsOn: "2026-10-12", startsWithTimetable: false });
  const state = timetable([earlier, later]);
  const shown = editorSeriesStart(later, "2026-10-19", START);
  equal("a split's later half opens showing its own first lesson", `${shown.withTimetable}:${shown.date}`, "false:2026-10-12");

  const untouched = startEdit(state, "p-new", "2026-10-19", undefined, { name: "Algebra II" });
  equal("untouched, the editor keeps the stored anchor", untouched.startsOn, later.startsOn);
  equal("...and it is not a start change", untouched.changed.start, false);
  const sameDate = startEdit(state, "p-new", "2026-10-19", { withTimetable: false, date: "2026-10-12" });
  equal("re-picking the same first lesson is not a start change either", sameDate.changed.start, false);

  // Stretching the later half back over the earlier one: same slot, same
  // weeks — the overlap check is what stops it being silent.
  const stretched = applyClassEditScope(state, startEdit(state, "p-new", "2026-10-19", { withTimetable: false, date: "2026-09-21" }), "all", NOW);
  equal("moving a later half's start into its earlier half is stopped", stretched.ok, false);
  equal("...as an overlap with the earlier half", stretched.overlapWith, "Algebra");
  const reachBack = applyClassEditScope(state, startEdit(state, "p-new", "2026-10-19", { withTimetable: true }), "all", NOW);
  equal("...and so is letting it reach back with the timetable", reachBack.overlapWith, "Algebra");
  const forward = applyClassEditScope(state, startEdit(state, "p-new", "2026-10-19", { withTimetable: false, date: "2026-11-02" }), "all", NOW);
  check("moving it later is fine", forward.ok, JSON.stringify(forward.error ?? null));
  equal("...the earlier half still ends where it was split", drawn(forward.next, "p-old").pop(), "2026-10-05");
  equal("...and the later half now starts on the new date", drawn(forward.next, "p-new")[0], "2026-11-02");
}

export function runSeriesStartHarness() {
  testLaterStart();
  testParity();
  testScopesAndExceptions();
  testExistingClasses();
}
