/**
 * Overlapping classes tests.
 *
 * Beta 2 lets the user keep two classes in the same slot on purpose — a lab
 * alongside a lecture, two electives of which they attend one. What has to be
 * true for that to be safe is mostly about what is *still there*:
 *
 *  - the clash is still detected, on concrete dates, through exceptions and
 *    alternating weeks, exactly as before; it is only no longer final;
 *  - a confirmed overlap keeps both classes, untouched, through every edit
 *    scope, a cold reopen and a `.temelo` round trip;
 *  - both orientations draw both classes, and each one stays reachable on its
 *    own;
 *  - reminders and the calendar export carry both, as two classes.
 *
 * Run it with `npm test` (or `node --import ./tests/support/setup.mjs --test tests/overlap.test.mjs` alone).
 */

import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { weekDatesFrom } from "@/domain/calendar";
import { calendarOccurrencesIn } from "@/domain/calendarExport";
import { applyClassEditScope, createPendingClassEdit } from "@/domain/classEdit";
import { findOccurrenceConflict, findPlacementConflict, sameOccupancy } from "@/domain/conflict";
import { resolveOccurrences } from "@/domain/occurrence";
import { OPEN_ENDED_DATE } from "@/domain/recurrence";
import { planReminders } from "@/domain/reminderSchedule";
import { generateTimeSlots } from "@/domain/time";
import { assignLanes, blocksAtCell, cellKey, resolveWeekBlocks, resolveWeekClasses } from "@/domain/timetable";
import { createId } from "@/domain/id";
import { DEFAULT_SETTINGS } from "@/state/defaults";
import { openTemeloDatabase } from "@/storage/database";
import { buildTimetableSnapshot, parseTimetableSnapshot, serializeTimetableSnapshot, timetableSettingsOf } from "@/storage/snapshot";
import { createTimetable } from "@/storage/timetableLifecycle";
import { loadTimetable, saveTimetable } from "@/storage/timetableRepository";
import { check, equal, section } from "./support/assertions.mjs";
import { useDatabaseFile } from "./support/sqlite-stub.mjs";

const directory = mkdtempSync(join(tmpdir(), "temelo-overlap-"));
let databaseIndex = 0;

const NOW = "2026-09-11T09:00:00.000Z";
const START = "2026-09-07"; // a Monday
const WEEK_A = "2026-09-14"; // the alternating lab's week
const WEEK_B = "2026-09-21"; // its off week
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

/* ----------------------------------------------------------------- fixture */

function slots() {
  const result = generateTimeSlots({ dayStart: "08:00", lessonDurationMinutes: 45, breakDurationMinutes: 10, slotCount: 6 });
  if (!result.ok) throw new Error("fixture academic day does not generate");
  return result.slots.map((slot, index) => ({ id: `slot-${index + 1}`, ...slot }));
}

function course(id, name, appearanceId = "blue") {
  return { id, name, room: "", teacher: "", notes: "", appearanceId, createdAt: NOW, updatedAt: NOW, deletedAt: null };
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

/**
 * Maths every Monday in period 2; a two-period lab on alternate Mondays from
 * period 2 (the weeks of 14 Sep, 28 Sep, ...); History on Tuesdays; and a
 * cancelled Maths on 21 Sep, which must leave that date's slot free.
 */
function fixture() {
  return {
    timeSlots: slots(),
    courses: [course("c-maths", "Mathematics"), course("c-lab", "Physics lab", "green"), course("c-hist", "History", "amber")],
    placements: [
      placement("p-maths", "c-maths", {}),
      placement("p-lab", "c-lab", { recurrenceType: "biweekly", startsOn: WEEK_A, slotSpan: 2 }),
      placement("p-hist", "c-hist", { weekday: "tuesday" }),
    ],
    exceptions: [],
    timetableStart: START,
  };
}

/** The fixture as it stands once the lab has been allowed to overlap Maths. */
function weekInput(state, weekStart) {
  return {
    weekdays: WEEKDAYS,
    dates: weekDatesFrom(weekStart),
    placements: state.placements,
    courses: state.courses,
    exceptions: state.exceptions,
    timeSlots: state.timeSlots,
    timetableStart: state.timetableStart,
  };
}

function occurrenceOf(state, placementId, date) {
  const found = resolveOccurrences(state, [date]).find((candidate) => candidate.basePlacement.id === placementId);
  if (!found) throw new Error(`no occurrence of ${placementId} on ${date}`);
  return found;
}

/** A drag of one occurrence to another day and period, as the grid drafts it. */
function moveDraft(state, placementId, fromDate, toDate, weekday, timeSlotId, slotSpan) {
  const occurrence = occurrenceOf(state, placementId, fromDate);
  return createPendingClassEdit({
    occurrence,
    source: "move",
    effectiveDate: toDate,
    weekday,
    timeSlotId,
    slotSpan: slotSpan ?? occurrence.placement.slotSpan,
  }).draft;
}

function live(state, id) {
  return state.placements.find((candidate) => candidate.id === id && !candidate.deletedAt);
}

/* ------------------------------------------------------ A: still detected */

function testDetection() {
  section("Overlap A. Clashes are still found on concrete dates");

  const state = fixture();

  const sameSlot = findPlacementConflict(state, placement("p-new", "c-new", {}));
  check("a weekly class in Maths' slot is found to overlap", sameSlot !== undefined, "no clash found");
  equal("...and the overlap names Maths", sameSlot?.course.name, "Mathematics");

  // Period 3 is covered only by the lab's second period, on its own weeks.
  const offParity = findPlacementConflict(state, placement("p-new", "c-new", { timeSlotId: "slot-3", recurrenceType: "biweekly", startsOn: WEEK_B }));
  equal("an alternating class on the lab's off weeks does not overlap it", offParity, undefined);
  const onParity = findPlacementConflict(state, placement("p-new", "c-new", { timeSlotId: "slot-3", recurrenceType: "biweekly", startsOn: WEEK_A }));
  equal("...on the lab's own weeks it does", onParity?.course.name, "Physics lab");
  const weeklyIntoLab = findPlacementConflict(state, placement("p-new", "c-new", { timeSlotId: "slot-3" }));
  equal("a weekly class reaching the lab's second period overlaps it", weeklyIntoLab?.course.name, "Physics lab");

  // A cancelled occurrence leaves its date free; the week after is not.
  const cancelled = {
    ...state,
    exceptions: [
      {
        id: "e-cancel",
        placementId: "p-maths",
        originalDate: WEEK_B,
        effectiveDate: WEEK_B,
        state: "cancelled",
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
      },
    ],
  };
  const onCancelled = findOccurrenceConflict(cancelled, { occurrenceId: null, date: WEEK_B, timeSlotId: "slot-2", slotSpan: 1 });
  equal("a one-off on the date Maths was cancelled overlaps nothing", onCancelled, undefined);
  const onLabWeek = findOccurrenceConflict(cancelled, { occurrenceId: null, date: "2026-09-28", timeSlotId: "slot-2", slotSpan: 1 });
  check("...a week later it overlaps again", onLabWeek !== undefined, "no clash found");

  check(
    "an unchanged placement occupies the same cells as itself",
    sameOccupancy(state.placements[0], { ...state.placements[0] }),
  );
  check(
    "...and a moved one does not",
    !sameOccupancy(state.placements[0], { ...state.placements[0], timeSlotId: "slot-3" }),
  );
}

/* --------------------------------------------- B: confirmed, and preserved */

function testEditScopes() {
  section("Overlap B. Every edit scope stops at an overlap, and keeps both classes once confirmed");

  const state = fixture();
  const mathsBefore = JSON.stringify(live(state, "p-maths"));
  const labBefore = JSON.stringify(live(state, "p-lab"));

  for (const scope of ["onlyThis", "thisAndFuture", "all"]) {
    // History, dragged from Tuesday 15 Sep onto Monday 14 Sep, period 2 — where
    // both Maths and the lab already are that day.
    const draft = moveDraft(state, "p-hist", "2026-09-15", WEEK_A, "monday", "slot-2");
    const refused = applyClassEditScope(state, draft, scope, NOW);
    equal(`${scope}: refused without confirmation`, refused.ok, false);
    check(`${scope}: ...as an overlap, naming a class in the way`, ["Mathematics", "Physics lab"].includes(refused.overlapWith), String(refused.overlapWith));

    const allowed = applyClassEditScope(state, draft, scope, NOW, { allowOverlap: true });
    check(`${scope}: confirmed, it applies`, allowed.ok, JSON.stringify(allowed.error ?? null));
    if (!allowed.ok) continue;
    equal(`${scope}: ...Maths is untouched`, JSON.stringify(live(allowed.next, "p-maths")), mathsBefore);
    equal(`${scope}: ...the lab is untouched`, JSON.stringify(live(allowed.next, "p-lab")), labBefore);
    const onMonday = resolveOccurrences(allowed.next, [WEEK_A]).map((occurrence) => occurrence.course.name).sort();
    equal(`${scope}: ...and all three meet on Monday 14 Sep`, onMonday.join(","), "History,Mathematics,Physics lab");
  }

  // Overlapping, then renamed: the occupancy did not change, so nothing asks.
  const overlapped = applyClassEditScope(state, moveDraft(state, "p-hist", "2026-09-15", WEEK_A, "monday", "slot-2"), "all", NOW, { allowOverlap: true });
  const histOnMonday = occurrenceOf(overlapped.next, "p-hist", "2026-09-21");
  const { draft: rename } = createPendingClassEdit({
    occurrence: histOnMonday,
    source: "editor",
    effectiveDate: histOnMonday.date,
    weekday: histOnMonday.weekday,
    timeSlotId: histOnMonday.placement.timeSlotId,
    slotSpan: histOnMonday.placement.slotSpan,
    name: "World history",
  });
  for (const scope of ["onlyThis", "thisAndFuture", "all"]) {
    const renamed = applyClassEditScope(overlapped.next, rename, scope, NOW);
    check(`a rename of a class already overlapping is not asked about again (${scope})`, renamed.ok, JSON.stringify(renamed.error ?? null));
  }

  // A one-off moved onto a series: only that one date overlaps.
  const withTrip = {
    ...state,
    courses: [...state.courses, course("c-trip", "Museum trip", "teal")],
    placements: [...state.placements, placement("p-trip", "c-trip", { weekday: "wednesday", recurrenceType: "once", startsOn: "2026-09-16", endsOn: "2026-09-16", startsWithTimetable: false })],
  };
  const tripOnMaths = findOccurrenceConflict(withTrip, { occurrenceId: "p-trip|2026-09-16", date: WEEK_B, timeSlotId: "slot-2", slotSpan: 1 });
  equal("a one-off moved to Maths' slot on 21 Sep overlaps Maths", tripOnMaths?.course.name, "Mathematics");
}

/* ------------------------------------------------ C: both orientations */

function testBothOrientations() {
  section("Overlap C. Both layouts draw both classes, each reachable on its own");

  const state = fixture();

  const vertical = resolveWeekBlocks(weekInput(state, WEEK_A));
  const monday = vertical.filter((block) => block.dayIndex === 0);
  equal("vertical: Monday holds both Maths and the lab", monday.map((block) => block.course.name).sort().join(","), "Mathematics,Physics lab");
  const maths = monday.find((block) => block.course.name === "Mathematics");
  const lab = monday.find((block) => block.course.name === "Physics lab");
  equal("...side by side in two lanes", `${maths.laneCount}/${lab.laneCount}`, "2/2");
  check("...in different lanes", maths.lane !== lab.lane, `${maths.lane} and ${lab.lane}`);
  equal("...the longer lab first, so it keeps the left lane", lab.lane, 0);

  const tapped = blocksAtCell(vertical, 0, 1);
  equal("a tap on period 2 finds both classes", tapped.length, 2);
  check("...each by its own occurrence", new Set(tapped.map((block) => block.occurrenceId)).size === 2);
  equal("a tap on period 3 finds the lab alone", blocksAtCell(vertical, 0, 2).map((block) => block.course.name).join(","), "Physics lab");
  equal("...and Tuesday is not affected", blocksAtCell(vertical, 1, 1).map((block) => `${block.course.name}:${block.laneCount}`).join(","), "History:1");

  const offWeek = resolveWeekBlocks(weekInput(state, WEEK_B)).filter((block) => block.dayIndex === 0);
  equal("on the lab's off week Maths has the whole column again", offWeek.map((block) => `${block.course.name}:${block.lane}/${block.laneCount}`).join(","), "Mathematics:0/1");

  const horizontal = resolveWeekClasses(weekInput(state, WEEK_A));
  const cell = horizontal.get(cellKey("monday", "slot-2")) ?? [];
  equal("horizontal: the shared cell lists both classes", cell.length, 2);
  equal("...in the same order as the vertical lanes", cell.map((entry) => entry.course.name).join(","), "Physics lab,Mathematics");
  equal("...the lab's second period lists only the lab", (horizontal.get(cellKey("monday", "slot-3")) ?? []).map((entry) => entry.course.name).join(","), "Physics lab");
  equal(
    "...and on its off week the cell holds Maths alone",
    (resolveWeekClasses(weekInput(state, WEEK_B)).get(cellKey("monday", "slot-2")) ?? []).map((entry) => entry.course.name).join(","),
    "Mathematics",
  );

  // Lane assignment on its own: chains, gaps, and a block that fits back in.
  const lanes = assignLanes([
    { dayIndex: 0, startIndex: 0, span: 3, course: { name: "A" }, occurrenceId: "a" },
    { dayIndex: 0, startIndex: 0, span: 1, course: { name: "B" }, occurrenceId: "b" },
    { dayIndex: 0, startIndex: 2, span: 1, course: { name: "C" }, occurrenceId: "c" },
    { dayIndex: 0, startIndex: 4, span: 1, course: { name: "D" }, occurrenceId: "d" },
    { dayIndex: 1, startIndex: 0, span: 1, course: { name: "E" }, occurrenceId: "e" },
  ]);
  const laneOf = (id) => {
    const block = lanes.find((entry) => entry.occurrenceId === id);
    return `${block.lane}/${block.laneCount}`;
  };
  equal("a three-period class takes the first lane", laneOf("a"), "0/2");
  equal("...one beside it at the start takes the second", laneOf("b"), "1/2");
  equal("...a later one reuses the second lane once it is free", laneOf("c"), "1/2");
  equal("a class after the group has the whole column", laneOf("d"), "0/1");
  equal("another day is laid out on its own", laneOf("e"), "0/1");
}

/* --------------------------------------- D: reminders and calendar export */

function testRemindersAndExport() {
  section("Overlap D. Reminders and the calendar export carry both classes, unchanged");

  const state = fixture();
  const text = { startsIn: (lead) => `in ${lead}`, room: (room) => `Room ${room}` };
  const plan = planReminders({ ...state, fromDate: WEEK_A, now: Date.parse(`${WEEK_A}T00:00:00`), text });
  const onMonday = plan.filter((reminder) => reminder.date === WEEK_A).map((reminder) => reminder.title).sort();
  equal("both overlapping classes are reminded about", onMonday.join(","), "Mathematics,Physics lab");
  equal("...as two separate reminders", new Set(plan.filter((reminder) => reminder.date === WEEK_A).map((reminder) => reminder.key)).size, 2);

  const snapshot = { timetable: { id: "t", name: "Overlap", anchorDate: START, createdAt: NOW, updatedAt: NOW }, ...state };
  const events = calendarOccurrencesIn(snapshot, { from: WEEK_A, to: WEEK_A }, { teacher: (name) => name });
  equal("the calendar export has an event for each", events.map((event) => event.summary).sort().join(","), "Mathematics,Physics lab");
}

/* ------------------------------------------- E: storage and .temelo trip */

async function testPersistence() {
  section("Overlap E. Both classes survive a cold reopen and a snapshot round trip");

  const path = join(directory, `temelo-${databaseIndex++}.db`);
  useDatabaseFile(path);
  const { db } = await openTemeloDatabase();

  const timeSlots = slots().map((slot) => ({ ...slot, id: createId() }));
  const empty = { settings: { ...DEFAULT_SETTINGS }, timetable: null, timeSlots: [], courses: [], placements: [], exceptions: [] };
  const created = await createTimetable(db, empty, {
    name: "Overlaps",
    defaultName: "Timetable",
    settings: { ...timetableSettingsOf(DEFAULT_SETTINGS), slotCount: timeSlots.length },
    timeSlots,
    anchorDate: START,
    now: NOW,
  });
  if (!created.ok) throw new Error("fixture timetable was not created");

  const slotId = timeSlots[1].id;
  const withTwo = {
    ...created.state,
    courses: [course("c-a", "Lecture"), course("c-b", "Seminar", "green")],
    placements: [
      placement("p-a", "c-a", { timeSlotId: slotId }),
      placement("p-b", "c-b", { timeSlotId: slotId }),
    ],
  };
  await saveTimetable(db, withTwo, created.state);
  db.closeSync();

  useDatabaseFile(path);
  const reopened = await openTemeloDatabase();
  const state = await loadTimetable(reopened.db);
  reopened.db.closeSync();
  equal("both classes in one slot are still stored", state.placements.filter((entry) => !entry.deletedAt && entry.timeSlotId === slotId).length, 2);
  equal(
    "...and both are drawn after a cold reopen",
    resolveOccurrences({ ...state, timetableStart: START }, [START]).map((occurrence) => occurrence.course.name).sort().join(","),
    "Lecture,Seminar",
  );

  const snapshot = buildTimetableSnapshot({
    timetable: state.timetable,
    settings: timetableSettingsOf(state.settings),
    timeSlots: state.timeSlots,
    courses: state.courses,
    placements: state.placements,
    exceptions: state.exceptions,
  });
  const parsed = parseTimetableSnapshot(serializeTimetableSnapshot(snapshot));
  check("a snapshot of the overlapping timetable is valid", parsed.ok, parsed.ok ? "" : parsed.reason);
  if (parsed.ok) {
    equal("...and it carries both classes", parsed.snapshot.placements.filter((entry) => entry.timeSlotId === slotId).length, 2);
  }
}

/* ---------------------------------------------------------------- tests */

test("Overlap A. Clashes are still found on concrete dates", () => {
  testDetection();
});

test("Overlap B. Every edit scope stops at an overlap, and keeps both classes once confirmed", () => {
  testEditScopes();
});

test("Overlap C. Both layouts draw both classes, each reachable on its own", () => {
  testBothOrientations();
});

test("Overlap D. Reminders and the calendar export carry both classes, unchanged", () => {
  testRemindersAndExport();
});

test("Overlap E. Both classes survive a cold reopen and a snapshot round trip", async () => {
  await testPersistence();
});

// Windows keeps a handle on a WAL database for a moment after it is closed;
// failing to tidy a temporary directory is not a test result.
after(() => {
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch {
    console.log(`(left ${directory} behind; the platform still had it open)`);
  }
});
