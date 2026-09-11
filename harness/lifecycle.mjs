/**
 * Timetable lifecycle harness.
 *
 * What this exercises is the part of Beta 1 that can lose a term's worth of
 * work if it is wrong: the v5 → v6 migration, and the four operations that
 * replace one whole timetable with another. Every one of those is a swap —
 * archive the old, activate the new — and the failure that matters is not "it
 * did the wrong thing" but "it did half of it".
 *
 * So the assertions are mostly about what is *still there*. A v5 database is
 * built column by column, as the shipped v1–v5 migrations really left it, and
 * then opened by the real `openTemeloDatabase`; the real `createTimetable`,
 * `archiveActiveTimetable`, `restoreArchivedTimetable` and friends run against
 * it, every lifecycle action is followed by a cold reopen, and one whole suite
 * does nothing but inject a statement failure mid-swap and check that the
 * timetable the user started with is exactly what they still have.
 *
 * Run it with `node harness/run.mjs`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { weekdayOfIsoDate } from "@/domain/calendar";
import { addDaysIso } from "@/domain/date";
import { createId } from "@/domain/id";
import { applyClassEditScope, createPendingClassEdit } from "@/domain/classEdit";
import { resolveOccurrences } from "@/domain/occurrence";
import { occursOn, seriesRangeMovedTo, OPEN_ENDED_DATE } from "@/domain/recurrence";
import { generateTimeSlots } from "@/domain/time";
import { planReminders } from "@/domain/reminderSchedule";
import { openTemeloDatabase } from "@/storage/database";
import { LATEST_SCHEMA_VERSION, readSchemaVersion } from "@/storage/migrations";
import { parseTimetableSnapshot } from "@/storage/snapshot";
import {
  archiveActiveTimetable,
  countArchivedTimetables,
  createTimetable,
  deleteAllTimetableData,
  deleteArchivedTimetable,
  listArchivedTimetables,
  normalizeTimetableName,
  renameArchivedTimetable,
  restoreArchivedTimetable,
} from "@/storage/timetableLifecycle";
import { loadTimetable, saveTimetable } from "@/storage/timetableRepository";
import { check, equal, section } from "./report.mjs";
import { useDatabaseFile } from "./sqlite-stub.mjs";

const directory = mkdtempSync(join(tmpdir(), "temelo-lifecycle-"));
let databaseIndex = 0;

function nextPath() {
  return join(directory, `temelo-${databaseIndex++}.db`);
}

async function open(path) {
  useDatabaseFile(path);
  return openTemeloDatabase();
}

/** A cold launch: the same file, a new connection, read back from scratch. */
async function reopen(path) {
  const { db } = await open(path);
  return { db, state: await loadTimetable(db) };
}

const NOW = "2026-09-11T09:00:00.000Z";

/* ------------------------------------------------------ a v5 database, built */

/**
 * A database exactly as v1–v5 left it, with a real user's timetable in it.
 *
 * Written with raw SQL against the v1–v5 column set rather than through the
 * repository, because the repository is the *new* one: it knows about
 * `active_timetable` and about open-ended end dates, and using it here would
 * be testing the migration against data only the post-migration code could
 * have produced. This is what a Samsung that has been running the shipped
 * build for a term actually contains.
 *
 * The fixture is chosen so that every clause of migration v6 has something to
 * be wrong about:
 *
 *  - a weekly class running to the term's estimated end, which must be opened;
 *  - a biweekly class on the *odd* half of the fortnight, whose parity must
 *    survive — anchored a week after the term start, so a re-anchor would be
 *    visible as a week's shift;
 *  - a one-off, which must stay finite;
 *  - the earlier half of a split series, ending mid-term, which must keep its
 *    real end date or the occurrences the user deliberately changed come back;
 *  - a modified exception and a cancelled one;
 *  - a course colour and a per-occurrence colour override;
 *  - a per-class reminder and a per-occurrence reminder override.
 */
const TERM = { id: "term-1", name: "Autumn 2026", start: "2026-09-07", end: "2026-12-18" };

const V5 = {
  slots: [
    { id: "slot-1", position: 1, start: "08:00", end: "08:45" },
    { id: "slot-2", position: 2, start: "08:55", end: "09:40" },
    { id: "slot-3", position: 3, start: "09:50", end: "10:35" },
    { id: "slot-4", position: 4, start: "10:45", end: "11:30" },
    { id: "slot-5", position: 5, start: "11:40", end: "12:25" },
    { id: "slot-6", position: 6, start: "12:35", end: "13:20" },
  ],
  courses: [
    { id: "course-maths", name: "Mathematics", room: "101", colour: "blue" },
    { id: "course-history", name: "History", room: "204", colour: "amber" },
    { id: "course-trip", name: "Museum trip", room: "", colour: "teal" },
    { id: "course-physics", name: "Physics", room: "Lab A", colour: "magenta" },
  ],
  placements: [
    // Weekly, to the end of term: v6 must open this one.
    {
      id: "p-maths",
      courseId: "course-maths",
      weekday: "monday",
      slot: "slot-3",
      span: 1,
      recurrence: "weekly",
      startsOn: TERM.start,
      endsOn: TERM.end,
      reminder: 30,
    },
    // Every two weeks, on the half of the fortnight one week after the term
    // start. Parity must be identical after the migration.
    {
      id: "p-history",
      courseId: "course-history",
      weekday: "tuesday",
      slot: "slot-2",
      span: 2,
      recurrence: "biweekly",
      startsOn: "2026-09-15",
      endsOn: TERM.end,
      reminder: 60,
    },
    // A single lesson. Must stay a single lesson.
    {
      id: "p-trip",
      courseId: "course-trip",
      weekday: "friday",
      slot: "slot-5",
      span: 1,
      recurrence: "once",
      startsOn: "2026-10-16",
      endsOn: "2026-10-16",
      reminder: null,
    },
    // The earlier half of a split series: ends mid-term, on purpose.
    {
      id: "p-physics-old",
      courseId: "course-physics",
      weekday: "thursday",
      slot: "slot-1",
      span: 1,
      recurrence: "weekly",
      startsOn: TERM.start,
      endsOn: "2026-10-21",
      reminder: 15,
    },
  ],
  exceptions: [
    {
      id: "x-maths-moved",
      placementId: "p-maths",
      originalDate: "2026-09-21",
      effectiveDate: "2026-09-22",
      state: "modified",
      slot: "slot-4",
      span: null,
      name: "Mathematics (test)",
      colour: "red",
      reminder: "10",
    },
    {
      id: "x-history-cancelled",
      placementId: "p-history",
      originalDate: "2026-10-13",
      effectiveDate: "2026-10-13",
      state: "cancelled",
      slot: null,
      span: null,
      name: null,
      colour: null,
      reminder: null,
    },
  ],
};

/**
 * The v1–v5 schema, created and filled directly.
 *
 * `user_version` is set to 5 at the end, which is the whole point: the next
 * `openTemeloDatabase` runs v6 and only v6, exactly as an upgrading device
 * does.
 */
async function buildV5Database() {
  const path = nextPath();
  useDatabaseFile(path);
  // Bypasses `openTemeloDatabase` deliberately — this has to be a v5
  // database, and that function would migrate it before we could look.
  const { openDatabaseAsync } = await import("./sqlite-stub.mjs");
  const db = await openDatabaseAsync();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);

    CREATE TABLE settings (
      id                              TEXT PRIMARY KEY NOT NULL CHECK (id = 'app'),
      weekend_mode                    TEXT NOT NULL,
      grid_orientation                TEXT NOT NULL,
      academic_day_start              TEXT NOT NULL,
      default_lesson_duration_minutes INTEGER NOT NULL,
      default_break_duration_minutes  INTEGER NOT NULL,
      slot_count                      INTEGER NOT NULL,
      onboarding_completed            INTEGER NOT NULL,
      default_reminder_minutes        INTEGER,
      appearance_preference           TEXT,
      language_preference             TEXT
    );

    CREATE TABLE terms (
      id                 TEXT PRIMARY KEY NOT NULL,
      name               TEXT NOT NULL,
      start_date         TEXT NOT NULL,
      estimated_end_date TEXT NOT NULL
    );

    CREATE TABLE time_slots (
      id         TEXT PRIMARY KEY NOT NULL,
      position   INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time   TEXT NOT NULL
    );

    CREATE TABLE courses (
      id            TEXT PRIMARY KEY NOT NULL,
      name          TEXT NOT NULL,
      room          TEXT NOT NULL,
      teacher       TEXT NOT NULL,
      notes         TEXT NOT NULL,
      appearance_id TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      deleted_at    TEXT
    );

    CREATE TABLE placements (
      id              TEXT PRIMARY KEY NOT NULL,
      course_id       TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
      weekday         TEXT NOT NULL,
      time_slot_id    TEXT NOT NULL,
      slot_span       INTEGER NOT NULL,
      recurrence_type TEXT NOT NULL,
      starts_on       TEXT NOT NULL,
      ends_on         TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      deleted_at      TEXT,
      reminder_minutes INTEGER
    );

    CREATE TABLE occurrence_exceptions (
      id             TEXT PRIMARY KEY NOT NULL,
      placement_id   TEXT NOT NULL REFERENCES placements (id) ON DELETE CASCADE,
      original_date  TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      state          TEXT NOT NULL,
      time_slot_id   TEXT,
      slot_span      INTEGER,
      name           TEXT,
      room           TEXT,
      teacher        TEXT,
      notes          TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      deleted_at     TEXT,
      reminder_minutes TEXT,
      appearance_id  TEXT
    );

    CREATE TABLE reminder_deliveries (
      reminder_key TEXT PRIMARY KEY NOT NULL,
      remind_at    INTEGER NOT NULL,
      start_at     INTEGER NOT NULL,
      state        TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE INDEX idx_placements_course ON placements (course_id);
    CREATE INDEX idx_exceptions_placement ON occurrence_exceptions (placement_id);
    CREATE UNIQUE INDEX idx_time_slots_position ON time_slots (position);
  `);

  const created = "2026-09-01T08:00:00.000Z";

  await db.runAsync(
    `INSERT INTO settings (
       id, weekend_mode, grid_orientation, academic_day_start,
       default_lesson_duration_minutes, default_break_duration_minutes,
       slot_count, onboarding_completed, default_reminder_minutes,
       appearance_preference, language_preference
     ) VALUES ('app', 'saturdaySunday', 'horizontal', '08:00', 45, 10, 6, 1, 45, 'dark', 'ru')`,
  );

  await db.runAsync(
    "INSERT INTO terms (id, name, start_date, estimated_end_date) VALUES (?, ?, ?, ?)",
    TERM.id,
    TERM.name,
    TERM.start,
    TERM.end,
  );

  for (const slot of V5.slots) {
    await db.runAsync(
      "INSERT INTO time_slots (id, position, start_time, end_time) VALUES (?, ?, ?, ?)",
      slot.id,
      slot.position,
      slot.start,
      slot.end,
    );
  }

  for (const course of V5.courses) {
    await db.runAsync(
      `INSERT INTO courses (id, name, room, teacher, notes, appearance_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, '', '', ?, ?, ?, NULL)`,
      course.id,
      course.name,
      course.room,
      course.colour,
      created,
      created,
    );
  }

  for (const placement of V5.placements) {
    await db.runAsync(
      `INSERT INTO placements (
         id, course_id, weekday, time_slot_id, slot_span, recurrence_type,
         starts_on, ends_on, created_at, updated_at, deleted_at, reminder_minutes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      placement.id,
      placement.courseId,
      placement.weekday,
      placement.slot,
      placement.span,
      placement.recurrence,
      placement.startsOn,
      placement.endsOn,
      created,
      created,
      placement.reminder,
    );
  }

  for (const exception of V5.exceptions) {
    await db.runAsync(
      `INSERT INTO occurrence_exceptions (
         id, placement_id, original_date, effective_date, state, time_slot_id,
         slot_span, name, room, teacher, notes, created_at, updated_at,
         deleted_at, reminder_minutes, appearance_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?)`,
      exception.id,
      exception.placementId,
      exception.originalDate,
      exception.effectiveDate,
      exception.state,
      exception.slot,
      exception.span,
      exception.name,
      created,
      created,
      exception.reminder,
      exception.colour,
    );
  }

  await db.execAsync("PRAGMA user_version = 5");
  db.closeSync();
  return path;
}

/* ------------------------------------------------------------------ helpers */

function placementById(state, id) {
  return state.placements.find((placement) => placement.id === id);
}

/** Every date a series meets on inside a window — how parity is compared. */
function meetingDates(placement, from, until) {
  const dates = [];
  for (let date = from; date <= until; date = addDaysIso(date, 1)) {
    if (occursOn(placement, date)) dates.push(date);
  }
  return dates;
}

/**
 * The whole timetable as a comparable value, with only the fields a user would
 * notice. Used to assert that an archive-and-restore round trip changed
 * nothing — `updatedAt` and the timetable's own name are excluded because the
 * lifecycle legitimately touches both.
 */
function fingerprint(state) {
  return JSON.stringify({
    settings: {
      weekendMode: state.settings.weekendMode,
      academicDayStart: state.settings.academicDayStart,
      defaultLessonDurationMinutes: state.settings.defaultLessonDurationMinutes,
      defaultBreakDurationMinutes: state.settings.defaultBreakDurationMinutes,
      slotCount: state.settings.slotCount,
    },
    timetableId: state.timetable?.id ?? null,
    anchorDate: state.timetable?.anchorDate ?? null,
    timeSlots: [...state.timeSlots]
      .sort((a, b) => a.position - b.position)
      .map((slot) => [slot.id, slot.position, slot.startTime, slot.endTime]),
    courses: [...state.courses]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((course) => [course.id, course.name, course.room, course.teacher, course.notes, course.appearanceId, course.deletedAt]),
    placements: [...state.placements]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => [p.id, p.courseId, p.weekday, p.timeSlotId, p.slotSpan, p.recurrenceType, p.startsOn, p.endsOn, p.reminderMinutes, p.deletedAt]),
    exceptions: [...state.exceptions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((x) => [x.id, x.placementId, x.originalDate, x.effectiveDate, x.state, x.timeSlotId, x.slotSpan, x.name, x.room, x.teacher, x.notes, x.appearanceId, x.reminderMinutes, x.deletedAt]),
  });
}

/** A timetable the creation flow would produce, as its inputs. */
function newTimetableInput(name, overrides = {}) {
  const settings = {
    weekendMode: "none",
    academicDayStart: "09:00",
    defaultLessonDurationMinutes: 50,
    defaultBreakDurationMinutes: 10,
    slotCount: 5,
    ...overrides,
  };
  const slots = generateTimeSlots({
    dayStart: settings.academicDayStart,
    lessonDurationMinutes: settings.defaultLessonDurationMinutes,
    breakDurationMinutes: settings.defaultBreakDurationMinutes,
    slotCount: settings.slotCount,
  });
  if (!slots.ok) throw new Error("fixture academic day does not generate");
  return {
    name,
    settings,
    timeSlots: slots.slots.map((slot) => ({
      id: createId(),
      position: slot.position,
      startTime: slot.startTime,
      endTime: slot.endTime,
    })),
    anchorDate: "2027-01-04",
    now: NOW,
  };
}

/** Adds one class to whatever is active, through the ordinary save path. */
async function addClass(db, state, { name, weekday, slotIndex, recurrence = "weekly", startsOn }) {
  const courseId = createId();
  const next = {
    ...state,
    courses: [
      ...state.courses,
      {
        id: courseId,
        name,
        room: "",
        teacher: "",
        notes: "",
        appearanceId: "blue",
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    placements: [
      ...state.placements,
      {
        id: createId(),
        courseId,
        weekday,
        timeSlotId: state.timeSlots[slotIndex].id,
        slotSpan: 1,
        recurrenceType: recurrence,
        startsOn,
        endsOn: recurrence === "once" ? startsOn : OPEN_ENDED_DATE,
        reminderMinutes: 30,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
  };
  await saveTimetable(db, next, state);
  return next;
}

/* --------------------------------------------------------------- A: v5 → v6 */

async function testMigration() {
  section("A. v5 -> v6: an existing device's timetable survives");

  const path = await buildV5Database();
  const { db, schemaVersion } = await open(path);

  equal("the database migrated to the latest version", schemaVersion, LATEST_SCHEMA_VERSION);
  equal("...which is 6", LATEST_SCHEMA_VERSION, 6);

  const state = await loadTimetable(db);
  check("the timetable loads", state !== null, "loadTimetable returned null");

  // The term became the active timetable.
  equal("the term's name became the timetable's name", state.timetable?.name, TERM.name);
  equal("the timetable kept the term's id", state.timetable?.id, TERM.id);
  equal("the term start became the internal anchor", state.timetable?.anchorDate, TERM.start);

  // Academic day.
  equal("every period survived", state.timeSlots.length, V5.slots.length);
  equal("settings.slotCount still agrees", state.settings.slotCount, V5.slots.length);
  equal("the day still starts at 08:00", state.timeSlots[0].startTime, "08:00");
  equal("the last period still ends at 13:20", state.timeSlots[state.timeSlots.length - 1].endTime, "13:20");
  equal("the academic-day start setting survived", state.settings.academicDayStart, "08:00");
  equal("lesson duration survived", state.settings.defaultLessonDurationMinutes, 45);
  equal("break duration survived", state.settings.defaultBreakDurationMinutes, 10);

  // Preferences that are the user's, not the timetable's.
  equal("days shown survived", state.settings.weekendMode, "saturdaySunday");
  equal("layout survived", state.settings.gridOrientation, "horizontal");
  equal("appearance survived", state.settings.appearancePreference, "dark");
  equal("language survived", state.settings.languagePreference, "ru");
  equal("the default reminder survived", state.settings.defaultReminderMinutes, 45);
  check("the app still counts as set up", state.settings.onboardingCompleted, "onboardingCompleted was cleared");

  // Classes.
  equal("every class survived", state.placements.length, V5.placements.length);
  equal("every course survived", state.courses.length, V5.courses.length);

  const maths = placementById(state, "p-maths");
  equal("the weekly class kept its weekday", maths.weekday, "monday");
  equal("...its period", maths.timeSlotId, "slot-3");
  equal("...its recurrence", maths.recurrenceType, "weekly");
  equal("...its start", maths.startsOn, TERM.start);
  equal("...and its end date was opened", maths.endsOn, OPEN_ENDED_DATE);
  equal("...its reminder", maths.reminderMinutes, 30);
  check(
    "the weekly class still meets long past the old term end",
    occursOn(maths, "2028-03-06") && weekdayOfIsoDate("2028-03-06") === "monday",
    "it stopped",
  );

  const history = placementById(state, "p-history");
  equal("the biweekly class kept its anchor", history.startsOn, "2026-09-15");
  equal("...its span", history.slotSpan, 2);
  equal("...its reminder", history.reminderMinutes, 60);
  equal("...and its end date was opened", history.endsOn, OPEN_ENDED_DATE);

  /*
   * Parity, stated as the dates it actually meets on.
   *
   * The v5 record met on 15 and 29 September, 13 and 27 October and so on —
   * the odd half of the fortnight counted from the term start. Anything that
   * re-anchored the series would put it on the even half, which is exactly the
   * "an existing class silently switched alternating weeks" failure.
   */
  const parityDates = meetingDates(history, "2026-09-08", "2026-11-10");
  equal(
    "the biweekly class meets on exactly the weeks it always did",
    parityDates.join(","),
    "2026-09-15,2026-09-29,2026-10-13,2026-10-27,2026-11-10",
  );
  /*
   * And the same parity three years out.
   *
   * The two dates are derived from the anchor rather than written down: a
   * hardcoded "and it meets on this Tuesday in 2029" is a statement about
   * leap years as much as about parity, and getting it wrong fails the test
   * for a reason that has nothing to do with the code under test.
   */
  const onParity = addDaysIso(history.startsOn, 14 * 78);
  check(
    "...and keeps that parity three years out",
    occursOn(history, onParity),
    `expected it to meet on ${onParity}`,
  );
  check(
    "...and still skips the week in between",
    !occursOn(history, addDaysIso(onParity, 7)),
    `it also met on ${addDaysIso(onParity, 7)}`,
  );

  const trip = placementById(state, "p-trip");
  equal("the one-off is still a one-off", trip.recurrenceType, "once");
  equal("...on its own single day", trip.endsOn, "2026-10-16");
  equal(
    "...and meets exactly once",
    meetingDates(trip, "2026-09-01", "2027-09-01").join(","),
    "2026-10-16",
  );

  const split = placementById(state, "p-physics-old");
  equal("a split series' earlier half kept its real end date", split.endsOn, "2026-10-21");
  check("...so it does not resume", !occursOn(split, "2026-11-05"), "it came back");

  // Exceptions, colours, reminder overrides.
  equal("every exception survived", state.exceptions.length, V5.exceptions.length);
  const moved = state.exceptions.find((x) => x.id === "x-maths-moved");
  equal("a moved occurrence kept its original date", moved.originalDate, "2026-09-21");
  equal("...and where it moved to", moved.effectiveDate, "2026-09-22");
  equal("...its period override", moved.timeSlotId, "slot-4");
  equal("...its name override", moved.name, "Mathematics (test)");
  equal("...its colour override", moved.appearanceId, "red");
  equal("...its reminder override", moved.reminderMinutes, 10);
  const cancelled = state.exceptions.find((x) => x.id === "x-history-cancelled");
  equal("a cancelled occurrence is still cancelled", cancelled.state, "cancelled");

  equal("course colours survived", placementColour(state, "p-maths"), "blue");
  equal("...all of them", placementColour(state, "p-history"), "amber");

  // The new tables exist and are empty: nothing has been archived yet.
  equal("nothing is archived", await countArchivedTimetables(db), 0);

  // And the legacy table is deliberately still there, untouched.
  const terms = await db.getAllAsync("SELECT * FROM terms");
  equal("the legacy terms row was not deleted", terms.length, 1);
  equal("...and not rewritten", terms[0].estimated_end_date, TERM.end);

  db.closeSync();

  // L: the same answers after a cold reopen.
  const relaunched = await reopen(path);
  equal("after a cold reopen the timetable is still there", relaunched.state.timetable?.name, TERM.name);
  equal("...with every class", relaunched.state.placements.length, V5.placements.length);
  equal(
    "...and the weekly class is still open-ended",
    placementById(relaunched.state, "p-maths").endsOn,
    OPEN_ENDED_DATE,
  );
  relaunched.db.closeSync();

  // Migrating twice must be a no-op, which is what a second launch is.
  const again = await open(path);
  equal("a second launch runs no migration", again.schemaVersion, LATEST_SCHEMA_VERSION);
  equal("...and creates no second active timetable", (await again.db.getAllAsync("SELECT * FROM active_timetable")).length, 1);
  again.db.closeSync();

  return path;
}

function placementColour(state, placementId) {
  const placement = placementById(state, placementId);
  return state.courses.find((course) => course.id === placement.courseId)?.appearanceId;
}

/* ------------------------------- B: the first timetable on a fresh install */

async function testCreateFirst() {
  section("B. Creating the first timetable on a fresh install");

  const path = nextPath();
  const { db } = await open(path);

  equal("a fresh database has nothing stored", await loadTimetable(db), null);

  const empty = {
    settings: {
      weekendMode: "saturdaySunday",
      gridOrientation: "vertical",
      academicDayStart: "07:30",
      defaultLessonDurationMinutes: 90,
      defaultBreakDurationMinutes: 20,
      slotCount: 8,
      defaultReminderMinutes: 30,
      appearancePreference: "system",
      languagePreference: "system",
      onboardingCompleted: false,
    },
    timetable: null,
    timeSlots: [],
    courses: [],
    placements: [],
    exceptions: [],
  };

  const input = newTimetableInput("My timetable");
  const result = await createTimetable(db, empty, input);
  check("creating it succeeded", result.ok, JSON.stringify(result.reason ?? null));

  const state = result.state;
  equal("it is the active timetable", state.timetable?.name, "My timetable");
  equal("its anchor is the week it was made in", state.timetable?.anchorDate, "2027-01-04");
  check("the app now counts as set up", state.settings.onboardingCompleted, "onboardingCompleted is false");
  equal("its periods were generated", state.timeSlots.length, 5);
  equal("the first starts at 09:00", state.timeSlots[0].startTime, "09:00");
  equal("...and the fifth ends at 13:50", state.timeSlots[4].endTime, "13:50");
  equal("settings.slotCount agrees with them", state.settings.slotCount, 5);
  equal("its days shown came from the flow", state.settings.weekendMode, "none");
  equal("it starts with no classes", state.placements.length, 0);
  equal("nothing was archived", await countArchivedTimetables(db), 0);

  /*
   * The point of the whole release, asserted directly: there is no start date
   * and no end date anywhere in what creating a timetable produced.
   */
  check(
    "nothing in the created timetable carries a term date",
    !("startDate" in state.timetable) && !("estimatedEndDate" in state.timetable),
    "a date field survived on the timetable record",
  );

  db.closeSync();
  const relaunched = await reopen(path);
  equal("it survives a cold reopen", relaunched.state.timetable?.name, "My timetable");
  equal("...with its periods", relaunched.state.timeSlots.length, 5);
  relaunched.db.closeSync();

  return path;
}

/* ------------------------- C & D: creating another, and abandoning the flow */

async function testCreateWhileActive() {
  section("C. Creating a new timetable while one is active");

  const path = await buildV5Database();
  let { db } = await open(path);
  const before = await loadTimetable(db);
  const beforePrint = fingerprint(before);

  const result = await createTimetable(db, before, newTimetableInput("Spring 2027"));
  check("creating it succeeded", result.ok, JSON.stringify(result.reason ?? null));

  const state = result.state;
  equal("the new timetable is active", state.timetable?.name, "Spring 2027");
  check("it has a new identity", state.timetable?.id !== before.timetable.id, "the id was reused");
  equal("the working tables hold only its periods", state.timeSlots.length, 5);
  equal("...and none of the old classes", state.placements.length, 0);
  equal("...and none of the old courses", state.courses.length, 0);
  equal("...and none of the old exceptions", state.exceptions.length, 0);

  const archives = await listArchivedTimetables(db);
  equal("the old timetable is archived", archives.length, 1);
  equal("...under its own name", archives[0].name, TERM.name);
  equal("...with its own id", archives[0].id, before.timetable.id);
  equal("...and a readable snapshot", archives[0].contents === null, false);
  equal("...whose days shown are its own", archives[0].contents.weekendMode, "saturdaySunday");
  equal("...and whose day still runs 08:00-13:20", `${archives[0].contents.dayStart}-${archives[0].contents.dayEnd}`, "08:00-13:20");

  // The archive is exact, not approximately right.
  const row = await db.getFirstAsync("SELECT snapshot FROM archived_timetables WHERE id = ?", before.timetable.id);
  const parsed = parseTimetableSnapshot(row.snapshot);
  check("the snapshot parses", parsed.ok, parsed.reason);
  equal("it holds every class", parsed.snapshot.placements.length, V5.placements.length);
  equal("...every course", parsed.snapshot.courses.length, V5.courses.length);
  equal("...every exception", parsed.snapshot.exceptions.length, V5.exceptions.length);
  equal("...every period", parsed.snapshot.timeSlots.length, V5.slots.length);
  equal(
    "...the biweekly class's parity anchor",
    parsed.snapshot.placements.find((p) => p.id === "p-history").startsOn,
    "2026-09-15",
  );
  equal(
    "...the split series' real end date",
    parsed.snapshot.placements.find((p) => p.id === "p-physics-old").endsOn,
    "2026-10-21",
  );
  equal(
    "...and the per-occurrence colour override",
    parsed.snapshot.exceptions.find((x) => x.id === "x-maths-moved").appearanceId,
    "red",
  );
  check(
    "the snapshot does not carry app-global preferences",
    !("appearancePreference" in parsed.snapshot.settings) &&
      !("languagePreference" in parsed.snapshot.settings) &&
      !("defaultReminderMinutes" in parsed.snapshot.settings) &&
      !("gridOrientation" in parsed.snapshot.settings),
    "an app-level preference was archived with the timetable",
  );

  // App-global preferences were not disturbed by the swap.
  equal("appearance is still the user's", state.settings.appearancePreference, "dark");
  equal("language is still the user's", state.settings.languagePreference, "ru");
  equal("layout is still the user's", state.settings.gridOrientation, "horizontal");
  equal("the default reminder is still the user's", state.settings.defaultReminderMinutes, 45);

  db.closeSync();
  const relaunched = await reopen(path);
  equal("the swap survives a cold reopen", relaunched.state.timetable?.name, "Spring 2027");
  equal("...and so does the archive", (await listArchivedTimetables(relaunched.db)).length, 1);
  db = relaunched.db;

  section("D. Abandoning the setup flow changes nothing");

  /*
   * Abandoning the flow is, precisely, *not* calling `createTimetable` — so
   * what has to be proved is that everything the flow does before that final
   * press is incapable of writing.
   *
   * It is proved by doing all of it. `newTimetableInput` is exactly what the
   * two setup screens produce between them: the name normalised, the days
   * chosen, the academic day generated into real periods with real ids. Then
   * the whole database is compared against the copy taken before — every row
   * of every table, not just the timetable — and the flow is walked a second
   * time for good measure.
   */
  const wholeDatabase = async () =>
    JSON.stringify({
      settings: await db.getAllAsync("SELECT * FROM settings"),
      active: await db.getAllAsync("SELECT * FROM active_timetable"),
      archived: await db.getAllAsync("SELECT * FROM archived_timetables"),
      slots: await db.getAllAsync("SELECT * FROM time_slots ORDER BY position"),
      courses: await db.getAllAsync("SELECT * FROM courses ORDER BY id"),
      placements: await db.getAllAsync("SELECT * FROM placements ORDER BY id"),
      exceptions: await db.getAllAsync("SELECT * FROM occurrence_exceptions ORDER BY id"),
    });

  const databaseBefore = await wholeDatabase();
  const abandonedOnce = newTimetableInput("Never created");
  const abandonedTwice = newTimetableInput("Never created either", { slotCount: 3, weekendMode: "sundayOnly" });
  check(
    "the setup steps really did produce a complete timetable to create",
    abandonedOnce.timeSlots.length === 5 && abandonedTwice.timeSlots.length === 3,
    "the fixture did not build what the flow builds",
  );

  equal("...and yet not one row of the database changed", await wholeDatabase(), databaseBefore);
  equal("the current timetable is still the one that was active", (await loadTimetable(db)).timetable.name, "Spring 2027");
  const stillArchived = await listArchivedTimetables(db);
  equal("no second archive appeared", stillArchived.length, 1);
  equal("...and it is still the timetable the flow would have replaced", stillArchived[0].id, before.timetable.id);

  // The abandoned flow also has to leave the *archive* alone — restoring it
  // must still give back the timetable that was captured at the very top.
  const backAgain = await restoreArchivedTimetable(db, await loadTimetable(db), before.timetable.id, NOW);
  check("the untouched archive still restores", backAgain.ok, JSON.stringify(backAgain.reason ?? null));
  equal("...to exactly the timetable it started as", fingerprint(backAgain.state), beforePrint);

  db.closeSync();
  return path;
}

/* ------------------------------------- E & F: archive, then restore into none */

async function testArchiveAndRestore() {
  section("E. Archiving the active timetable");

  const path = await buildV5Database();
  let { db } = await open(path);
  const before = await loadTimetable(db);
  const beforePrint = fingerprint(before);

  const archived = await archiveActiveTimetable(db, before, NOW);
  check("archiving succeeded", archived.ok, JSON.stringify(archived.reason ?? null));

  const empty = archived.state;
  equal("there is no active timetable", empty.timetable, null);
  equal("the working tables have no periods", empty.timeSlots.length, 0);
  equal("...no courses", empty.courses.length, 0);
  equal("...no classes", empty.placements.length, 0);
  equal("...and no exceptions", empty.exceptions.length, 0);
  equal("appearance was left alone", empty.settings.appearancePreference, "dark");
  check("the app still counts as set up", empty.settings.onboardingCompleted, "onboardingCompleted was cleared");
  equal("exactly one timetable is archived", await countArchivedTimetables(db), 1);

  db.closeSync();
  let relaunched = await reopen(path);
  equal("after a cold reopen there is still no active timetable", relaunched.state.timetable, null);
  equal("...and the archive is still there", await countArchivedTimetables(relaunched.db), 1);
  db = relaunched.db;

  section("F. Restoring when there is no current timetable");

  const list = await listArchivedTimetables(db);
  const restored = await restoreArchivedTimetable(db, relaunched.state, list[0].id, NOW);
  check("restoring succeeded", restored.ok, JSON.stringify(restored.reason ?? null));

  const state = restored.state;
  equal("it is active again", state.timetable?.name, TERM.name);
  equal("...with the same id it had", state.timetable?.id, TERM.id);
  equal("it is no longer in the archived list", await countArchivedTimetables(db), 0);

  /*
   * The assertion this whole suite exists for: a round trip through the
   * archive changed nothing a user would notice.
   */
  equal("the timetable came back byte-for-byte", fingerprint(state), beforePrint);

  // And the recurrence still behaves, which the fingerprint alone would not
  // prove — it compares stored fields, not what they resolve to.
  const history = placementById(state, "p-history");
  equal(
    "the biweekly class still meets on its own weeks",
    meetingDates(history, "2026-09-08", "2026-11-10").join(","),
    "2026-09-15,2026-09-29,2026-10-13,2026-10-27,2026-11-10",
  );

  db.closeSync();
  relaunched = await reopen(path);
  equal("the restore survives a cold reopen", fingerprint(relaunched.state), beforePrint);
  relaunched.db.closeSync();

  return path;
}

/* ---------------------------- G: restoring while another timetable is current */

async function testRestoreOverCurrent() {
  section("G. Restoring while another timetable is current");

  const path = await buildV5Database();
  const { db } = await open(path);
  const autumn = await loadTimetable(db);
  const autumnPrint = fingerprint(autumn);
  const autumnId = autumn.timetable.id;

  // Autumn is archived by creating Spring; then Spring gets a class of its own
  // so that both datasets are distinguishable.
  const created = await createTimetable(db, autumn, newTimetableInput("Spring 2027"));
  check("the second timetable was created", created.ok, JSON.stringify(created.reason ?? null));
  const spring = await addClass(db, created.state, {
    name: "Statistics",
    weekday: "wednesday",
    slotIndex: 1,
    startsOn: "2027-01-06",
  });
  const springPrint = fingerprint(spring);
  const springId = spring.timetable.id;

  const restored = await restoreArchivedTimetable(db, spring, autumnId, NOW);
  check("restoring Autumn succeeded", restored.ok, JSON.stringify(restored.reason ?? null));

  equal("Autumn is active", restored.state.timetable?.id, autumnId);
  equal("...and came back exactly", fingerprint(restored.state), autumnPrint);

  const archives = await listArchivedTimetables(db);
  equal("exactly one timetable is archived", archives.length, 1);
  equal("...and it is Spring", archives[0].id, springId);

  // Spring's own data is intact in the archive, including the class added to it.
  const springRow = await db.getFirstAsync("SELECT snapshot FROM archived_timetables WHERE id = ?", springId);
  const springParsed = parseTimetableSnapshot(springRow.snapshot);
  check("Spring's snapshot parses", springParsed.ok, springParsed.reason);
  equal("it holds the class that was added to it", springParsed.snapshot.placements.length, 1);
  equal("...by name", springParsed.snapshot.courses[0].name, "Statistics");

  // And restoring back gives Spring exactly as it was.
  const back = await restoreArchivedTimetable(db, restored.state, springId, NOW);
  check("restoring Spring back succeeded", back.ok, JSON.stringify(back.reason ?? null));
  equal("Spring came back exactly", fingerprint(back.state), springPrint);
  equal("and Autumn is archived again", (await listArchivedTimetables(db))[0].id, autumnId);

  db.closeSync();
  const relaunched = await reopen(path);
  equal("the whole round trip survives a cold reopen", fingerprint(relaunched.state), springPrint);
  relaunched.db.closeSync();
}

/* ------------------------------------------ H, I, J: rename, rename, delete */

async function testRenameAndDelete() {
  section("H, I, J. Renaming and deleting");

  const path = await buildV5Database();
  const { db } = await open(path);
  const autumn = await loadTimetable(db);
  const autumnPrint = fingerprint(autumn);

  // H: renaming the active timetable is an ordinary state change, so it goes
  // through the ordinary save path — which is exactly the point of the
  // assertion: nothing but the name may move.
  const renamed = { ...autumn, timetable: { ...autumn.timetable, name: "Autumn term", updatedAt: NOW } };
  await saveTimetable(db, renamed, autumn);
  const afterRename = await loadTimetable(db);
  equal("the active timetable's name changed", afterRename.timetable.name, "Autumn term");
  equal("and nothing else did", fingerprint(afterRename), autumnPrint);
  equal("...its id least of all", afterRename.timetable.id, autumn.timetable.id);

  // Two archives, so "only the selected one" means something.
  const spring = await createTimetable(db, afterRename, newTimetableInput("Spring 2027"));
  const summer = await createTimetable(db, spring.state, newTimetableInput("Summer 2027"));
  equal("two timetables are archived", await countArchivedTimetables(db), 2);

  // I: renaming an archived timetable.
  const archivesBefore = await listArchivedTimetables(db);
  const target = archivesBefore.find((entry) => entry.name === "Autumn term");
  const snapshotBefore = (
    await db.getFirstAsync("SELECT snapshot FROM archived_timetables WHERE id = ?", target.id)
  ).snapshot;

  const renameResult = await renameArchivedTimetable(db, target.id, "  Autumn 2026/27  ");
  check("renaming the archive succeeded", renameResult.ok, JSON.stringify(renameResult.reason ?? null));

  const archivesAfter = await listArchivedTimetables(db);
  const renamedArchive = archivesAfter.find((entry) => entry.id === target.id);
  equal("the new name is trimmed", renamedArchive.name, "Autumn 2026/27");
  const snapshotAfter = (
    await db.getFirstAsync("SELECT snapshot FROM archived_timetables WHERE id = ?", target.id)
  ).snapshot;
  equal("the archived timetable's data was not rewritten", snapshotAfter, snapshotBefore);
  equal("the other archive was untouched", archivesAfter.find((e) => e.name === "Spring 2027") !== undefined, true);

  // ...and the rename is what comes back on a restore, not the snapshot's name.
  const current = await loadTimetable(db);
  const restored = await restoreArchivedTimetable(db, current, target.id, NOW);
  check("restoring the renamed archive succeeded", restored.ok, JSON.stringify(restored.reason ?? null));
  equal("the restored timetable carries the new name", restored.state.timetable.name, "Autumn 2026/27");
  equal("...and everything else is unchanged", fingerprint(restored.state), autumnPrint);

  // Put it back so there are two archives again, one of which we will delete.
  const reArchived = await archiveActiveTimetable(db, restored.state, NOW);
  check("archiving it again succeeded", reArchived.ok, JSON.stringify(reArchived.reason ?? null));
  equal("three timetables are archived", await countArchivedTimetables(db), 3);

  // J: deleting one archived timetable.
  const before = await listArchivedTimetables(db);
  const doomed = before.find((entry) => entry.name === "Spring 2027");
  const survivors = before.filter((entry) => entry.id !== doomed.id).map((entry) => entry.id).sort();

  const deleted = await deleteArchivedTimetable(db, doomed.id);
  check("deleting it succeeded", deleted.ok, JSON.stringify(deleted.reason ?? null));

  const after = await listArchivedTimetables(db);
  equal("one fewer archive", after.length, before.length - 1);
  equal(
    "exactly the unrelated archives survive",
    after.map((entry) => entry.id).sort().join(","),
    survivors.join(","),
  );
  equal("there is still no active timetable to have been harmed", (await loadTimetable(db)).timetable, null);

  // Deleting the same one twice is a clean failure, not a silent success.
  const again = await deleteArchivedTimetable(db, doomed.id);
  equal("deleting it again is refused", again.ok, false);
  equal("...with a reason the UI can use", again.reason.kind, "archiveNotFound");

  db.closeSync();
  const relaunched = await reopen(path);
  equal(
    "the deletion survives a cold reopen",
    (await listArchivedTimetables(relaunched.db)).length,
    after.length,
  );
  relaunched.db.closeSync();
}

/* ----------------------------- K: forced failure in the middle of every swap */

/**
 * The suite that matters most.
 *
 * Each case injects a statement failure at a different point inside a
 * lifecycle transaction and then asserts, against a freshly reopened database,
 * that the timetable the user started with is exactly what they still have —
 * no half-written archive, no emptied working tables, no active timetable
 * pointing at nothing.
 *
 * The failure is injected by pattern on the first matching statement, which is
 * how the existing storage harness does it; each pattern below is chosen to
 * land after the transaction has already applied something, because a failure
 * on the first statement would prove nothing about atomicity.
 */
async function testForcedFailures() {
  section("K. A forced failure part-way through a swap leaves everything as it was");

  const cases = [
    { what: "creating a new timetable", pattern: "INSERT INTO time_slots", run: (db, state) => createTimetable(db, state, newTimetableInput("Spring 2027")) },
    { what: "creating a new timetable (at the active row)", pattern: "INSERT INTO active_timetable", run: (db, state) => createTimetable(db, state, newTimetableInput("Spring 2027")) },
    { what: "archiving", pattern: "DELETE FROM occurrence_exceptions", run: (db, state) => archiveActiveTimetable(db, state, NOW) },
    { what: "archiving (at the archive row)", pattern: "INSERT INTO archived_timetables", run: (db, state) => archiveActiveTimetable(db, state, NOW) },
  ];

  for (const testCase of cases) {
    const path = await buildV5Database();
    const { db } = await open(path);
    const before = await loadTimetable(db);
    const beforePrint = fingerprint(before);

    db.failPattern = testCase.pattern;
    let threw = null;
    try {
      await testCase.run(db, before);
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error);
    }

    check(`${testCase.what}: the failure propagated`, threw !== null, "it reported success");
    check(
      `${testCase.what}: the error names the injected cause, not a rollback`,
      (threw ?? "").includes("injected failure") && !(threw ?? "").includes("cannot rollback"),
      threw,
    );
    check(
      `${testCase.what}: the connection is out of its transaction`,
      !db.isInTransactionSync(),
      "still in a transaction",
    );
    db.closeSync();

    const relaunched = await reopen(path);
    equal(`${testCase.what}: the old timetable is still active`, relaunched.state.timetable?.id, before.timetable.id);
    equal(`${testCase.what}: ...completely unchanged`, fingerprint(relaunched.state), beforePrint);
    equal(`${testCase.what}: no partial archive was left behind`, await countArchivedTimetables(relaunched.db), 0);
    relaunched.db.closeSync();
  }

  // The same for a restore, which has an archive to lose as well as an active
  // timetable.
  const path = await buildV5Database();
  const { db } = await open(path);
  const autumn = await loadTimetable(db);
  const created = await createTimetable(db, autumn, newTimetableInput("Spring 2027"));
  const springPrint = fingerprint(created.state);
  const archives = await listArchivedTimetables(db);
  const autumnSnapshot = (
    await db.getFirstAsync("SELECT snapshot FROM archived_timetables WHERE id = ?", archives[0].id)
  ).snapshot;

  db.failPattern = "INSERT INTO placements";
  let threw = null;
  try {
    await restoreArchivedTimetable(db, created.state, archives[0].id, NOW);
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check("restoring: the failure propagated", threw !== null, "it reported success");
  db.closeSync();

  const relaunched = await reopen(path);
  equal("restoring: the current timetable is untouched", fingerprint(relaunched.state), springPrint);
  equal("restoring: the archive is still there", await countArchivedTimetables(relaunched.db), 1);
  equal(
    "restoring: ...and its snapshot is unchanged",
    (
      await relaunched.db.getFirstAsync(
        "SELECT snapshot FROM archived_timetables WHERE id = ?",
        archives[0].id,
      )
    ).snapshot,
    autumnSnapshot,
  );
  relaunched.db.closeSync();

  // A damaged archive must be declined before anything is touched at all —
  // which is a different guarantee from "the transaction rolled back".
  const damagedPath = await buildV5Database();
  const damaged = await open(damagedPath);
  const state = await loadTimetable(damaged.db);
  const statePrint = fingerprint(state);
  await damaged.db.runAsync(
    `INSERT INTO archived_timetables (id, name, archived_at, created_at, format_version, snapshot)
     VALUES ('broken', 'Broken', ?, ?, 1, '{"formatVersion":1,"timetable":{}}')`,
    NOW,
    NOW,
  );

  const refused = await restoreArchivedTimetable(damaged.db, state, "broken", NOW);
  equal("a damaged archive is refused", refused.ok, false);
  equal("...with a reason", refused.reason.kind, "archiveUnreadable");
  equal("the active timetable was never touched", fingerprint(await loadTimetable(damaged.db)), statePrint);
  equal("and the damaged archive is still listed", await countArchivedTimetables(damaged.db), 1);
  const listed = await listArchivedTimetables(damaged.db);
  equal("...as a row with no readable contents", listed[0].contents, null);
  equal("...but still with its name, so it can be renamed or deleted", listed[0].name, "Broken");
  damaged.db.closeSync();
}

/* --------------------------------- M: recurrence with no global term dates */

async function testRecurrenceWithoutTermDates() {
  section("M. Recurrence with no global term dates");

  const path = await buildV5Database();
  const { db } = await open(path);
  const state = await loadTimetable(db);

  const maths = placementById(state, "p-maths");
  const history = placementById(state, "p-history");

  // A weekly class resolves through the grid's own resolver, far in the future.
  const farWeek = ["2030-03-04", "2030-03-05", "2030-03-06", "2030-03-07", "2030-03-08"];
  const far = resolveOccurrences(state, farWeek);
  check(
    "a weekly class still resolves four years out",
    far.some((occurrence) => occurrence.basePlacement.id === "p-maths"),
    "it stopped",
  );
  check(
    "a one-off does not",
    !far.some((occurrence) => occurrence.basePlacement.id === "p-trip"),
    "the one-off reappeared",
  );

  // Biweekly parity, sampled at a distance: the weeks it meets must alternate
  // strictly, and must agree with the parity it had in 2026.
  const distant = meetingDates(history, "2031-01-01", "2031-03-31");
  check("a biweekly class still meets in 2031", distant.length > 0, "it stopped");
  const gaps = new Set(distant.slice(1).map((date, index) => (Date.parse(date) - Date.parse(distant[index])) / 86400000));
  equal("...exactly every fourteen days", [...gaps].join(","), "14");
  check(
    "...on the same half of the fortnight it started on",
    distant.every((date) => (Date.parse(date) - Date.parse(history.startsOn)) / 86400000 % 14 === 0),
    "the parity drifted from the anchor",
  );

  // The split series still stops where the user split it, which is the other
  // half of "no hidden bound": a real end date is still a real end date.
  const split = placementById(state, "p-physics-old");
  equal("a split series still ends where it was split", split.endsOn, "2026-10-21");
  check("...and does not resolve past that", !occursOn(split, "2026-10-29"), "it came back");

  // A move must carry the open end rather than shifting it — the sentinel is
  // not a date, and shifting it by two days would turn "forever" into a real
  // day in the year 9999.
  const moved = seriesRangeMovedTo(maths, "2026-09-14", "2026-09-16");
  equal("moving an open-ended series shifts its anchor", moved.startsOn, addDaysIso(maths.startsOn, 2));
  equal("...and leaves its end open", moved.endsOn, OPEN_ENDED_DATE);
  const bounded = seriesRangeMovedTo(split, "2026-09-10", "2026-09-11");
  equal("a bounded series' end still moves with it", bounded.endsOn, "2026-10-22");

  /*
   * The three edit scopes, over an open-ended series.
   *
   * "This and future" is the one the open end actually changes: the split
   * works by giving the earlier half a real end date and starting a new series
   * at the edited occurrence, and the new half has to inherit the open end
   * rather than a date. If it inherited the sentinel *shifted*, or a term end
   * that no longer exists, the user's classes would stop.
   */
  const editable = {
    timeSlots: state.timeSlots,
    courses: state.courses,
    placements: state.placements,
    exceptions: state.exceptions,
  };

  const onlyThis = applyClassEditScope(
    editable,
    draftFor(state, "p-maths", "2026-10-05", { room: "Room 9" }),
    "onlyThis",
    NOW,
  );
  check("an 'only this occurrence' edit still applies", onlyThis.ok, JSON.stringify(onlyThis.error ?? null));
  equal("...as one new exception", onlyThis.next.exceptions.length, state.exceptions.length + 1);
  equal(
    "...leaving the series open-ended",
    onlyThis.next.placements.find((p) => p.id === "p-maths").endsOn,
    OPEN_ENDED_DATE,
  );

  const thisAndFuture = applyClassEditScope(
    editable,
    draftFor(state, "p-maths", "2026-10-05", { room: "Room 9" }),
    "thisAndFuture",
    NOW,
  );
  check("a 'this and future' edit still applies", thisAndFuture.ok, JSON.stringify(thisAndFuture.error ?? null));
  const truncated = thisAndFuture.next.placements.find((p) => p.id === "p-maths");
  const successor = thisAndFuture.next.placements.find(
    (p) => p.id !== "p-maths" && p.courseId !== undefined && !p.deletedAt && p.weekday === "monday" && p.startsOn === "2026-10-05",
  );
  equal("...the earlier half now ends the day before the split", truncated.endsOn, "2026-10-04");
  check("...a successor series was created", successor !== undefined, "no new series");
  equal("...starting at the edited occurrence", successor.startsOn, "2026-10-05");
  equal("...and it is open-ended, not bounded by anything", successor.endsOn, OPEN_ENDED_DATE);
  check(
    "...so the class continues indefinitely after the split",
    occursOn(successor, "2030-10-07"),
    "the successor stops",
  );

  const all = applyClassEditScope(
    editable,
    draftFor(state, "p-maths", "2026-10-05", { room: "Room 9" }),
    "all",
    NOW,
  );
  check("an 'all occurrences' edit still applies", all.ok, JSON.stringify(all.error ?? null));
  equal("...creating no new series", all.next.placements.length, state.placements.length);
  equal(
    "...and leaving the series open-ended",
    all.next.placements.find((p) => p.id === "p-maths").endsOn,
    OPEN_ENDED_DATE,
  );
  equal(
    "...with the edit on the course itself",
    all.next.courses.find((course) => course.id === "course-maths").room,
    "Room 9",
  );

  db.closeSync();
}

/**
 * A draft for one occurrence of a series, as the class editor would produce.
 *
 * Built through `createPendingClassEdit` rather than by hand, so what the
 * scope tests above exercise is the same draft shape the editor really sends —
 * including which fields it marks as touched, which is what decides whether an
 * edit reaches the series at all.
 */
function draftFor(state, placementId, occurrenceDate, changes) {
  const [occurrence] = resolveOccurrences(state, [occurrenceDate]).filter(
    (candidate) => candidate.basePlacement.id === placementId,
  );
  if (!occurrence) throw new Error(`no occurrence of ${placementId} on ${occurrenceDate}`);

  return createPendingClassEdit({
    occurrence,
    source: "editor",
    effectiveDate: occurrence.date,
    weekday: occurrence.weekday,
    timeSlotId: occurrence.placement.timeSlotId,
    slotSpan: occurrence.placement.slotSpan,
    name: occurrence.course.name,
    room: changes.room ?? occurrence.course.room,
    teacher: occurrence.course.teacher,
    notes: occurrence.course.notes,
    appearanceId: occurrence.course.appearanceId,
    recurrenceType: occurrence.basePlacement.recurrenceType,
    startsOn: occurrence.basePlacement.startsOn,
    endsOn: occurrence.basePlacement.endsOn,
    reminderMinutes: occurrence.placement.reminderMinutes,
  }).draft;
}

/* ------------------------------------------- N: reminders across a switch */

async function testReminderReconciliation() {
  section("N. Reminders follow the active timetable");

  const path = await buildV5Database();
  const { db } = await open(path);
  const autumn = await loadTimetable(db);

  const text = { startsIn: (lead) => `in ${lead}`, room: (room) => `Room ${room}` };
  // A Monday inside the fixture's own weeks, so the window contains real
  // occurrences of both recurring classes.
  const plan = (state, fromDate) =>
    planReminders({
      placements: state.placements,
      courses: state.courses,
      exceptions: state.exceptions,
      timeSlots: state.timeSlots,
      fromDate,
      now: Date.parse("2026-09-14T00:00:00"),
      text,
    });

  const active = plan(autumn, "2026-09-14");
  check("the active timetable produces reminders", active.length > 0, "none were planned");
  check(
    "...only for its own classes",
    active.every((reminder) => autumn.placements.some((p) => p.id === reminder.placementId)),
    "a reminder came from somewhere else",
  );

  const archived = await archiveActiveTimetable(db, autumn, NOW);
  check("archiving succeeded", archived.ok, JSON.stringify(archived.reason ?? null));

  /*
   * The reminder scheduler's input *is* the app state, so an archived
   * timetable's classes are not merely skipped — they are not there. That is
   * what makes an archived timetable's reminders stop without any code in the
   * scheduler knowing archiving exists; the plan comes back empty and its
   * reconciliation cancels everything the OS was holding.
   */
  equal("an archived timetable plans no reminders at all", plan(archived.state, "2026-09-14").length, 0);

  const list = await listArchivedTimetables(db);
  const restored = await restoreArchivedTimetable(db, archived.state, list[0].id, NOW);
  check("restoring succeeded", restored.ok, JSON.stringify(restored.reason ?? null));

  const again = plan(restored.state, "2026-09-14");
  equal("restoring plans the same reminders again", again.length, active.length);
  equal(
    "...for the same occurrences, at the same moments",
    again.map((r) => `${r.key}@${r.remindAt}`).sort().join("|"),
    active.map((r) => `${r.key}@${r.remindAt}`).sort().join("|"),
  );
  check(
    "...and the reminder keys are derived from the restored data, not remembered",
    again.every((reminder) => restored.state.placements.some((p) => p.id === reminder.placementId)),
    "a key survived that no restored class accounts for",
  );

  // Switching repeatedly must not accumulate anything.
  let current = restored.state;
  for (let round = 0; round < 3; round++) {
    const off = await archiveActiveTimetable(db, current, NOW);
    check(`round ${round + 1}: archived`, off.ok, JSON.stringify(off.reason ?? null));
    equal(`round ${round + 1}: no reminders while archived`, plan(off.state, "2026-09-14").length, 0);
    const entries = await listArchivedTimetables(db);
    equal(`round ${round + 1}: exactly one archive`, entries.length, 1);
    const on = await restoreArchivedTimetable(db, off.state, entries[0].id, NOW);
    check(`round ${round + 1}: restored`, on.ok, JSON.stringify(on.reason ?? null));
    equal(`round ${round + 1}: reminders are back`, plan(on.state, "2026-09-14").length, active.length);
    equal(`round ${round + 1}: nothing accumulated in the archive`, await countArchivedTimetables(db), 0);
    current = on.state;
  }

  equal("after three round trips the timetable is still intact", current.placements.length, V5.placements.length);
  db.closeSync();
}

/* ------------------- editing with no active timetable, and deleting the lot */

async function testNoActiveTimetable() {
  section("With no active timetable: preferences still save, and deleting all data");

  const path = await buildV5Database();
  const { db } = await open(path);
  const archived = await archiveActiveTimetable(db, await loadTimetable(db), NOW);
  check("archiving succeeded", archived.ok, JSON.stringify(archived.reason ?? null));

  /*
   * Settings are still reachable with no timetable — the user got here by
   * archiving, and appearance and language are theirs, not the timetable's. So
   * the ordinary save path has to accept a state with `timetable: null`, which
   * it used to have no case for at all.
   */
  const changed = {
    ...archived.state,
    settings: { ...archived.state.settings, appearancePreference: "light" },
  };
  let saved = true;
  try {
    await saveTimetable(db, changed, archived.state);
  } catch (error) {
    saved = error instanceof Error ? error.message : String(error);
  }
  equal("changing a preference with no active timetable saves", saved, true);
  const afterPreference = await loadTimetable(db);
  equal("...and lands", afterPreference.settings.appearancePreference, "light");
  equal("...without inventing an active timetable", afterPreference.timetable, null);
  equal("...and without disturbing the archive", await countArchivedTimetables(db), 1);

  /*
   * A state that claims no timetable but still carries its classes is a
   * programming error, and the repository has to say so rather than write a
   * database where classes belong to nothing.
   */
  const incoherent = { ...afterPreference, placements: [{ id: "orphan" }] };
  let refused = null;
  try {
    await saveTimetable(db, incoherent, afterPreference);
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  check("classes with no timetable to own them are refused", refused !== null, "it was accepted");
  check("...and the refusal says why", (refused ?? "").includes("no active timetable"), refused);

  // Delete all data: both tables, and the active row, not just the working
  // tables the ordinary diff can reach.
  const reset = await deleteAllTimetableData(db, {
    ...afterPreference.settings,
    appearancePreference: "system",
    languagePreference: "system",
    onboardingCompleted: false,
  });
  equal("deleting all data leaves no active timetable", reset.timetable, null);
  equal("...no periods", reset.timeSlots.length, 0);
  equal("...no classes", reset.placements.length, 0);
  equal("...no archived timetables", await countArchivedTimetables(db), 0);
  equal("...no stale active_timetable row", (await db.getAllAsync("SELECT * FROM active_timetable")).length, 0);
  check("...and the app is back to needing setup", !reset.settings.onboardingCompleted, "still marked as set up");

  db.closeSync();
  const relaunched = await reopen(path);
  equal("the reset survives a cold reopen", relaunched.state.timetable, null);
  equal("...with nothing left in the archive", await countArchivedTimetables(relaunched.db), 0);
  equal("...and no periods left behind", relaunched.state.timeSlots.length, 0);
  relaunched.db.closeSync();
}

/* -------------------------------------------------------------------- names */

function testNames() {
  section("Timetable names");

  equal("whitespace is trimmed", normalizeTimetableName("  Autumn  "), "Autumn");
  equal("a blank name is refused", normalizeTimetableName("   "), null);
  equal("an empty name is refused", normalizeTimetableName(""), null);
  equal("Cyrillic is a name", normalizeTimetableName("Осенний семестр"), "Осенний семестр");
  equal("so is German", normalizeTimetableName("Wintersemester"), "Wintersemester");
  equal(
    "an over-long name is capped, counted in code points",
    [...normalizeTimetableName("🎓".repeat(200))].length,
    60,
  );
  check("names need not be unique", normalizeTimetableName("Spring") === normalizeTimetableName("Spring"), "they differ");
}

/* -------------------------------------------------------------------- entry */

export async function runLifecycleHarness() {
  try {
    await testMigration();
    await testCreateFirst();
    await testCreateWhileActive();
    await testArchiveAndRestore();
    await testRestoreOverCurrent();
    await testRenameAndDelete();
    await testForcedFailures();
    await testRecurrenceWithoutTermDates();
    await testReminderReconciliation();
    await testNoActiveTimetable();
    testNames();
  } finally {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      console.log(`\n(left ${directory} behind; the platform still had it open)`);
    }
  }
}
