/**
 * Custom visible weekdays.
 *
 * Beta 2 lets a timetable show any non-empty set of the seven days, instead of
 * one of three weekend presets. What has to hold:
 *
 *  - an upgrading device opens to exactly the days its preset showed (v8);
 *  - hiding a day is presentation only — the classes on it, their reminders
 *    and their exported events are all still there, and showing the day again
 *    brings the classes straight back;
 *  - the set survives a relaunch, an archive and a restore, and a `.temelo`
 *    round trip; a Beta 1 file or archive, which only knows the preset, still
 *    imports; and what this build writes stays readable by Beta 1, which only
 *    knows the preset;
 *  - both grid orientations, and the grid geometry, cope with any number of
 *    columns from one to seven.
 *
 * Run it with `npm test` (or `node --import ./tests/support/setup.mjs --test tests/weekdays.test.mjs` alone).
 */

import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { weekDatesFrom } from "@/domain/calendar";
import { calendarOccurrencesIn } from "@/domain/calendarExport";
import { createId } from "@/domain/id";
import { OPEN_ENDED_DATE } from "@/domain/recurrence";
import { planReminders } from "@/domain/reminderSchedule";
import { generateTimeSlots } from "@/domain/time";
import { cellKey, resolveWeekBlocks, resolveWeekClasses, weekdaysWithClasses } from "@/domain/timetable";
import {
  getOrderedWeekdays,
  normalizeVisibleWeekdays,
  parseWeekdays,
  serializeWeekdays,
  weekendModeCovering,
} from "@/domain/week";
import {
  columnWidthForZoom,
  MAX_COLUMN_WIDTH,
  maxOffsetXFor,
  maxZoomFor,
  minColumnWidthFor,
  TIME_GUTTER_WIDTH,
} from "@/features/timetable/geometry";
import { daysLabel } from "@/features/timetables/summary";
import { DEFAULT_SETTINGS } from "@/state/defaults";
import { openTemeloDatabase } from "@/storage/database";
import { MIGRATIONS } from "@/storage/migrations";
import { buildTimetableSnapshot, parseTimetableSnapshot, serializeTimetableSnapshot, timetableSettingsOf } from "@/storage/snapshot";
import { buildTemeloFile, parseTemeloFile, serializeTemeloFile } from "@/storage/timetableFile";
import { archiveActiveTimetable, createTimetable, listArchivedTimetables, restoreArchivedTimetable } from "@/storage/timetableLifecycle";
import { loadTimetable, saveTimetable } from "@/storage/timetableRepository";
import { check, equal, section } from "./support/assertions.mjs";
import { useDatabaseFile } from "./support/sqlite-stub.mjs";

const directory = mkdtempSync(join(tmpdir(), "temelo-weekdays-"));
let databaseIndex = 0;
const nextPath = () => join(directory, `temelo-${databaseIndex++}.db`);

const NOW = "2026-09-11T09:00:00.000Z";
const START = "2026-09-07";
const WEEK = "2026-09-14";
const ALL = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MON_FRI = ALL.slice(0, 5);

const T = (key, params) => (key === "timetables.daysRange" ? `${params.first}–${params.last}` : key);
const FORMAT = { weekdayShort: (day) => day.slice(0, 1).toUpperCase() + day.slice(1, 3) };

function slots(ids = (index) => `slot-${index + 1}`) {
  const result = generateTimeSlots({ dayStart: "08:00", lessonDurationMinutes: 45, breakDurationMinutes: 10, slotCount: 4 });
  if (!result.ok) throw new Error("fixture academic day does not generate");
  return result.slots.map((slot, index) => ({ id: ids(index), ...slot }));
}

function course(id, name) {
  return { id, name, room: "", teacher: "", notes: "", appearanceId: "blue", createdAt: NOW, updatedAt: NOW, deletedAt: null };
}

function placement(id, courseId, weekday, timeSlotId, fields = {}) {
  return {
    id,
    courseId,
    weekday,
    timeSlotId,
    slotSpan: 1,
    recurrenceType: "weekly",
    startsOn: START,
    endsOn: OPEN_ENDED_DATE,
    startsWithTimetable: true,
    reminderMinutes: 10,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...fields,
  };
}

/* ------------------------------------------------------- A: the vocabulary */

function testVocabulary() {
  section("Days A. Any set of days, kept Monday first; the legacy preset never hides a shown day");

  equal("a set is put in week order", normalizeVisibleWeekdays(["friday", "monday", "wednesday"]).join(","), "monday,wednesday,friday");
  equal("...each day once", normalizeVisibleWeekdays(["monday", "monday"]).join(","), "monday");
  equal("an empty set is refused", normalizeVisibleWeekdays([]), null);
  equal("a day that is not a weekday is refused", normalizeVisibleWeekdays(["monday", "funday"]), null);
  equal("a column round-trips", parseWeekdays(serializeWeekdays(["tuesday", "saturday"])).join(","), "tuesday,saturday");
  equal("an empty column reads as nothing usable", parseWeekdays(""), null);

  equal("Mon–Fri is covered by 'Sat & Sun off'", weekendModeCovering(MON_FRI), "saturdaySunday");
  equal("Mon, Wed, Fri too — Beta 1 shows those days and more", weekendModeCovering(["monday", "wednesday", "friday"]), "saturdaySunday");
  equal("a set with Saturday needs 'Sun only off'", weekendModeCovering(["tuesday", "saturday"]), "sundayOnly");
  equal("a set with Sunday needs the whole week", weekendModeCovering(["sunday"]), "none");
  for (const mode of ["saturdaySunday", "sundayOnly", "none"]) {
    equal(`each preset's own days map back to it (${mode})`, weekendModeCovering(getOrderedWeekdays(mode)), mode);
  }

  equal("labels: a run is a range", daysLabel(T, FORMAT, MON_FRI), "Mon–Fri");
  equal("labels: scattered days are named", daysLabel(T, FORMAT, ["monday", "wednesday", "friday"]), "Mon, Wed, Fri");
  equal("labels: a run and a day", daysLabel(T, FORMAT, ["monday", "tuesday", "wednesday", "saturday"]), "Mon–Wed, Sat");
  equal("labels: two neighbours are named, not ranged", daysLabel(T, FORMAT, ["saturday", "sunday"]), "Sat, Sun");
}

/* ------------------------------------- B: presentation only, both layouts */

function fixture() {
  return {
    timeSlots: slots(),
    courses: [course("c-mon", "Maths"), course("c-tue", "Tuesday seminar"), course("c-sat", "Saturday lab")],
    placements: [
      placement("p-mon", "c-mon", "monday", "slot-1"),
      placement("p-tue", "c-tue", "tuesday", "slot-2"),
      placement("p-sat", "c-sat", "saturday", "slot-3"),
    ],
    exceptions: [],
    timetableStart: START,
  };
}

function testPresentationOnly() {
  section("Days B. Hiding a day changes what is drawn, and nothing else");

  const state = fixture();
  const shown = ["monday", "wednesday", "friday"];
  const input = { ...state, weekdays: shown, dates: weekDatesFrom(WEEK) };

  const blocks = resolveWeekBlocks(input);
  equal("vertical: only classes on shown days are drawn", blocks.map((block) => block.course.name).join(","), "Maths");
  equal("...in the column of their day among those shown", blocks[0].dayIndex, 0);
  const horizontal = resolveWeekClasses(input);
  equal("horizontal: no hidden day has a cell", horizontal.has(cellKey("tuesday", "slot-2")) || horizontal.has(cellKey("saturday", "slot-3")), false);
  equal("...and the shown one does", (horizontal.get(cellKey("monday", "slot-1")) ?? []).length, 1);

  const later = resolveWeekBlocks({ ...input, weekdays: ["tuesday", "wednesday", "saturday"] });
  equal("showing the days again brings their classes back", later.map((block) => `${block.course.name}@${block.dayIndex}`).sort().join(","), "Saturday lab@2,Tuesday seminar@0");

  const text = { startsIn: (lead) => `in ${lead}`, room: (room) => `Room ${room}` };
  const reminded = planReminders({ ...state, fromDate: WEEK, now: Date.parse(`${WEEK}T00:00:00`), text }).map((reminder) => reminder.title);
  check("reminders still include classes on hidden days", reminded.includes("Tuesday seminar") && reminded.includes("Saturday lab"), reminded.join(","));
  const snapshot = { timetable: { id: "t", name: "T", anchorDate: START, createdAt: NOW, updatedAt: NOW }, ...state };
  const exported = calendarOccurrencesIn(snapshot, { from: WEEK, to: "2026-09-20" }, { teacher: (name) => name }).map((event) => event.summary);
  equal("...and so does the calendar export", exported.sort().join(","), "Maths,Saturday lab,Tuesday seminar");

  equal("the days that hold classes are known, for the warning", [...weekdaysWithClasses(state)].sort().join(","), "monday,saturday,tuesday");
  const withOneOff = {
    ...state,
    courses: [...state.courses, course("c-trip", "Trip")],
    placements: [...state.placements, placement("p-trip", "c-trip", "monday", "slot-4", { recurrenceType: "once", startsOn: "2026-09-20", endsOn: "2026-09-20", startsWithTimetable: false })],
  };
  check("...a one-off counts on the day it actually meets", weekdaysWithClasses(withOneOff).has("sunday"));
  const deleted = { ...state, placements: state.placements.map((entry) => (entry.id === "p-sat" ? { ...entry, deletedAt: NOW } : entry)) };
  check("...a deleted class does not count", !weekdaysWithClasses(deleted).has("saturday"));
}

/* ------------------------------------------------ C: geometry, 1–7 columns */

function testGeometry() {
  section("Days C. The grid geometry holds for one to seven columns");

  for (const pageWidth of [360, 412]) {
    const bodyWidth = pageWidth - TIME_GUTTER_WIDTH;
    for (let dayCount = 1; dayCount <= 7; dayCount++) {
      const minWidth = minColumnWidthFor(bodyWidth, dayCount);
      check(`${pageWidth}pt, ${dayCount} day(s): zoomed out, the week fills the body exactly`, Math.abs(minWidth * dayCount - bodyWidth) < 0.01);
      equal(`${pageWidth}pt, ${dayCount} day(s): ...so a swipe pages straight away`, maxOffsetXFor(minWidth, dayCount, bodyWidth), 0);
      const zoom = maxZoomFor(bodyWidth, 600, dayCount, 4);
      const widest = columnWidthForZoom(zoom, bodyWidth, dayCount);
      check(`${pageWidth}pt, ${dayCount} day(s): ...and no zoom makes a column wider than the page's room for it`, widest <= Math.max(MAX_COLUMN_WIDTH, pageWidth) + 0.01, `${widest}`);
    }
  }
}

/* ------------------------------------------------ D: upgrading a v7 device */

/** A database exactly at v7 — before `visible_weekdays` existed — with one preset stored. */
async function buildV7Database(weekendMode) {
  const path = nextPath();
  useDatabaseFile(path);
  const { openDatabaseAsync } = await import("./support/sqlite-stub.mjs");
  const db = await openDatabaseAsync();
  await db.execAsync("PRAGMA foreign_keys = ON;");
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= 7)) {
    await migration.up(db);
    await db.execAsync(`PRAGMA user_version = ${migration.version}`);
  }
  // v5's convergence adds every column this build requires, v8's included;
  // a device that really ran v5 in Beta 1 never had it.
  await db.execAsync("ALTER TABLE settings DROP COLUMN visible_weekdays");

  await db.runAsync(
    `INSERT INTO settings (id, weekend_mode, grid_orientation, academic_day_start, default_lesson_duration_minutes,
       default_break_duration_minutes, slot_count, onboarding_completed, default_reminder_minutes,
       appearance_preference, language_preference)
     VALUES ('app', ?, 'vertical', '08:00', 45, 10, 4, 1, 30, 'system', 'system')`,
    weekendMode,
  );
  await db.runAsync(
    "INSERT INTO active_timetable (singleton, id, name, anchor_date, created_at, updated_at) VALUES ('active', 't-1', 'Beta 1', ?, ?, ?)",
    START,
    NOW,
    NOW,
  );
  db.closeSync();
  return path;
}

async function testUpgrade() {
  section("Days D. v7 -> v8: every device opens to exactly the days it showed");

  for (const [mode, expected] of [
    ["saturdaySunday", MON_FRI],
    ["sundayOnly", ALL.slice(0, 6)],
    ["none", ALL],
  ]) {
    const path = await buildV7Database(mode);
    useDatabaseFile(path);
    const { db, schemaVersion } = await openTemeloDatabase();
    equal(`${mode}: migrated to v8`, schemaVersion, 8);
    const row = await db.getFirstAsync("SELECT weekend_mode, visible_weekdays FROM settings");
    equal(`${mode}: the days were backfilled from the preset`, row.visible_weekdays, expected.join(","));
    equal(`${mode}: ...and the preset itself is untouched`, row.weekend_mode, mode);
    const state = await loadTimetable(db);
    equal(`${mode}: the app reads the same days`, state.settings.visibleWeekdays.join(","), expected.join(","));
    db.closeSync();
  }

  // A column a newer or experimental build left empty reads as the preset.
  const path = await buildV7Database("sundayOnly");
  useDatabaseFile(path);
  const { db } = await openTemeloDatabase();
  await db.runAsync("UPDATE settings SET visible_weekdays = NULL");
  equal("an empty column falls back to the preset's days", (await loadTimetable(db)).settings.visibleWeekdays.length, 6);
  await db.runAsync("UPDATE settings SET visible_weekdays = 'funday'");
  equal("...and so does an unreadable one", (await loadTimetable(db)).settings.visibleWeekdays.length, 6);
  db.closeSync();
}

/* ------------------------------- E: hide, restore, relaunch, archive, file */

async function testRoundTrips() {
  section("Days E. Hiding and showing days loses nothing — through relaunch, archive and file");

  const path = nextPath();
  useDatabaseFile(path);
  let { db } = await openTemeloDatabase();
  const timeSlots = slots(() => createId());
  const empty = { settings: { ...DEFAULT_SETTINGS, onboardingCompleted: true }, timetable: null, timeSlots: [], courses: [], placements: [], exceptions: [] };
  const created = await createTimetable(db, empty, {
    name: "Days",
    defaultName: "Timetable",
    settings: { ...timetableSettingsOf(DEFAULT_SETTINGS), visibleWeekdays: ALL.slice(0, 6), slotCount: timeSlots.length },
    timeSlots,
    anchorDate: START,
    now: NOW,
  });
  if (!created.ok) throw new Error("fixture timetable was not created");

  const withClasses = {
    ...created.state,
    courses: [course("c-mon", "Maths"), course("c-sat", "Saturday lab")],
    placements: [placement("p-mon", "c-mon", "monday", timeSlots[0].id), placement("p-sat", "c-sat", "saturday", timeSlots[1].id)],
  };
  await saveTimetable(db, withClasses, created.state);

  // Hide Saturday and Wednesday.
  const hidden = { ...withClasses, settings: { ...withClasses.settings, visibleWeekdays: ["monday", "tuesday", "thursday", "friday"] } };
  await saveTimetable(db, hidden, withClasses);
  db.closeSync();

  useDatabaseFile(path);
  ({ db } = await openTemeloDatabase());
  let state = await loadTimetable(db);
  equal("the custom set survives a relaunch", state.settings.visibleWeekdays.join(","), "monday,tuesday,thursday,friday");
  const row = await db.getFirstAsync("SELECT weekend_mode FROM settings");
  equal("...with the legacy preset written as the narrowest that covers it", row.weekend_mode, "saturdaySunday");
  equal("the class on the hidden Saturday is still stored", state.placements.filter((entry) => !entry.deletedAt).length, 2);

  // Show Saturday again.
  const shownAgain = { ...state, settings: { ...state.settings, visibleWeekdays: ALL.slice(0, 6) } };
  await saveTimetable(db, shownAgain, state);
  state = await loadTimetable(db);
  const blocks = resolveWeekBlocks({ ...state, weekdays: state.settings.visibleWeekdays, dates: weekDatesFrom(WEEK), timetableStart: START });
  equal("showing Saturday again draws its class again", blocks.map((block) => block.course.name).sort().join(","), "Maths,Saturday lab");
  equal("...and the preset widened with it", (await db.getFirstAsync("SELECT weekend_mode FROM settings")).weekend_mode, "sundayOnly");

  // Archive and restore keep the timetable's own days.
  const custom = { ...state, settings: { ...state.settings, visibleWeekdays: ["monday", "wednesday", "saturday"] } };
  await saveTimetable(db, custom, state);
  const archived = await archiveActiveTimetable(db, custom, NOW);
  check("the timetable archives", archived.ok);
  const [summary] = await listArchivedTimetables(db);
  equal("the archive list reads its days", summary.contents.visibleWeekdays.join(","), "monday,wednesday,saturday");
  const restored = await restoreArchivedTimetable(db, archived.state, summary.id, NOW);
  check("...and restores", restored.ok);
  equal("...with exactly the days it had", restored.state.settings.visibleWeekdays.join(","), "monday,wednesday,saturday");
  equal("...and both its classes", restored.state.placements.filter((entry) => !entry.deletedAt).length, 2);
  check("...and no stray legacy field in the app's settings", !("weekendMode" in restored.state.settings));
  db.closeSync();

  // A .temelo written now: carries the set, and the preset Beta 1 reads.
  const snapshot = buildTimetableSnapshot({
    timetable: restored.state.timetable,
    settings: timetableSettingsOf(restored.state.settings),
    timeSlots: restored.state.timeSlots,
    courses: restored.state.courses,
    placements: restored.state.placements,
    exceptions: restored.state.exceptions,
  });
  const text = serializeTemeloFile(buildTemeloFile(snapshot, NOW));
  const raw = JSON.parse(text);
  equal("a file carries the visible days", raw.timetable.settings.visibleWeekdays.join(","), "monday,wednesday,saturday");
  check(
    "...and a preset Beta 1 accepts, showing every one of those days",
    ["saturdaySunday", "sundayOnly", "none"].includes(raw.timetable.settings.weekendMode) &&
      raw.timetable.settings.visibleWeekdays.every((day) => getOrderedWeekdays(raw.timetable.settings.weekendMode).includes(day)),
    raw.timetable.settings.weekendMode,
  );
  const parsed = parseTemeloFile(text);
  check("the file imports", parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.failure));
  if (parsed.ok) equal("...with its days", parsed.file.timetable.settings.visibleWeekdays.join(","), "monday,wednesday,saturday");

  // A Beta 1 backup: the preset and nothing else.
  const beta1 = JSON.parse(text);
  delete beta1.timetable.settings.visibleWeekdays;
  beta1.timetable.settings.weekendMode = "sundayOnly";
  const old = parseTemeloFile(JSON.stringify(beta1));
  check("a Beta 1 .temelo still imports", old.ok, old.ok ? "" : JSON.stringify(old.failure));
  if (old.ok) equal("...showing exactly the days its preset did", old.file.timetable.settings.visibleWeekdays.join(","), ALL.slice(0, 6).join(","));
  const oldArchive = parseTimetableSnapshot(JSON.stringify(beta1.timetable));
  check("...and so does a Beta 1 archive snapshot", oldArchive.ok && oldArchive.snapshot.settings.visibleWeekdays.length === 6);
  const reencoded = parseTimetableSnapshot(serializeTimetableSnapshot(snapshot));
  equal("a snapshot re-encodes to the same bytes", reencoded.ok && serializeTimetableSnapshot(reencoded.snapshot), serializeTimetableSnapshot(snapshot));
}

/* ---------------------------------------------------------------- tests */

test("Days A. Any set of days, kept Monday first; the legacy preset never hides a shown day", () => {
  testVocabulary();
});

test("Days B. Hiding a day changes what is drawn, and nothing else", () => {
  testPresentationOnly();
});

test("Days C. The grid geometry holds for one to seven columns", () => {
  testGeometry();
});

test("Days D. v7 -> v8: every device opens to exactly the days it showed", async () => {
  await testUpgrade();
});

test("Days E. Hiding and showing days loses nothing — through relaunch, archive and file", async () => {
  await testRoundTrips();
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
