/**
 * Timetable export and import harness.
 *
 * The lifecycle harness next door asks whether a *swap* can lose a timetable.
 * This one asks the two questions a file raises that an archive does not.
 *
 * The first is trust. An archive comes out of a column this build wrote; a
 * `.temelo` comes out of a messaging app, and every one of the eight ways it
 * can be wrong — not JSON, not Temelo, from a newer Temelo, a newer snapshot
 * inside an older envelope, missing fields, dangling references, duplicate ids,
 * absurdly large — has to be refused with *zero* rows written. Not rolled back:
 * never started. So each of those cases fingerprints the whole database before
 * and after and asserts the two are identical, byte for byte, rather than
 * checking that the import "returned an error".
 *
 * The second is identity. A file may be imported onto the phone that wrote it,
 * twice, while the timetable it came from is still there — so every id in it
 * has to be replaced, every reference between those ids has to survive the
 * replacement, and nothing the user can see may change in the process. The
 * suites below check both halves of that: a domain fingerprint that ignores ids
 * (the timetable must be identical) and an id census (no id may be shared).
 *
 * The fixture is deliberately the awkward one: a split series whose two halves
 * must stay two halves, a biweekly class whose parity must survive, a one-off, a
 * modified and a cancelled exception with colour and reminder overrides, a
 * soft-deleted class pointing at a period that no longer exists, and per-class
 * reminder lead times throughout. A timetable of five plain weekly classes would
 * pass all of this while proving nothing.
 *
 * Run it with `node harness/run.mjs`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createId } from "@/domain/id";
import { OPEN_ENDED_DATE, occursOn } from "@/domain/recurrence";
import { addDaysIso } from "@/domain/date";
import { generateTimeSlots } from "@/domain/time";
import { openTemeloDatabase } from "@/storage/database";
import {
  SNAPSHOT_FORMAT_VERSION,
  buildTimetableSnapshot,
  serializeTimetableSnapshot,
  summarizeTimetableSnapshot,
  timetableSettingsOf,
} from "@/storage/snapshot";
import {
  MAX_TEMELO_FILE_LENGTH,
  MAX_TEMELO_FILE_RECORDS,
  TEMELO_FILE_FORMAT_VERSION,
  TEMELO_FILE_TYPE,
  buildTemeloFile,
  buildValidatedTemeloFile,
  cloneSnapshotWithFreshIds,
  parseTemeloFile,
  serializeTemeloFile,
  temeloFileName,
} from "@/storage/timetableFile";
import {
  archiveActiveTimetable,
  countArchivedTimetables,
  createTimetable,
  importTimetableSnapshot,
  listArchivedTimetables,
  readArchivedSnapshotRow,
  restoreArchivedTimetable,
} from "@/storage/timetableLifecycle";
import { loadTimetable, saveTimetable } from "@/storage/timetableRepository";
import { DEFAULT_SETTINGS } from "@/state/defaults";
import { check, equal, section } from "./report.mjs";
import { useDatabaseFile } from "./sqlite-stub.mjs";

const directory = mkdtempSync(join(tmpdir(), "temelo-transfer-"));
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

const NOW = "2026-09-12T09:00:00.000Z";
const LATER = "2026-09-12T10:30:00.000Z";

/* ----------------------------------------------------------------- fixtures */

/** A timetable the creation flow would produce, as its inputs. */
function newTimetableInput(name, overrides = {}) {
  const settings = {
    weekendMode: "saturdaySunday",
    academicDayStart: "07:30",
    defaultLessonDurationMinutes: 45,
    defaultBreakDurationMinutes: 10,
    slotCount: 6,
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
    defaultName: "Timetable",
    settings,
    timeSlots: slots.slots.map((slot) => ({
      id: createId(),
      position: slot.position,
      startTime: slot.startTime,
      endTime: slot.endTime,
    })),
    anchorDate: "2026-09-07",
    now: NOW,
  };
}

const EMPTY_STATE = {
  settings: {
    weekendMode: "saturdaySunday",
    gridOrientation: "vertical",
    academicDayStart: "07:30",
    defaultLessonDurationMinutes: 45,
    defaultBreakDurationMinutes: 10,
    slotCount: 6,
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

function course(id, name, appearanceId, extra = {}) {
  return {
    id,
    name,
    room: extra.room ?? "",
    teacher: extra.teacher ?? "",
    notes: extra.notes ?? "",
    appearanceId,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: extra.deletedAt ?? null,
  };
}

function placement(id, courseId, fields) {
  return {
    id,
    courseId,
    weekday: fields.weekday,
    timeSlotId: fields.timeSlotId,
    slotSpan: fields.slotSpan ?? 1,
    recurrenceType: fields.recurrenceType ?? "weekly",
    startsOn: fields.startsOn,
    endsOn: fields.endsOn ?? OPEN_ENDED_DATE,
    startsWithTimetable: fields.startsWithTimetable ?? true,
    reminderMinutes: fields.reminderMinutes ?? null,
    createdAt: fields.createdAt ?? NOW,
    updatedAt: fields.updatedAt ?? NOW,
    deletedAt: fields.deletedAt ?? null,
  };
}

function exception(id, placementId, fields) {
  return {
    id,
    placementId,
    originalDate: fields.originalDate,
    effectiveDate: fields.effectiveDate ?? fields.originalDate,
    state: fields.state,
    timeSlotId: fields.timeSlotId ?? null,
    slotSpan: fields.slotSpan ?? null,
    name: fields.name ?? null,
    room: fields.room ?? null,
    teacher: fields.teacher ?? null,
    notes: fields.notes ?? null,
    appearanceId: fields.appearanceId ?? null,
    reminderMinutes: fields.reminderMinutes ?? null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: fields.deletedAt ?? null,
  };
}

/**
 * A database holding one awkward but entirely legitimate timetable.
 *
 * Built through the real `createTimetable` and the real `saveTimetable`, so
 * what it contains is what a device contains — not a hand-written row set that
 * only this harness could produce.
 *
 * The one thing here that the *app* could not have produced directly is the
 * soft-deleted class pointing at a period id that is not in `time_slots`. A
 * device gets there by changing the academic day, which regenerates every
 * period and leaves the old classes soft-deleted behind them; the snapshot
 * format deliberately tolerates it (see the note in `assertCoherent`), so the
 * remapper has to as well. It is written directly because reproducing it
 * through an academic-day change would be a test of the academic-day change.
 */
async function buildFixture(name = "Computer Science") {
  const path = nextPath();
  const { db } = await open(path);

  const created = await createTimetable(db, EMPTY_STATE, newTimetableInput(name));
  if (!created.ok) throw new Error("fixture timetable was not created");
  const base = created.state;
  const slot = (position) => base.timeSlots.find((entry) => entry.position === position).id;

  const courses = [
    course("c-maths", "Mathematics", "blue", { room: "101", teacher: "Ivanova" }),
    course("c-history", "History", "amber", { room: "204" }),
    course("c-trip", "Museum trip", "teal"),
    course("c-physics", "Physics", "magenta", { room: "Lab A", notes: "bring goggles" }),
    // Soft-deleted, and pointing at a period that is not in this timetable.
    course("c-gone", "Old elective", "red", { deletedAt: NOW }),
  ];

  const placements = [
    // Ordinary weekly, open-ended, reaching back as far as the timetable does.
    placement("p-maths", "c-maths", {
      weekday: "monday",
      timeSlotId: slot(3),
      recurrenceType: "weekly",
      startsOn: "2026-09-07",
      reminderMinutes: 30,
    }),
    // Every two weeks, anchored a week after the timetable starts — a parity
    // that a re-anchoring import would visibly shift by a week.
    placement("p-history", "c-history", {
      weekday: "tuesday",
      timeSlotId: slot(2),
      slotSpan: 2,
      recurrenceType: "biweekly",
      startsOn: "2026-09-15",
      reminderMinutes: 60,
    }),
    // A single lesson, which must stay a single lesson.
    placement("p-trip", "c-trip", {
      weekday: "friday",
      timeSlotId: slot(5),
      recurrenceType: "once",
      startsOn: "2026-10-16",
      endsOn: "2026-10-16",
    }),
    // The earlier half of a split series: a genuine end date.
    placement("p-physics-old", "c-physics", {
      weekday: "thursday",
      timeSlotId: slot(1),
      recurrenceType: "weekly",
      startsOn: "2026-09-07",
      endsOn: "2026-10-21",
      reminderMinutes: 15,
      updatedAt: LATER,
    }),
    // ...and its later half, which genuinely begins on the split date and must
    // never leak back into the weeks the earlier half covers.
    placement("p-physics-new", "c-physics", {
      weekday: "thursday",
      timeSlotId: slot(4),
      recurrenceType: "weekly",
      startsOn: "2026-10-22",
      startsWithTimetable: false,
      reminderMinutes: 15,
      createdAt: LATER,
      updatedAt: LATER,
    }),
    // Soft-deleted, pointing at a period this timetable does not have.
    placement("p-gone", "c-gone", {
      weekday: "wednesday",
      timeSlotId: "slot-from-a-previous-academic-day",
      recurrenceType: "weekly",
      startsOn: "2026-09-07",
      deletedAt: NOW,
    }),
  ];

  const exceptions = [
    exception("x-maths-moved", "p-maths", {
      originalDate: "2026-09-21",
      effectiveDate: "2026-09-22",
      state: "modified",
      timeSlotId: slot(4),
      name: "Mathematics (test)",
      room: "Hall",
      appearanceId: "red",
      reminderMinutes: 10,
    }),
    exception("x-history-cancelled", "p-history", {
      originalDate: "2026-10-13",
      state: "cancelled",
    }),
    // "No reminder for this one occurrence" — the three-state override's third
    // state, which is not null and is not a number.
    exception("x-physics-silent", "p-physics-new", {
      originalDate: "2026-11-05",
      state: "modified",
      reminderMinutes: "none",
    }),
  ];

  const next = { ...base, courses, placements, exceptions };
  await saveTimetable(db, next, base);
  return { path, db, state: await loadTimetable(db) };
}

/* ------------------------------------------------------------------ helpers */

/** The active timetable, as the snapshot an export would write. */
function snapshotOf(state) {
  return buildTimetableSnapshot({
    timetable: state.timetable,
    settings: timetableSettingsOf(state.settings),
    timeSlots: state.timeSlots,
    courses: state.courses,
    placements: state.placements,
    exceptions: state.exceptions,
  });
}

/**
 * A timetable as a value with every id erased.
 *
 * This is what "domain-equivalent" means for an import: the same periods, the
 * same classes on the same days at the same times with the same colours and
 * reminders, the same recurrence, the same exceptions — and *different* ids
 * throughout. So references are rewritten as positions within the snapshot
 * ("the third period", "the class belonging to the second course") rather than
 * dropped, because dropping them would let a remapper that scrambled every
 * relationship pass.
 *
 * Courses and placements are keyed by name and by their position in the
 * original arrays, both of which survive a remap; the arrays are compared in
 * order, which the repository's `rowid` ordering guarantees is the order they
 * were written in.
 */
function domainPrint(snapshot) {
  const slotIndex = new Map(snapshot.timeSlots.map((slot, index) => [slot.id, index]));
  const courseIndex = new Map(snapshot.courses.map((entry, index) => [entry.id, index]));
  const placementIndex = new Map(snapshot.placements.map((entry, index) => [entry.id, index]));
  // A period a soft-deleted class points at may not be in the snapshot at all;
  // "not here" is itself a fact worth preserving across the remap.
  const slotRef = (id) => (id === null ? null : (slotIndex.get(id) ?? "outside"));

  return JSON.stringify({
    name: snapshot.timetable.name,
    anchorDate: snapshot.timetable.anchorDate,
    createdAt: snapshot.timetable.createdAt,
    settings: snapshot.settings,
    timeSlots: snapshot.timeSlots.map((slot) => [slot.position, slot.startTime, slot.endTime]),
    courses: snapshot.courses.map((entry) => [
      entry.name,
      entry.room,
      entry.teacher,
      entry.notes,
      entry.appearanceId,
      entry.createdAt,
      entry.deletedAt,
    ]),
    placements: snapshot.placements.map((entry) => [
      courseIndex.get(entry.courseId),
      entry.weekday,
      slotRef(entry.timeSlotId),
      entry.slotSpan,
      entry.recurrenceType,
      entry.startsOn,
      entry.endsOn,
      entry.startsWithTimetable,
      entry.reminderMinutes,
      entry.createdAt,
      entry.deletedAt,
    ]),
    exceptions: snapshot.exceptions.map((entry) => [
      placementIndex.get(entry.placementId),
      entry.originalDate,
      entry.effectiveDate,
      entry.state,
      slotRef(entry.timeSlotId),
      entry.slotSpan,
      entry.name,
      entry.room,
      entry.teacher,
      entry.notes,
      entry.appearanceId,
      entry.reminderMinutes,
      entry.deletedAt,
    ]),
  });
}

/** Every id a snapshot mentions, in one set. */
function idsOf(snapshot) {
  const ids = new Set([snapshot.timetable.id]);
  for (const slot of snapshot.timeSlots) ids.add(slot.id);
  for (const entry of snapshot.courses) ids.add(entry.id);
  for (const entry of snapshot.placements) {
    ids.add(entry.id);
    ids.add(entry.courseId);
    ids.add(entry.timeSlotId);
  }
  for (const entry of snapshot.exceptions) {
    ids.add(entry.id);
    ids.add(entry.placementId);
    if (entry.timeSlotId !== null) ids.add(entry.timeSlotId);
  }
  return ids;
}

/**
 * The whole database, as one comparable string.
 *
 * Every table, every row, plus `user_version` — because "an invalid file
 * changed nothing" has to mean the database, not the timetable. A rejected
 * import that quietly added an archive row, bumped a counter or touched
 * `settings` would pass a narrower check.
 */
async function databasePrint(db) {
  const tables = [
    "settings",
    "active_timetable",
    "time_slots",
    "courses",
    "placements",
    "occurrence_exceptions",
    "archived_timetables",
    "meta",
    "reminder_deliveries",
  ];
  const dump = {};
  for (const table of tables) {
    dump[table] = await db.getAllAsync(`SELECT * FROM ${table}`);
  }
  dump.userVersion = await db.getFirstAsync("PRAGMA user_version");
  return JSON.stringify(dump);
}

/** Every date a series meets on inside a window — how parity is compared. */
function meetingDates(entry, from, until) {
  const dates = [];
  for (let date = from; date <= until; date = addDaysIso(date, 1)) {
    if (occursOn(entry, date)) dates.push(date);
  }
  return dates;
}

function placementNamed(snapshot, courseName) {
  const target = snapshot.courses.find((entry) => entry.name === courseName);
  return snapshot.placements.filter((entry) => entry.courseId === target.id);
}

/* ------------------------------------------------- A, B, C: writing a file */

async function testExport() {
  section("A. Exporting the active timetable");

  const { path, db, state } = await buildFixture();
  const snapshot = snapshotOf(state);

  const built = buildValidatedTemeloFile(snapshot, NOW);
  check("the active timetable exports", built.ok, JSON.stringify(built.failure ?? null));

  const raw = JSON.parse(built.text);
  equal("the file says what it is", raw.type, TEMELO_FILE_TYPE);
  equal("...in version 1", raw.formatVersion, TEMELO_FILE_FORMAT_VERSION);
  equal("...and carries the snapshot's own version", raw.timetable.formatVersion, SNAPSHOT_FORMAT_VERSION);
  equal("...and when it was written", raw.exportedAt, NOW);
  check("its top level is exactly the four documented fields",
    JSON.stringify(Object.keys(raw).sort()) === JSON.stringify(["exportedAt", "formatVersion", "timetable", "type"]),
    JSON.stringify(Object.keys(raw)));

  /*
   * The exclusion list, asserted against the text rather than against a type.
   * A field added to `Settings` and accidentally carried into the snapshot
   * would compile perfectly and would be a privacy regression, so this looks
   * for the *values* the app holds and must not export.
   */
  const settingsKeys = Object.keys(raw.timetable.settings).sort();
  equal(
    "the file carries only the timetable's own settings",
    JSON.stringify(settingsKeys),
    JSON.stringify([
      "academicDayStart",
      "defaultBreakDurationMinutes",
      "defaultLessonDurationMinutes",
      "slotCount",
      "weekendMode",
    ]),
  );
  for (const forbidden of [
    "appearancePreference",
    "languagePreference",
    "defaultReminderMinutes",
    "gridOrientation",
    "onboardingCompleted",
    "user_version",
    "reminder_deliveries",
    "reminderKey",
  ]) {
    check(`the file mentions no ${forbidden}`, !built.text.includes(forbidden), "it is in the file");
  }

  // The fixture's awkward parts, present and intact.
  equal("the periods travelled", raw.timetable.timeSlots.length, 6);
  equal("the courses travelled", raw.timetable.courses.length, 5);
  equal("the classes travelled", raw.timetable.placements.length, 6);
  equal("the exceptions travelled", raw.timetable.exceptions.length, 3);

  const summary = summarizeTimetableSnapshot(snapshot);
  equal("a preview reads the start date off it", summary.startDate, "2026-09-07");
  equal("...the days it shows", summary.weekendMode, "saturdaySunday");
  equal("...the first period's start", summary.dayStart, "07:30");
  equal("...the last period's end", summary.dayEnd, "12:50");
  equal("...and counts only the classes that are not deleted", summary.classCount, 5);

  db.closeSync();
  return { path, text: built.text, snapshot };
}

async function testExportArchived() {
  section("B. Exporting an archived timetable");

  const { path, db, state } = await buildFixture("Autumn 2026");
  const activePrint = domainPrint(snapshotOf(state));

  const archived = await archiveActiveTimetable(db, state, NOW);
  check("it archived", archived.ok, JSON.stringify(archived.reason ?? null));
  const listed = await listArchivedTimetables(db);
  equal("there is one archive", listed.length, 1);

  const read = await readArchivedSnapshotRow(db, listed[0].id);
  check("its stored snapshot reads back", read.ok, JSON.stringify(read.reason ?? null));

  const built = buildValidatedTemeloFile(read.snapshot, NOW);
  check("an archived timetable exports", built.ok, JSON.stringify(built.failure ?? null));
  equal(
    "...to exactly the timetable that was archived",
    domainPrint(parseTemeloFile(built.text).file.timetable),
    activePrint,
  );

  // A rename touches the column and deliberately not the snapshot, so an
  // export has to prefer the column or it hands out a stale name.
  await db.runAsync("UPDATE archived_timetables SET name = ? WHERE id = ?", "Renamed later", listed[0].id);
  const renamed = await readArchivedSnapshotRow(db, listed[0].id);
  equal("a renamed archive exports under its new name", renamed.snapshot.timetable.name, "Renamed later");

  db.closeSync();
  return path;
}

function testRoundTrip(text, snapshot) {
  section("C. Encode, parse, validate — a round trip");

  const parsed = parseTemeloFile(text);
  check("the file this build wrote is a file this build accepts", parsed.ok, JSON.stringify(parsed.failure ?? null));
  equal("nothing was lost on the way through", domainPrint(parsed.file.timetable), domainPrint(snapshot));
  equal(
    "...and re-encoding it produces the same bytes",
    serializeTemeloFile(buildTemeloFile(parsed.file.timetable, parsed.file.exportedAt)),
    text,
  );

  // Whitespace, indentation and key order are JSON's business, not ours: a
  // file that survived being pretty-printed by a text editor is still a file.
  const pretty = JSON.stringify(JSON.parse(text), null, 2);
  const fromPretty = parseTemeloFile(pretty);
  check("a pretty-printed copy still parses", fromPretty.ok, JSON.stringify(fromPretty.failure ?? null));
  equal("...to the same timetable", domainPrint(fromPretty.file.timetable), domainPrint(snapshot));

  section("C2. Filenames");
  equal("an ordinary name becomes a filename", temeloFileName("My timetable"), "My timetable.temelo");
  equal("a slash cannot become a path", temeloFileName("2026/27"), "2026 27.temelo");
  equal("...nor can a traversal", temeloFileName("../../etc/passwd"), "etc passwd.temelo");
  equal("Windows' reserved characters go", temeloFileName('a<b>c:d"e|f?g*h'), "a b c d e f g h.temelo");
  equal("a newline is not a filename", temeloFileName("Autumn\n2026"), "Autumn 2026.temelo");
  equal("runs of space collapse", temeloFileName("  Autumn    2026  "), "Autumn 2026.temelo");
  equal("a name that is only dots falls back", temeloFileName("..."), "timetable.temelo");
  equal("an empty name falls back", temeloFileName("   "), "timetable.temelo");
  equal("a Cyrillic name survives", temeloFileName("Расписание1"), "Расписание1.temelo");
  equal("a German name survives", temeloFileName("Sommersemester 26"), "Sommersemester 26.temelo");
  equal("an emoji name survives", temeloFileName("🎓 Uni"), "🎓 Uni.temelo");
  equal(
    "a very long name is cut to something a filesystem accepts",
    temeloFileName("x".repeat(400)),
    `${"x".repeat(60)}.temelo`,
  );
}

/* --------------------------------------- D, E: importing into an empty app */

async function testImportIntoEmptyApp(text) {
  section("D. Importing with no active timetable makes it the active one");

  const path = nextPath();
  const { db } = await open(path);
  await saveTimetable(db, EMPTY_STATE, null);
  const before = await loadTimetable(db);
  equal("the app starts with no timetable", before.timetable, null);

  const file = parseTemeloFile(text);
  const result = await importTimetableSnapshot(db, before, file.file.timetable, LATER);
  equal("the import became the active timetable", result.destination, "active");

  const state = result.state;
  equal("its name came across", state.timetable.name, "Computer Science");
  equal("its start date came across", state.timetable.anchorDate, "2026-09-07");
  equal("its days shown came across", state.settings.weekendMode, "saturdaySunday");
  equal("its academic day start came across", state.settings.academicDayStart, "07:30");
  equal("...its lesson length", state.settings.defaultLessonDurationMinutes, 45);
  equal("...its break length", state.settings.defaultBreakDurationMinutes, 10);
  equal("...and its period count", state.settings.slotCount, 6);
  equal("its periods came across", state.timeSlots.length, 6);
  equal("...with their times", state.timeSlots[0].startTime, "07:30");
  equal("its courses came across", state.courses.length, 5);
  equal("its classes came across", state.placements.length, 6);
  equal("its exceptions came across", state.exceptions.length, 3);
  check(
    "importing counts as having set the app up",
    state.settings.onboardingCompleted,
    "onboardingCompleted is still false",
  );
  check(
    "the app's own preferences were not overwritten by the file",
    state.settings.appearancePreference === "system" &&
      state.settings.languagePreference === "system" &&
      state.settings.defaultReminderMinutes === 30 &&
      state.settings.gridOrientation === "vertical",
    JSON.stringify(state.settings),
  );

  const imported = snapshotOf(state);
  equal("the whole timetable is domain-equivalent", domainPrint(imported), domainPrint(file.file.timetable));

  section("D2. The awkward parts of the fixture, after an import");
  const maths = placementNamed(imported, "Mathematics")[0];
  equal("the weekly class is still open-ended", maths.endsOn, OPEN_ENDED_DATE);
  equal("...and still reaches back with the timetable", maths.startsWithTimetable, true);
  equal("...keeping its reminder", maths.reminderMinutes, 30);

  const history = placementNamed(imported, "History")[0];
  equal("the biweekly class is still biweekly", history.recurrenceType, "biweekly");
  equal(
    "...on exactly the same fortnights",
    JSON.stringify(meetingDates(history, "2026-09-07", "2026-11-30")),
    JSON.stringify(meetingDates(placementNamed(file.file.timetable, "History")[0], "2026-09-07", "2026-11-30")),
  );
  equal("...keeping its two-period span", history.slotSpan, 2);

  const trip = placementNamed(imported, "Museum trip")[0];
  equal("the one-off is still a one-off", trip.recurrenceType, "once");
  equal("...on its own day", trip.startsOn, "2026-10-16");
  equal("...and ends there", trip.endsOn, "2026-10-16");

  const physics = placementNamed(imported, "Physics");
  equal("the split series is still two halves", physics.length, 2);
  const earlier = physics.find((entry) => entry.startsOn === "2026-09-07");
  const later = physics.find((entry) => entry.startsOn === "2026-10-22");
  equal("the earlier half keeps its real end date", earlier.endsOn, "2026-10-21");
  equal("the later half is still open-ended", later.endsOn, OPEN_ENDED_DATE);
  check(
    "...and still genuinely begins at the split rather than with the timetable",
    later.startsWithTimetable === false,
    "the split's later half re-attached itself to the timetable",
  );
  check(
    "the two halves do not overlap on any date",
    meetingDates(earlier, "2026-09-01", "2026-12-31").every(
      (date) => !meetingDates(later, "2026-09-01", "2026-12-31").includes(date),
    ),
    "an occurrence is claimed by both halves",
  );

  const colours = imported.courses.map((entry) => entry.appearanceId).sort();
  equal("every colour came across", JSON.stringify(colours), JSON.stringify(["amber", "blue", "magenta", "red", "teal"]));

  const moved = imported.exceptions.find((entry) => entry.name === "Mathematics (test)");
  equal("a modified occurrence keeps the date it moved to", moved.effectiveDate, "2026-09-22");
  equal("...and the date it replaces", moved.originalDate, "2026-09-21");
  equal("...and its colour override", moved.appearanceId, "red");
  equal("...and its reminder override", moved.reminderMinutes, 10);
  const cancelled = imported.exceptions.find((entry) => entry.state === "cancelled");
  equal("a cancelled occurrence is still cancelled", cancelled.originalDate, "2026-10-13");
  const silent = imported.exceptions.find((entry) => entry.reminderMinutes === "none");
  check("a silenced occurrence is still silenced", silent !== undefined, "the 'none' override was lost");

  const deleted = imported.placements.find((entry) => entry.deletedAt !== null);
  check("a soft-deleted class came across as deleted", deleted !== undefined, "it was dropped or revived");
  check(
    "...still pointing at a period this timetable does not have",
    !imported.timeSlots.some((slot) => slot.id === deleted.timeSlotId),
    "the dangling period reference was silently repointed at a real period",
  );

  section("E. Every imported id is a fresh local one");
  const original = idsOf(file.file.timetable);
  const fresh = idsOf(imported);
  const shared = [...fresh].filter((id) => original.has(id));
  equal("no id from the file survived anywhere", shared.length, 0, shared.join(", "));
  equal("the imported timetable has its own id", state.timetable.id === file.file.timetable.timetable.id, false);

  // The references, checked the way SQLite would: every one has to name a
  // record that is actually in the imported timetable.
  const courseIds = new Set(imported.courses.map((entry) => entry.id));
  const placementIds = new Set(imported.placements.map((entry) => entry.id));
  const slotIds = new Set(imported.timeSlots.map((entry) => entry.id));
  check(
    "every class points at a course that is here",
    imported.placements.every((entry) => courseIds.has(entry.courseId)),
    "a class points outside the timetable",
  );
  check(
    "every exception points at a class that is here",
    imported.exceptions.every((entry) => placementIds.has(entry.placementId)),
    "an exception points outside the timetable",
  );
  check(
    "every live class points at a period that is here",
    imported.placements
      .filter((entry) => entry.deletedAt === null)
      .every((entry) => slotIds.has(entry.timeSlotId)),
    "a live class points at a period that is not here",
  );
  check(
    "every exception's period override points at a period that is here",
    imported.exceptions
      .filter((entry) => entry.timeSlotId !== null)
      .every((entry) => slotIds.has(entry.timeSlotId)),
    "an exception points at a period that is not here",
  );
  check(
    "the two remapped halves of the split still share one course",
    earlier.courseId === later.courseId,
    "the split's halves were given different courses",
  );

  db.closeSync();
  const relaunched = await reopen(path);
  equal("it survives a cold reopen", relaunched.state.timetable.name, "Computer Science");
  equal("...unchanged", domainPrint(snapshotOf(relaunched.state)), domainPrint(imported));
  equal("...with nothing in the archive", await countArchivedTimetables(relaunched.db), 0);
  relaunched.db.closeSync();
}

/* ---------------------------------------- E2: importing on a fresh install */

/**
 * The path a brand-new phone actually takes.
 *
 * Distinct from the suite above, and not a duplicate of it. That one imports
 * into a database that has been *written to* and simply has no active
 * timetable — the state a user reaches by archiving the only timetable they
 * had, where `settings` exists and `onboardingCompleted` is already true. This
 * one starts from a database `openTemeloDatabase` has only just created: no
 * settings row at all, `loadTimetable` returning null, which is the one state
 * the app treats as "never set up" and answers by redirecting to the first
 * setup screen.
 *
 * That redirect is what made this worth covering. Until this change the setup
 * screen was the only screen a first launch could reach, so the file the user
 * opened Temelo to restore was behind a timetable they had not made yet. The
 * assertions below are the three things that entry point has to be true of:
 * the import lands as the *active* timetable, `onboardingCompleted` is set in
 * the same transaction so the next launch does not bounce back to setup, and
 * all of it survives the process dying.
 *
 * `current` is `buildEmptyState()`'s shape — `DEFAULT_SETTINGS` with no
 * timetable — because that is precisely what `AppStateProvider` is holding when
 * hydration finds nothing stored, and it is what the screen would hand to the
 * import.
 */
async function testImportOnFreshInstall(text) {
  section("E2. Importing on a genuinely fresh install");

  const path = nextPath();
  const { db } = await open(path);

  // Nothing has ever been written: not an empty timetable, no settings row.
  equal("a fresh install has nothing stored at all", await loadTimetable(db), null);
  const settingsRows = await db.getAllAsync("SELECT * FROM settings");
  equal("...not even a settings row", settingsRows.length, 0);

  const fresh = {
    settings: { ...DEFAULT_SETTINGS },
    timetable: null,
    timeSlots: [],
    courses: [],
    placements: [],
    exceptions: [],
  };
  check(
    "...so the app would send the user into setup rather than to the grid",
    fresh.settings.onboardingCompleted === false,
    "onboardingCompleted already true on a fresh install",
  );

  const file = parseTemeloFile(text);
  const result = await importTimetableSnapshot(db, fresh, file.file.timetable, LATER);

  equal("importing from the setup screen makes it the active timetable", result.destination, "active");
  equal("...under the name in the file", result.state.timetable.name, "Computer Science");
  check(
    "...and completes onboarding in the same transaction",
    result.state.settings.onboardingCompleted,
    "onboardingCompleted is still false, so the next launch would return to setup",
  );
  equal("nothing was archived", await countArchivedTimetables(db), 0);
  equal("the timetable is domain-equivalent to the file", domainPrint(snapshotOf(result.state)), domainPrint(file.file.timetable));

  const shared = [...idsOf(snapshotOf(result.state))].filter((id) => idsOf(file.file.timetable).has(id));
  equal("it still got fresh ids, exactly as any other import does", shared.length, 0, shared.join(", "));

  // The app's own preferences are the defaults rather than anything the file
  // had an opinion about — a fresh install has never been configured, and a
  // stranger's file must not be what configures it.
  check(
    "the device's own preferences are its defaults, not the file's",
    result.state.settings.appearancePreference === DEFAULT_SETTINGS.appearancePreference &&
      result.state.settings.languagePreference === DEFAULT_SETTINGS.languagePreference &&
      result.state.settings.defaultReminderMinutes === DEFAULT_SETTINGS.defaultReminderMinutes &&
      result.state.settings.gridOrientation === DEFAULT_SETTINGS.gridOrientation,
    JSON.stringify(result.state.settings),
  );
  // ...but the timetable's own half of settings did come from the file.
  equal("the academic day came from the file", result.state.settings.academicDayStart, "07:30");
  equal("...and so did the days shown", result.state.settings.weekendMode, "saturdaySunday");
  equal("...and the period count", result.state.settings.slotCount, 6);

  db.closeSync();
  const relaunched = await reopen(path);
  equal("the imported timetable survives the first cold reopen", relaunched.state.timetable.name, "Computer Science");
  check(
    "...and the app now routes to the grid rather than back to setup",
    relaunched.state.settings.onboardingCompleted,
    "onboardingCompleted did not persist",
  );
  equal("...with its classes", relaunched.state.placements.length, 6);
  equal("...its periods", relaunched.state.timeSlots.length, 6);
  equal("...and unchanged", domainPrint(snapshotOf(relaunched.state)), domainPrint(file.file.timetable));
  relaunched.db.closeSync();

  /*
   * Cancelling the picker, and choosing a file that is not a Temelo timetable,
   * both have to leave a fresh install exactly as fresh as it was — there is no
   * previous state to fall back on here, so "nothing changed" has to mean the
   * database is still untouched.
   */
  const untouched = nextPath();
  const second = await open(untouched);
  const before = await databasePrint(second.db);
  // Cancelling is not an operation: the screen never calls the import at all.
  equal("cancelling the picker writes nothing", await databasePrint(second.db), before);
  // An invalid file is refused before the import is reached, for the same reason.
  const refused = parseTemeloFile('{"type":"not-temelo"}');
  equal("an invalid file is refused", refused.ok, false);
  equal("...writing nothing", await databasePrint(second.db), before);
  equal("...and the app is still un-set-up", await loadTimetable(second.db), null);
  second.db.closeSync();
}

/* ----------------------- F, G: importing while a timetable is already here */

async function testImportBesideActive(text) {
  section("F. Importing while a timetable is active leaves that timetable alone");

  const { path, db, state } = await buildFixture("Autumn 2026");
  const activePrint = domainPrint(snapshotOf(state));
  const activeId = state.timetable.id;

  const file = parseTemeloFile(text);
  const first = await importTimetableSnapshot(db, state, file.file.timetable, LATER);
  equal("the import went to the archive", first.destination, "archive");
  equal("the active timetable is still the one it was", first.state.timetable.id, activeId);
  equal("...and is unchanged", domainPrint(snapshotOf(first.state)), activePrint);
  equal("there is now one archive", await countArchivedTimetables(db), 1);

  const listed = await listArchivedTimetables(db);
  equal("it is listed under the name in the file", listed[0].name, "Computer Science");
  equal("...with the date it starts", listed[0].contents.startDate, "2026-09-07");
  equal("...and its shape", listed[0].contents.dayStart, "07:30");

  section("G. The same file imported twice is two independent timetables");
  const second = await importTimetableSnapshot(db, first.state, file.file.timetable, LATER);
  equal("the second import also succeeded", second.destination, "archive");
  equal("there are now two archives", await countArchivedTimetables(db), 2);
  check("they were given different ids", first.timetableId !== second.timetableId, "both imports share an id");

  const both = await listArchivedTimetables(db);
  equal("both carry the same name, which is allowed", both[0].name, both[1].name);

  const a = await readArchivedSnapshotRow(db, first.timetableId);
  const b = await readArchivedSnapshotRow(db, second.timetableId);
  equal("the first copy is domain-equivalent to the file", domainPrint(a.snapshot), domainPrint(file.file.timetable));
  equal("the second copy is too", domainPrint(b.snapshot), domainPrint(file.file.timetable));

  const idsA = idsOf(a.snapshot);
  const idsB = idsOf(b.snapshot);
  const overlap = [...idsA].filter((id) => idsB.has(id));
  equal("...and the two copies share no id at all", overlap.length, 0, overlap.join(", "));
  const fromFile = idsOf(file.file.timetable);
  equal("neither copy kept an id from the file", [...idsA, ...idsB].filter((id) => fromFile.has(id)).length, 0);

  section("H. An imported timetable behaves like any other archive");
  const restored = await restoreArchivedTimetable(db, first.state, first.timetableId, LATER);
  check("it restores", restored.ok, JSON.stringify(restored.reason ?? null));
  equal("...becoming the active timetable", restored.state.timetable.id, first.timetableId);
  equal("...domain-equivalent to the file it came from", domainPrint(snapshotOf(restored.state)), domainPrint(file.file.timetable));
  equal("the timetable it replaced was archived rather than lost", await countArchivedTimetables(db), 2);

  const stillThere = await listArchivedTimetables(db);
  check(
    "...including the one the user started with",
    stillThere.some((entry) => entry.id === activeId),
    "the original timetable is not in the archive",
  );

  section("I. Exporting an imported timetable again");
  const again = buildValidatedTemeloFile(snapshotOf(restored.state), LATER);
  check("it exports", again.ok, JSON.stringify(again.failure ?? null));
  const reparsed = parseTemeloFile(again.text);
  check("...to a valid file", reparsed.ok, JSON.stringify(reparsed.failure ?? null));
  equal(
    "...carrying the same timetable it started as",
    domainPrint(reparsed.file.timetable),
    domainPrint(file.file.timetable),
  );
  const idsAgain = idsOf(reparsed.file.timetable);
  equal(
    "...under this device's ids rather than the original file's",
    [...idsAgain].filter((id) => fromFile.has(id)).length,
    0,
  );

  db.closeSync();
  const relaunched = await reopen(path);
  equal("all of it survives a cold reopen", relaunched.state.timetable.id, first.timetableId);
  equal("...with both archives", await countArchivedTimetables(relaunched.db), 2);
  relaunched.db.closeSync();
}

/* ------------------------------------------- J: every way a file is refused */

async function testRefusals(text) {
  section("J. A file that is not a timetable changes nothing at all");

  const good = JSON.parse(text);

  const withSnapshot = (mutate) => {
    const copy = JSON.parse(text);
    mutate(copy.timetable);
    return JSON.stringify(copy);
  };

  const cases = [
    { what: "empty text", kind: "notTemelo", text: "" },
    { what: "not JSON at all", kind: "notTemelo", text: "this is not json {" },
    { what: "truncated JSON", kind: "notTemelo", text: text.slice(0, Math.floor(text.length / 2)) },
    { what: "a JSON array", kind: "notTemelo", text: "[1,2,3]" },
    { what: "a JSON string", kind: "notTemelo", text: '"hello"' },
    { what: "JSON null", kind: "notTemelo", text: "null" },
    { what: "a JPEG renamed .temelo", kind: "notTemelo", text: String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10) + "JFIF" },
    { what: "some other app's JSON", kind: "notTemelo", text: '{"type":"calendar","events":[]}' },
    { what: "no type field", kind: "notTemelo", text: JSON.stringify({ ...good, type: undefined }) },
    { what: "the wrong type", kind: "notTemelo", text: JSON.stringify({ ...good, type: "temelo-settings" }) },
    { what: "a type that is not a string", kind: "notTemelo", text: JSON.stringify({ ...good, type: 1 }) },
    { what: "a future file format", kind: "futureVersion", text: JSON.stringify({ ...good, formatVersion: 2 }) },
    { what: "a far-future file format", kind: "futureVersion", text: JSON.stringify({ ...good, formatVersion: 99 }) },
    {
      what: "a future snapshot format",
      kind: "futureVersion",
      text: withSnapshot((snapshot) => {
        snapshot.formatVersion = SNAPSHOT_FORMAT_VERSION + 1;
      }),
    },
    { what: "no file format version", kind: "damaged", text: JSON.stringify({ ...good, formatVersion: undefined }) },
    { what: "a file version of zero", kind: "damaged", text: JSON.stringify({ ...good, formatVersion: 0 }) },
    { what: "a fractional file version", kind: "damaged", text: JSON.stringify({ ...good, formatVersion: 1.5 }) },
    { what: "no timetable in it", kind: "damaged", text: JSON.stringify({ ...good, timetable: undefined }) },
    { what: "a timetable that is a string", kind: "damaged", text: JSON.stringify({ ...good, timetable: "nope" }) },
    {
      what: "no snapshot format version",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        delete snapshot.formatVersion;
      }),
    },
    {
      what: "no periods",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        delete snapshot.timeSlots;
      }),
    },
    {
      what: "a period count that disagrees with the periods",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.settings.slotCount = 99;
      }),
    },
    {
      what: "a class pointing at a course that is not there",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.placements[0].courseId = "a-course-from-somewhere-else";
      }),
    },
    {
      what: "an exception pointing at a class that is not there",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.exceptions[0].placementId = "a-class-from-somewhere-else";
      }),
    },
    {
      what: "two courses sharing an id",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.courses[1].id = snapshot.courses[0].id;
      }),
    },
    {
      what: "two classes sharing an id",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.placements[1].id = snapshot.placements[0].id;
      }),
    },
    {
      what: "two periods sharing an id",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.timeSlots[1].id = snapshot.timeSlots[0].id;
      }),
    },
    {
      what: "two periods sharing a position",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.timeSlots[1].position = snapshot.timeSlots[0].position;
      }),
    },
    {
      what: "a start date that is not a date",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.timetable.anchorDate = "the first of never";
      }),
    },
    {
      what: "a period time that is not a time",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.timeSlots[0].startTime = "25:99";
      }),
    },
    {
      what: "a recurrence this build has never heard of",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.placements[0].recurrenceType = "every third tuesday";
      }),
    },
    {
      what: "a weekday that is not a weekday",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.placements[0].weekday = "someday";
      }),
    },
    {
      what: "days-shown this build has never heard of",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.settings.weekendMode = "thursdays off";
      }),
    },
    {
      what: "a class that ends before it starts",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        snapshot.placements[0].endsOn = "2020-01-01";
      }),
    },
    {
      what: "a timetable with no name",
      kind: "damaged",
      text: withSnapshot((snapshot) => {
        delete snapshot.timetable.name;
      }),
    },
    { what: "text past the length limit", kind: "tooLarge", text: `{"x":"${"y".repeat(MAX_TEMELO_FILE_LENGTH)}"}` },
    {
      what: "more records than a timetable can have",
      kind: "tooLarge",
      text: withSnapshot((snapshot) => {
        snapshot.courses = Array.from({ length: MAX_TEMELO_FILE_RECORDS + 1 }, (_, index) => ({
          ...snapshot.courses[0],
          id: `flood-${index}`,
        }));
      }),
    },
  ];

  // One database, one fingerprint, every bad file thrown at it in turn — an
  // import that wrote anything for any of them would show up as a difference.
  const { path, db, state } = await buildFixture("Autumn 2026");
  const before = await databasePrint(db);

  for (const testCase of cases) {
    const parsed = parseTemeloFile(testCase.text);
    equal(`${testCase.what}: refused`, parsed.ok, false);
    if (!parsed.ok) equal(`${testCase.what}: ...as ${testCase.kind}`, parsed.failure.kind, testCase.kind);
    check(
      `${testCase.what}: nothing was written`,
      (await databasePrint(db)) === before,
      "the database changed",
    );
  }

  check(
    "the timetable is still there after all of them",
    domainPrint(snapshotOf(await loadTimetable(db))) === domainPrint(snapshotOf(state)),
    "the timetable changed",
  );

  db.closeSync();
  const relaunched = await reopen(path);
  equal("...and after a cold reopen", (await databasePrint(relaunched.db)), before);
  relaunched.db.closeSync();
}

/* --------------------------------- K: a failure part-way through an import */

async function testForcedImportFailure(text) {
  section("K. A forced failure during an import leaves everything as it was");

  const file = parseTemeloFile(text);

  // With a timetable active, the import is one INSERT into the archive.
  {
    const { path, db, state } = await buildFixture("Autumn 2026");
    const before = await databasePrint(db);

    db.failPattern = "INSERT INTO archived_timetables";
    let threw = null;
    try {
      await importTimetableSnapshot(db, state, file.file.timetable, LATER);
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error);
    }
    check("the failure propagated", threw !== null, "the import reported success");
    check("the error names the injected cause", (threw ?? "").includes("injected failure"), threw);
    check("the connection is out of its transaction", !db.isInTransactionSync(), "still in a transaction");
    equal("nothing was written", await databasePrint(db), before);
    db.closeSync();

    const relaunched = await reopen(path);
    equal("...and nothing appears after a cold reopen", await databasePrint(relaunched.db), before);
    equal("no half-imported archive was left behind", await countArchivedTimetables(relaunched.db), 0);
    equal("the current timetable is untouched", relaunched.state.timetable.id, state.timetable.id);
    relaunched.db.closeSync();
  }

  // With none active, the import writes the working tables — the path with
  // something to half-do.
  for (const pattern of ["INSERT INTO courses", "INSERT INTO placements", "INSERT INTO occurrence_exceptions"]) {
    const path = nextPath();
    const { db } = await open(path);
    await saveTimetable(db, EMPTY_STATE, null);
    const before = await databasePrint(db);

    db.failPattern = pattern;
    let threw = null;
    try {
      await importTimetableSnapshot(db, await loadTimetable(db), file.file.timetable, LATER);
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error);
    }
    check(`failing at ${pattern}: the failure propagated`, threw !== null, "the import reported success");
    equal(`failing at ${pattern}: nothing was written`, await databasePrint(db), before);
    db.closeSync();

    const relaunched = await reopen(path);
    equal(`failing at ${pattern}: there is still no timetable`, relaunched.state.timetable, null);
    equal(`failing at ${pattern}: and no partial one`, relaunched.state.placements.length, 0);
    equal(`failing at ${pattern}: ...no courses either`, relaunched.state.courses.length, 0);
    equal(`failing at ${pattern}: ...and no periods`, relaunched.state.timeSlots.length, 0);
    relaunched.db.closeSync();
  }
}

/* -------------------------------------------------- L: the reminder ledger */

async function testReminderLedgerStaysHome(text) {
  section("L. Reminder history and notification identity never travel");

  const { db, state } = await buildFixture("Autumn 2026");
  const placementId = state.placements[0].id;

  // What the ledger really holds: a key derived from a placement id and an
  // occurrence date, which is exactly the identity an imported copy must not
  // inherit.
  const ledgerRows = [
    [`${placementId}|2026-09-14|reminder`, 1_757_000_000_000, 1_757_003_600_000, "scheduled"],
    [`${placementId}|2026-09-21|reminder`, 1_757_600_000_000, 1_757_603_600_000, "handled"],
  ];
  for (const [key, remindAt, startAt, deliveryState] of ledgerRows) {
    await db.runAsync(
      `INSERT INTO reminder_deliveries (reminder_key, remind_at, start_at, state, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      key,
      remindAt,
      startAt,
      deliveryState,
      NOW,
    );
  }

  const exported = buildValidatedTemeloFile(snapshotOf(await loadTimetable(db)), NOW);
  check("the timetable still exports", exported.ok, JSON.stringify(exported.failure ?? null));
  for (const [key] of ledgerRows) {
    check(`the file does not carry the ledger entry for ${key.slice(-21)}`, !exported.text.includes(key), "it does");
  }
  check("the file names no delivery state", !exported.text.includes('"scheduled"'), "it does");
  check("the file names no reminder table", !exported.text.includes("reminder_deliveries"), "it does");
  check("the file names no notification identifier", !exported.text.includes("notificationId"), "it does");

  // ...but the *settings* do travel, because those are the user's choice about
  // the class rather than a record of what the OS was told.
  const snapshot = parseTemeloFile(exported.text).file.timetable;
  const leadTimes = snapshot.placements.map((entry) => entry.reminderMinutes);
  check("per-class reminder lead times do travel", leadTimes.includes(30) && leadTimes.includes(60), JSON.stringify(leadTimes));
  const overrides = snapshot.exceptions.map((entry) => entry.reminderMinutes);
  check(
    "...and so do per-occurrence overrides, including 'none'",
    overrides.includes(10) && overrides.includes("none"),
    JSON.stringify(overrides),
  );

  const ledgerBefore = JSON.stringify(await db.getAllAsync("SELECT * FROM reminder_deliveries ORDER BY reminder_key"));
  const imported = await importTimetableSnapshot(db, await loadTimetable(db), snapshot, LATER);
  equal("the import landed in the archive", imported.destination, "archive");
  equal(
    "the reminder ledger is exactly as it was",
    JSON.stringify(await db.getAllAsync("SELECT * FROM reminder_deliveries ORDER BY reminder_key")),
    ledgerBefore,
  );

  // The clincher: the imported copy's placement ids are new, so not one of its
  // occurrences can collide with a ledger entry the original left behind.
  const copy = await readArchivedSnapshotRow(db, imported.timetableId);
  const keys = (await db.getAllAsync("SELECT reminder_key FROM reminder_deliveries")).map((row) => row.reminder_key);
  check(
    "no imported class can inherit a scheduled reminder's identity",
    copy.snapshot.placements.every((entry) => !keys.some((key) => key.startsWith(`${entry.id}|`))),
    "an imported class shares a reminder key with the original",
  );

  db.closeSync();
}

/* ------------------------------------------------------- M: cloning itself */

function testCloning(snapshot) {
  section("M. Re-identifying a snapshot, as a value");

  let counter = 0;
  const clone = cloneSnapshotWithFreshIds(snapshot, LATER, () => `fresh-${counter++}`);

  equal("the clone is domain-equivalent to what it was cloned from", domainPrint(clone), domainPrint(snapshot));
  equal("it is written in this build's snapshot format", clone.formatVersion, SNAPSHOT_FORMAT_VERSION);
  equal("its updatedAt records that the copy is new", clone.timetable.updatedAt, LATER);
  equal("its createdAt is the original's, which is the user's history", clone.timetable.createdAt, snapshot.timetable.createdAt);

  const before = idsOf(snapshot);
  const after = idsOf(clone);
  equal("no original id survived", [...after].filter((id) => before.has(id)).length, 0);
  equal("every id was minted exactly once", after.size, before.size);
  check("every minted id came from the generator", [...after].every((id) => id.startsWith("fresh-")), "one did not");

  // The dangling period reference is the case a prebuilt lookup table would
  // have no entry for; it has to be remapped consistently, not passed through.
  const orphan = snapshot.placements.find((entry) => entry.deletedAt !== null);
  const clonedOrphan = clone.placements.find((entry) => entry.deletedAt !== null);
  check(
    "a reference to a period outside the snapshot is still replaced",
    clonedOrphan.timeSlotId !== orphan.timeSlotId,
    "a foreign id was passed through",
  );
  check(
    "...and does not accidentally become a real period",
    !clone.timeSlots.some((slot) => slot.id === clonedOrphan.timeSlotId),
    "it now points at a real period it never pointed at",
  );

  // Cloning twice must be two different copies, or importing the same file
  // twice would collide with itself.
  const second = cloneSnapshotWithFreshIds(snapshot, LATER);
  const third = cloneSnapshotWithFreshIds(snapshot, LATER);
  const overlap = [...idsOf(second)].filter((id) => idsOf(third).has(id));
  equal("two clones of the same snapshot share no id", overlap.length, 0, overlap.join(", "));

  // The same id used in two roles must land on one new id, or the split series
  // would stop sharing a course.
  const physics = snapshot.courses.find((entry) => entry.name === "Physics");
  const halves = snapshot.placements.filter((entry) => entry.courseId === physics.id);
  const clonedHalves = clone.placements.filter((_, index) => halves.includes(snapshot.placements[index]));
  equal("a course used by two classes is remapped to one id", new Set(clonedHalves.map((e) => e.courseId)).size, 1);

  section("M2. A clone is still a file this build accepts");
  const built = buildValidatedTemeloFile(clone, LATER);
  check("it exports", built.ok, JSON.stringify(built.failure ?? null));
  equal("...and reads back unchanged", domainPrint(parseTemeloFile(built.text).file.timetable), domainPrint(clone));
}

/* -------------------------------------------------- N: an older archive travels */

async function testLegacyArchiveExports() {
  section("N. An archive written before this branch still exports");

  const { db, state } = await buildFixture("Autumn 2026");

  /*
   * A snapshot as an earlier build wrote it: no `startsWithTimetable` on any
   * placement, because the field did not exist. The snapshot layer infers it
   * on the way back in, and the point here is that a file written from such an
   * archive is a *current* file — the value is upgraded at the snapshot layer
   * rather than the old JSON being edited in the archive column.
   */
  const legacy = JSON.parse(serializeTimetableSnapshot(snapshotOf(state)));
  for (const entry of legacy.placements) delete entry.startsWithTimetable;

  await db.runAsync(
    `INSERT INTO archived_timetables (id, name, archived_at, created_at, format_version, snapshot)
     VALUES (?, ?, ?, ?, ?, ?)`,
    "legacy-archive",
    "Last year",
    NOW,
    NOW,
    1,
    JSON.stringify(legacy),
  );

  const read = await readArchivedSnapshotRow(db, "legacy-archive");
  check("it reads back", read.ok, JSON.stringify(read.reason ?? null));
  const built = buildValidatedTemeloFile(read.snapshot, NOW);
  check("...and exports", built.ok, JSON.stringify(built.failure ?? null));

  const parsed = parseTemeloFile(built.text);
  check("the file it produced is a current one", parsed.ok, JSON.stringify(parsed.failure ?? null));
  equal("...in this build's snapshot format", parsed.file.timetable.formatVersion, SNAPSHOT_FORMAT_VERSION);
  check(
    "every class in it now says whether it starts with the timetable",
    parsed.file.timetable.placements.every((entry) => typeof entry.startsWithTimetable === "boolean"),
    "one does not",
  );
  const split = parsed.file.timetable.placements.find((entry) => entry.startsOn === "2026-10-22");
  equal("...and the split's later half was inferred correctly", split.startsWithTimetable, false);

  const imported = await importTimetableSnapshot(db, await loadTimetable(db), parsed.file.timetable, LATER);
  equal("it imports", imported.destination, "archive");
  const copy = await readArchivedSnapshotRow(db, imported.timetableId);
  equal("...as a current snapshot", copy.snapshot.formatVersion, SNAPSHOT_FORMAT_VERSION);

  // The original archive's JSON must not have been rewritten to achieve any of
  // that: an old archive is data we are trying hardest not to disturb.
  const stored = await db.getFirstAsync("SELECT snapshot FROM archived_timetables WHERE id = 'legacy-archive'");
  equal("the old archive's own JSON was never touched", stored.snapshot, JSON.stringify(legacy));

  db.closeSync();
}

/* --------------------------------------------------------- O: naming rules */

async function testNames(text) {
  section("O. Imported names are preserved, never made unique");

  const good = JSON.parse(text);

  const named = (name) => {
    const copy = JSON.parse(text);
    copy.timetable.timetable.name = name;
    return parseTemeloFile(JSON.stringify(copy)).file.timetable;
  };

  const { db, state } = await buildFixture("Timetable1");
  equal("the device already has a timetable with a name", state.timetable.name, "Timetable1");

  const collision = await importTimetableSnapshot(db, state, named("Timetable1"), LATER);
  const listed = await listArchivedTimetables(db);
  equal("a friend's timetable with the same name imports", listed.length, 1);
  equal("...under exactly that name", listed[0].name, "Timetable1");
  equal("...and the device's own keeps it too", collision.state.timetable.name, "Timetable1");

  const longName = "A".repeat(200);
  const trimmed = await importTimetableSnapshot(db, collision.state, named(longName), LATER);
  const long = await readArchivedSnapshotRow(db, trimmed.timetableId);
  equal("an over-long name is trimmed to the stored limit", [...long.snapshot.timetable.name].length, 60);

  const unicode = await importTimetableSnapshot(db, collision.state, named("Расписание 🎓"), LATER);
  const kept = await readArchivedSnapshotRow(db, unicode.timetableId);
  equal("a name in another alphabet is kept exactly", kept.snapshot.timetable.name, "Расписание 🎓");

  const padded = await importTimetableSnapshot(db, collision.state, named("   Spaced   "), LATER);
  const tidy = await readArchivedSnapshotRow(db, padded.timetableId);
  equal("surrounding whitespace is trimmed, as it is everywhere else", tidy.snapshot.timetable.name, "Spaced");

  equal("the file itself was never mutated by any of that", JSON.stringify(JSON.parse(text)), JSON.stringify(good));

  db.closeSync();
}

/* -------------------------------------------------------------------- entry */

export async function runTransferHarness() {
  try {
    const { text, snapshot } = await testExport();
    await testExportArchived();
    testRoundTrip(text, snapshot);
    await testImportIntoEmptyApp(text);
    await testImportOnFreshInstall(text);
    await testImportBesideActive(text);
    await testRefusals(text);
    await testForcedImportFailure(text);
    await testReminderLedgerStaysHome(text);
    testCloning(snapshot);
    await testLegacyArchiveExports();
    await testNames(text);
  } finally {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      console.log(`\n(left ${directory} behind; the platform still had it open)`);
    }
  }
}
