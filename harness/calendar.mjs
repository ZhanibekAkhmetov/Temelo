/**
 * Calendar export harness.
 *
 * Two questions, and the second is the one that matters.
 *
 * The first is whether the file is a valid `.ics` — CRLF, escaping, folding at
 * 75 *octets* without splitting a character, floating local times, a UTC
 * `DTSTAMP`, stable UIDs, a safe filename. Those are checks against RFC 5545,
 * and they are written out literally rather than through a library, because a
 * library that agreed with the same misunderstanding would prove nothing.
 *
 * The second is whether the exported calendar says the same thing the app does.
 * That is what suite H is for, and it is deliberately not written as "a weekly
 * class should appear every week": that would be a second, hand-coded model of
 * recurrence, and if it disagreed with Temelo the test would be asserting the
 * wrong answer confidently. Instead it asks `resolveOccurrences` — the function
 * the grid itself draws from — for every date in the range, and asserts the
 * exporter's events are exactly that set, matched on date, time and class. A
 * change to recurrence that broke the export would fail here; a change that
 * legitimately altered recurrence moves both sides together, which is correct,
 * because agreement is the property under test.
 *
 * The fixture is the awkward one from the transfer harness, for the same
 * reason: a split series whose halves must not overlap, a biweekly class whose
 * parity must survive, a one-off, a moved occurrence, a cancelled one, and a
 * soft-deleted class pointing at a period that no longer exists. Five plain
 * weekly classes would pass all of this while proving nothing.
 *
 * Run it with `node harness/run.mjs`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_CALENDAR_EXPORT_DAYS,
  calendarExportRangeDays,
  calendarOccurrencesIn,
  defaultCalendarExportRange,
  validateCalendarExportRange,
} from "@/domain/calendarExport";
import { addDaysIso } from "@/domain/date";
import { createId } from "@/domain/id";
import { resolveOccurrences } from "@/domain/occurrence";
import { OPEN_ENDED_DATE } from "@/domain/recurrence";
import { generateTimeSlots } from "@/domain/time";
import { occupiedSlotIds } from "@/domain/timetable";
import {
  CALENDAR_FILE_MIME_TYPE,
  CALENDAR_FILE_UTI,
  ICS_PRODUCT_ID,
  buildIcsCalendar,
  calendarFileName,
  escapeIcsText,
  foldIcsLine,
  icsFloatingDateTime,
  icsUid,
  icsUtcTimestamp,
} from "@/storage/calendarFile";
import { openTemeloDatabase } from "@/storage/database";
import { buildTimetableSnapshot, timetableSettingsOf } from "@/storage/snapshot";
import { archiveActiveTimetable, createTimetable, readArchivedSnapshotRow } from "@/storage/timetableLifecycle";
import { loadTimetable, saveTimetable } from "@/storage/timetableRepository";
import { check, equal, section } from "./report.mjs";
import { useDatabaseFile } from "./sqlite-stub.mjs";

const directory = mkdtempSync(join(tmpdir(), "temelo-calendar-"));
let databaseIndex = 0;

function nextPath() {
  return join(directory, `temelo-${databaseIndex++}.db`);
}

async function open(path) {
  useDatabaseFile(path);
  return openTemeloDatabase();
}

const NOW = "2026-09-12T09:00:00.000Z";
const LATER = "2026-09-12T10:30:00.000Z";
const ANCHOR = "2026-09-07";

/** The words the app would supply; the domain never invents them itself. */
const TEXT = { teacher: (name) => `Teacher: ${name}` };

/* ----------------------------------------------------------------- fixtures */

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

function newTimetableInput(name) {
  const settings = {
    weekendMode: "saturdaySunday",
    academicDayStart: "07:30",
    defaultLessonDurationMinutes: 45,
    defaultBreakDurationMinutes: 10,
    slotCount: 6,
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
    anchorDate: ANCHOR,
    now: NOW,
  };
}

function course(id, name, extra = {}) {
  return {
    id,
    name,
    room: extra.room ?? "",
    teacher: extra.teacher ?? "",
    notes: extra.notes ?? "",
    appearanceId: extra.appearanceId ?? "blue",
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
 * A database holding one awkward but entirely legitimate timetable, built
 * through the real creation and save paths so its contents are what a device's
 * contents would be.
 */
async function buildFixture(name = "Autumn 2026") {
  const path = nextPath();
  const { db } = await open(path);

  const created = await createTimetable(db, EMPTY_STATE, newTimetableInput(name));
  if (!created.ok) throw new Error("fixture timetable was not created");
  const base = created.state;
  const slot = (position) => base.timeSlots.find((entry) => entry.position === position).id;

  const courses = [
    // Commas, a semicolon, a backslash and a newline, all in fields that are
    // written into the file as TEXT.
    course("c-maths", "Maths, Set 1; Advanced", { room: "101", teacher: "Ivanova", notes: "bring a\\ruler\nand a pen" }),
    course("c-history", "History", { room: "204" }),
    course("c-trip", "Museum trip", {}),
    course("c-physics", "Physics", { room: "Lab A", notes: "goggles" }),
    course("c-gone", "Old elective", { deletedAt: NOW }),
  ];

  const placements = [
    // Ordinary weekly, open-ended, reaching back as far as the timetable does.
    placement("p-maths", "c-maths", { weekday: "monday", timeSlotId: slot(3), startsOn: ANCHOR }),
    // Every two weeks, anchored a week after the timetable starts.
    placement("p-history", "c-history", {
      weekday: "tuesday",
      timeSlotId: slot(2),
      slotSpan: 2,
      recurrenceType: "biweekly",
      startsOn: "2026-09-15",
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
      startsOn: ANCHOR,
      endsOn: "2026-10-21",
      updatedAt: LATER,
    }),
    // ...and its later half, which begins on the split and must never leak back.
    placement("p-physics-new", "c-physics", {
      weekday: "thursday",
      timeSlotId: slot(4),
      startsOn: "2026-10-22",
      startsWithTimetable: false,
      createdAt: LATER,
      updatedAt: LATER,
    }),
    // Soft-deleted, pointing at a period this timetable does not have.
    placement("p-gone", "c-gone", {
      weekday: "wednesday",
      timeSlotId: "slot-from-a-previous-academic-day",
      startsOn: ANCHOR,
      deletedAt: NOW,
    }),
  ];

  const exceptions = [
    // Moved to the next day, into a different period, under a different name.
    exception("x-maths-moved", "p-maths", {
      originalDate: "2026-09-21",
      effectiveDate: "2026-09-22",
      state: "modified",
      timeSlotId: slot(4),
      name: "Maths (test)",
      room: "Hall",
    }),
    // Deleted outright: no event at all.
    exception("x-history-cancelled", "p-history", { originalDate: "2026-10-13", state: "cancelled" }),
  ];

  const next = { ...base, courses, placements, exceptions };
  await saveTimetable(db, next, base);
  const state = await loadTimetable(db);
  return { path, db, state, snapshot: snapshotOf(state) };
}

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

/* ------------------------------------------------------------------ helpers */

/** The file's lines, as the RFC defines them: split on CRLF, trailing one gone. */
function linesOf(text) {
  const lines = text.split("\r\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Lines with folds undone — a continuation line's leading space removed. */
function unfold(text) {
  const out = [];
  for (const line of linesOf(text)) {
    if (line.startsWith(" ") && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/** Each VEVENT as a map of property name to raw value. */
function eventsOf(text) {
  const events = [];
  let current = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    current[line.slice(0, colon)] = line.slice(colon + 1);
  }
  return events;
}

function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

const RANGE = { from: "2026-09-07", to: "2026-12-20" };

/* ----------------------------------------------- A: the calendar's envelope */

function testEnvelope(text) {
  section("A. The file is an iCalendar object");

  const lines = linesOf(text);
  equal("it opens with BEGIN:VCALENDAR", lines[0], "BEGIN:VCALENDAR");
  equal("it declares the version", lines[1], "VERSION:2.0");
  equal("it names the product that wrote it", lines[2], `PRODID:${ICS_PRODUCT_ID}`);
  equal("it declares the calendar scale", lines[3], "CALSCALE:GREGORIAN");
  equal("it is a publication, not an invitation", lines[4], "METHOD:PUBLISH");
  equal("it closes with END:VCALENDAR", lines[lines.length - 1], "END:VCALENDAR");

  check("it names the calendar after the timetable", unfold(text).includes("X-WR-CALNAME:Autumn 2026"));

  equal(
    "every BEGIN:VEVENT is matched by an END:VEVENT",
    lines.filter((line) => line === "BEGIN:VEVENT").length,
    lines.filter((line) => line === "END:VEVENT").length,
  );

  // The whole point of CRLF: a bare LF anywhere would be a line ending some
  // parsers accept and others silently truncate at.
  check("every line ends with CRLF", !/[^\r]\n/.test(text), "a bare LF is present");
  equal("including the last one", text.endsWith("\r\n"), true);

  // No alarms, ever: Temelo has its own reminders and must not quietly add a
  // second set from whatever calendar app the file lands in.
  check("no event carries a VALARM", !text.includes("BEGIN:VALARM"));

  const events = eventsOf(text);
  check("every event has the five required properties", events.length > 0 && events.every((event) =>
    ["UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY"].every((key) => typeof event[key] === "string"),
  ));

  equal("the MIME type is the registered one", CALENDAR_FILE_MIME_TYPE, "text/calendar");
  equal("and the iOS type identifier is too", CALENDAR_FILE_UTI, "com.apple.ical.ics");
}

/* -------------------------------------------------------------- B: escaping */

function testEscaping(text) {
  section("B. RFC 5545 TEXT escaping");

  equal("a backslash doubles", escapeIcsText("a\\b"), "a\\\\b");
  equal("a comma is escaped", escapeIcsText("a,b"), "a\\,b");
  equal("a semicolon is escaped", escapeIcsText("a;b"), "a\\;b");
  equal("a newline becomes the two-character escape", escapeIcsText("a\nb"), "a\\nb");
  equal("a CRLF becomes one escape, not two", escapeIcsText("a\r\nb"), "a\\nb");
  equal("a colon is left alone", escapeIcsText("Room A:1"), "Room A:1");
  equal("all four at once, backslash first", escapeIcsText("\\,;\n"), "\\\\\\,\\;\\n");
  equal("a control character is dropped", escapeIcsText("a\u0000\u000bb"), "ab");
  equal("a tab survives, being the one the grammar allows", escapeIcsText("a\tb"), "a\tb");
  equal("ordinary text is untouched", escapeIcsText("Mathematics"), "Mathematics");

  // And in the file itself, on the fixture's deliberately awkward course.
  const summaries = eventsOf(text).map((event) => event.SUMMARY);
  check(
    "the fixture's comma and semicolon are escaped in SUMMARY",
    summaries.includes("Maths\\, Set 1\\; Advanced"),
    JSON.stringify(summaries.slice(0, 4)),
  );
  const descriptions = eventsOf(text).map((event) => event.DESCRIPTION);
  check(
    "a backslash and a newline are escaped in DESCRIPTION",
    descriptions.some((value) => value === "Teacher: Ivanova\\nbring a\\\\ruler\\nand a pen"),
    JSON.stringify(descriptions.find((value) => value && value.includes("ruler")) ?? null),
  );
}

/* --------------------------------------------------------------- C: folding */

function testFolding(text) {
  section("C. Folding at 75 octets, without splitting a character");

  equal("a short line is not folded", foldIcsLine("SUMMARY:Maths"), "SUMMARY:Maths");

  const exactly75 = "A".repeat(75);
  equal("a line of exactly 75 octets is not folded", foldIcsLine(exactly75), exactly75);
  equal("76 octets folds into two", foldIcsLine("A".repeat(76)), `${"A".repeat(75)}\r\n A`);

  // The case a naive `slice(0, 75)` gets wrong: 75 JavaScript characters of
  // Cyrillic is 150 bytes, over the limit twice over.
  const cyrillic = foldIcsLine("Я".repeat(80));
  check(
    "a Cyrillic line folds by bytes, not by characters",
    linesOf(cyrillic).every((line) => utf8Bytes(line) <= 75),
    linesOf(cyrillic).map(utf8Bytes).join(", "),
  );

  // The case that produces invalid UTF-8: a 4-byte code point straddling the
  // boundary. Splitting it would leave a lone surrogate.
  const emojiSource = `${"A".repeat(73)}${"🎓".repeat(4)}`;
  const emoji = foldIcsLine(emojiSource);
  const emojiLines = linesOf(emoji);
  check("an emoji line stays inside 75 octets", emojiLines.every((line) => utf8Bytes(line) <= 75));
  check("...and it did have to fold, so the boundary was exercised", emojiLines.length > 1);
  equal("unfolding gives back every code point intact", unfold(`${emoji}\r\n`)[0], emojiSource);
  check("no lone surrogate survives folding", !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji));

  // Continuation lines begin with exactly one space, which is the fold marker
  // and is removed on unfolding rather than being part of the value.
  const folded = foldIcsLine(`DESCRIPTION:${"x".repeat(200)}`);
  const parts = linesOf(folded);
  check("every continuation line begins with one space", parts.slice(1).every((line) => line.startsWith(" ")));
  equal("unfolding restores the original line", unfold(`${folded}\r\n`)[0], `DESCRIPTION:${"x".repeat(200)}`);

  // ...and the whole real file obeys it.
  check(
    "every line in the exported file is within 75 octets",
    linesOf(text).every((line) => utf8Bytes(line) <= 75),
    linesOf(text).filter((line) => utf8Bytes(line) > 75).join(" | "),
  );
}

/* ----------------------------------------------------- D: dates, times, UID */

function testDateTimes(text) {
  section("D. Floating local times, a UTC stamp, and stable UIDs");

  equal("a date and time become a floating date-time", icsFloatingDateTime("2026-09-14", "09:00"), "20260914T090000");
  equal("midnight formats correctly", icsFloatingDateTime("2027-01-01", "00:05"), "20270101T000500");

  const events = eventsOf(text);
  check(
    "no DTSTART carries a Z, which would claim the time is UTC",
    events.every((event) => !event.DTSTART.endsWith("Z")),
  );
  check("nor a TZID, which would claim a zone Temelo does not store", !text.includes("TZID"));
  check(
    "every DTSTART and DTEND is a bare local date-time",
    events.every((event) => /^\d{8}T\d{6}$/.test(event.DTSTART) && /^\d{8}T\d{6}$/.test(event.DTEND)),
  );
  check("every event ends after it starts", events.every((event) => event.DTEND > event.DTSTART));

  equal("DTSTAMP is UTC with a Z", icsUtcTimestamp("2026-09-14T07:15:00.000Z"), "20260914T071500Z");
  check(
    "and every event carries it",
    events.every((event) => /^\d{8}T\d{6}Z$/.test(event.DTSTAMP)),
  );

  equal("a UID is the occurrence's identity plus a domain", icsUid("p-maths", "2026-09-14"), "p-maths-2026-09-14@temelo.app");
  check(
    "an id that could inject a line is neutralised",
    !icsUid("p\r\nSUMMARY:x", "2026-09-14").includes("\r"),
    icsUid("p\r\nSUMMARY:x", "2026-09-14"),
  );

  const uids = events.map((event) => event.UID);
  equal("every event in a file has a distinct UID", new Set(uids).size, uids.length);
}

/* ------------------------------------------------------------- E: filenames */

function testFileNames() {
  section("E. Filenames");

  equal(
    "an ordinary name reads as a document",
    calendarFileName("Autumn 2026", "2026-09-14", "2027-03-14"),
    "Temelo - Autumn 2026 - 2026-09-14 to 2027-03-14.ics",
  );
  equal(
    "a slash cannot become a path",
    calendarFileName("2026/27", "2026-09-14", "2027-03-14"),
    "Temelo - 2026 27 - 2026-09-14 to 2027-03-14.ics",
  );
  equal(
    "nor can a traversal",
    calendarFileName("../../etc", "2026-09-14", "2027-03-14"),
    "Temelo - etc - 2026-09-14 to 2027-03-14.ics",
  );
  equal(
    "a nameless timetable still produces a usable filename",
    calendarFileName("   ", "2026-09-14", "2027-03-14"),
    "Temelo - 2026-09-14 to 2027-03-14.ics",
  );
  equal(
    "a Cyrillic name survives",
    calendarFileName("Расписание", "2026-09-14", "2027-03-14"),
    "Temelo - Расписание - 2026-09-14 to 2027-03-14.ics",
  );
  check(
    "a very long name is cut to something a filesystem accepts",
    calendarFileName("x".repeat(400), "2026-09-14", "2027-03-14").length < 100,
  );
}

/* ---------------------------------------------------- F: the range's rules */

function testRange() {
  section("F. Range defaults and validation");

  const active = defaultCalendarExportRange({ anchorDate: "2026-09-07", today: "2026-09-14" });
  equal("an active timetable starts from today", active.from, "2026-09-14");
  equal("...and runs six calendar months", active.to, "2027-03-14");

  const notStarted = defaultCalendarExportRange({ anchorDate: "2026-10-01", today: "2026-09-14" });
  equal("a timetable that has not started yet begins where it does", notStarted.from, "2026-10-01");

  const archive = defaultCalendarExportRange({ anchorDate: "2024-09-02", today: null });
  equal("an archive starts at its own start date, not today", archive.from, "2024-09-02");
  equal("...and also runs six months", archive.to, "2025-03-02");

  const endOfMonth = defaultCalendarExportRange({ anchorDate: "2026-08-31", today: null });
  equal("a day-of-month that the target month lacks is clamped", endOfMonth.to, "2027-02-28");

  check(
    "the suggested range is always one the validator accepts",
    [active, notStarted, archive, endOfMonth].every((range) => validateCalendarExportRange(range) === null),
  );
  check(
    "and always inside the maximum",
    [active, notStarted, archive, endOfMonth].every((range) => calendarExportRangeDays(range) <= MAX_CALENDAR_EXPORT_DAYS),
  );

  equal("a single day is a valid range", validateCalendarExportRange({ from: "2026-09-14", to: "2026-09-14" }), null);
  equal(
    "an end before the start is refused",
    validateCalendarExportRange({ from: "2026-09-14", to: "2026-09-13" })?.key,
    "errors.calendarRangeInvalid",
  );
  equal(
    "exactly the maximum is allowed",
    validateCalendarExportRange({ from: "2026-01-01", to: addDaysIso("2026-01-01", MAX_CALENDAR_EXPORT_DAYS - 1) }),
    null,
  );
  equal(
    "one day more is refused",
    validateCalendarExportRange({ from: "2026-01-01", to: addDaysIso("2026-01-01", MAX_CALENDAR_EXPORT_DAYS) })?.key,
    "errors.calendarRangeTooLong",
  );

  // A range starting before the timetable is deliberately *not* an error: the
  // resolver returns nothing there, so the export is simply shorter.
  equal(
    "a range reaching back before the timetable is not refused",
    validateCalendarExportRange({ from: "2020-01-01", to: "2020-06-01" }),
    null,
  );
}

/* --------------------------------------------- G: what the occurrences are */

function testOccurrenceSemantics(snapshot) {
  section("G. Weekly, alternating, one-off, moved, deleted and split");

  const events = calendarOccurrencesIn(snapshot, RANGE, TEXT);
  const named = (name) => events.filter((event) => event.summary === name).map((event) => event.date);

  // Weekly: every Monday from the timetable's start.
  const maths = named("Maths, Set 1; Advanced");
  check("a weekly class meets every week", maths.includes("2026-09-07") && maths.includes("2026-09-14"));
  check("...reaching back to the timetable's own start", maths[0] === "2026-09-07", maths[0]);

  // Alternating: every other Tuesday from its own anchor, never the weeks between.
  const history = named("History");
  check("an alternating class meets on its own parity", history.includes("2026-09-15") && history.includes("2026-09-29"));
  check("...and not on the weeks between", !history.includes("2026-09-22") && !history.includes("2026-10-06"));

  // A one-off is exactly one event.
  equal("a one-off produces exactly one event", named("Museum trip").length, 1);
  equal("...on its own date", named("Museum trip")[0], "2026-10-16");

  // A cancelled occurrence produces nothing at all.
  check("a deleted occurrence produces no event", !history.includes("2026-10-13"));

  // A moved occurrence appears once, at the date and time it moved to.
  const moved = events.filter((event) => event.summary === "Maths (test)");
  equal("a moved occurrence produces exactly one event", moved.length, 1);
  equal("...on the date it moved to", moved[0].date, "2026-09-22");
  check("...and not on the date it came from", !maths.includes("2026-09-21"));
  equal("...carrying its overridden room", moved[0].location, "Hall");
  equal("...and its overridden period's time", moved[0].startTime, "10:15");
  check(
    "the occurrence it replaced is not also exported",
    events.filter((event) => event.date === "2026-09-21").every((event) => event.summary !== "Maths, Set 1; Advanced"),
  );

  // A split series: the two halves must partition the weeks, never overlap.
  const physics = named("Physics").sort();
  check("the earlier half of a split runs up to the split", physics.includes("2026-10-15"));
  check("the later half runs from the split", physics.includes("2026-10-22"));
  equal("and no Thursday is covered twice", new Set(physics).size, physics.length);
  check(
    "the later half never leaks back before the split",
    events.filter((event) => event.summary === "Physics" && event.date < "2026-10-22").every((event) => event.startTime === "07:30"),
  );

  // A soft-deleted class is gone, and so is its course.
  check("a soft-deleted class produces no events", named("Old elective").length === 0);

  // Nothing before the timetable's start, ever.
  const early = calendarOccurrencesIn(snapshot, { from: "2026-08-01", to: "2026-09-06" }, TEXT);
  equal("nothing at all is exported before the timetable starts", early.length, 0);

  // A multi-period class ends when its last period does.
  const twoPeriods = events.find((event) => event.summary === "History");
  equal("a class spanning two periods starts at the first", twoPeriods.startTime, "08:25");
  equal("...and ends at the end of the second", twoPeriods.endTime, "10:05");

  // Fields that are empty stay empty rather than becoming blank properties.
  const trip = events.find((event) => event.summary === "Museum trip");
  equal("a class with no room has no location", trip.location, "");
  equal("a class with no teacher or notes has no description", trip.description, "");
}

/* ------------------------------------------------------------ H: agreement */

/**
 * The set of occurrences the app would draw, built from the resolver itself.
 *
 * Deliberately *not* a second recurrence model: it calls the same
 * `resolveOccurrences` the grid does, over the same dates, and reduces the
 * result to the same shape the exporter produces. What is being compared is
 * therefore the exporter's mapping, not recurrence — which is the only thing
 * the export layer is allowed to have an opinion about.
 */
function resolverPrint(snapshot, range) {
  const ordered = [...snapshot.timeSlots].sort((a, b) => a.position - b.position);
  const slotById = new Map(ordered.map((slot) => [slot.id, slot]));

  const dates = [];
  for (let date = range.from; date <= range.to; date = addDaysIso(date, 1)) dates.push(date);

  return resolveOccurrences(
    {
      placements: snapshot.placements,
      courses: snapshot.courses,
      exceptions: snapshot.exceptions,
      timetableStart: snapshot.timetable.anchorDate,
    },
    dates,
  )
    .flatMap((occurrence) => {
      const occupied = occupiedSlotIds(ordered, occurrence.placement.timeSlotId, occurrence.placement.slotSpan);
      if (occupied.length === 0) return [];
      const first = slotById.get(occupied[0]);
      const last = slotById.get(occupied[occupied.length - 1]);
      if (!first || !last) return [];
      return [`${occurrence.date} ${first.startTime}-${last.endTime} ${occurrence.course.name}`];
    })
    .sort();
}

function exportPrint(snapshot, range) {
  return calendarOccurrencesIn(snapshot, range, TEXT)
    .map((event) => `${event.date} ${event.startTime}-${event.endTime} ${event.summary}`)
    .sort();
}

function testAgreesWithTheResolver(snapshot) {
  section("H. The exported calendar says exactly what the app shows");

  /*
   * Several ranges, chosen to land on the awkward parts: the split, the moved
   * occurrence's two dates, the cancelled one, the one-off, a single day, and a
   * long run that crosses a year boundary.
   */
  const ranges = [
    { from: "2026-09-07", to: "2026-12-20" },
    { from: "2026-09-21", to: "2026-09-21" },
    { from: "2026-09-22", to: "2026-09-22" },
    { from: "2026-10-13", to: "2026-10-13" },
    { from: "2026-10-16", to: "2026-10-16" },
    { from: "2026-10-15", to: "2026-10-29" },
    { from: "2026-08-01", to: "2027-07-31" },
    { from: "2026-12-25", to: "2027-01-10" },
  ];

  for (const range of ranges) {
    const fromExport = exportPrint(snapshot, range);
    const fromResolver = resolverPrint(snapshot, range);
    equal(
      `${range.from} to ${range.to}: the same number of meetings`,
      fromExport.length,
      fromResolver.length,
    );
    equal(
      `${range.from} to ${range.to}: and exactly the same meetings`,
      JSON.stringify(fromExport),
      JSON.stringify(fromResolver),
    );
  }
}

/* ------------------------------------------------------------ I: boundaries */

function testBoundaries(snapshot) {
  section("I. Both ends of the range are inside it");

  // 2026-09-14 is a Monday the weekly class meets on; 2026-09-15 is a Tuesday
  // the alternating one meets on. A range of exactly those two days must hold
  // both, which is what "inclusive" has to mean at each end separately.
  const both = calendarOccurrencesIn(snapshot, { from: "2026-09-14", to: "2026-09-15" }, TEXT);
  check("a class on the first day is exported", both.some((event) => event.date === "2026-09-14"));
  check("a class on the last day is exported", both.some((event) => event.date === "2026-09-15"));

  const justBefore = calendarOccurrencesIn(snapshot, { from: "2026-09-15", to: "2026-09-15" }, TEXT);
  check("a class the day before the range is not", justBefore.every((event) => event.date !== "2026-09-14"));

  const justAfter = calendarOccurrencesIn(snapshot, { from: "2026-09-14", to: "2026-09-14" }, TEXT);
  check("nor is one the day after it", justAfter.every((event) => event.date !== "2026-09-15"));

  // A one-off sitting exactly on each boundary.
  equal(
    "a one-off exactly on the first day is exported",
    calendarOccurrencesIn(snapshot, { from: "2026-10-16", to: "2026-10-20" }, TEXT).filter(
      (event) => event.summary === "Museum trip",
    ).length,
    1,
  );
  equal(
    "a one-off exactly on the last day is exported",
    calendarOccurrencesIn(snapshot, { from: "2026-10-12", to: "2026-10-16" }, TEXT).filter(
      (event) => event.summary === "Museum trip",
    ).length,
    1,
  );
}

/* ----------------------------------------------------------------- J: empty */

function testEmptyRange(snapshot) {
  section("J. A range with no classes in it");

  // A week of the summer before the timetable begins.
  const empty = calendarOccurrencesIn(snapshot, { from: "2026-07-01", to: "2026-07-07" }, TEXT);
  equal("no occurrences are found", empty.length, 0);

  // And what the caller would do with that: nothing is shared. The file that
  // *would* have been written is a valid but empty calendar, which is exactly
  // why the hook refuses to share it rather than handing it over.
  const text = buildIcsCalendar({ calendarName: "Autumn 2026", occurrences: empty, exportedAt: NOW });
  equal("a calendar built from nothing holds no events", eventsOf(text).length, 0);
  check("though it is still a well-formed file", text.startsWith("BEGIN:VCALENDAR\r\n") && text.endsWith("END:VCALENDAR\r\n"));
}

/* ------------------------------------------------------- K: determinism */

function testDeterminism(snapshot) {
  section("K. The same export twice is the same file");

  const once = buildIcsCalendar({
    calendarName: snapshot.timetable.name,
    occurrences: calendarOccurrencesIn(snapshot, RANGE, TEXT),
    exportedAt: NOW,
  });
  const twice = buildIcsCalendar({
    calendarName: snapshot.timetable.name,
    occurrences: calendarOccurrencesIn(snapshot, RANGE, TEXT),
    exportedAt: NOW,
  });
  equal("byte for byte", once, twice);

  // UIDs are what let a calendar recognise a re-export as the same events
  // rather than as duplicates of them, so they must not move between runs.
  const first = eventsOf(once).map((event) => event.UID);
  const second = eventsOf(twice).map((event) => event.UID);
  equal("and the UIDs are stable across exports", JSON.stringify(first), JSON.stringify(second));

  // A narrower range is a subset: the same occurrence keeps the same UID
  // whatever range it was exported in.
  const narrow = eventsOf(
    buildIcsCalendar({
      calendarName: snapshot.timetable.name,
      occurrences: calendarOccurrencesIn(snapshot, { from: "2026-09-14", to: "2026-09-20" }, TEXT),
      exportedAt: NOW,
    }),
  ).map((event) => event.UID);
  check("including when the range changes", narrow.every((uid) => first.includes(uid)), JSON.stringify(narrow));
}

/* --------------------------------------------------- L: archives, read-only */

/** The whole database, as one comparable string. */
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

async function testArchivedExportChangesNothing() {
  section("L. Exporting an archived timetable writes nothing at all");

  const { db, state } = await buildFixture("Spring 2025");
  const archived = await archiveActiveTimetable(db, state, NOW);
  check("the fixture archived", archived.ok);

  const list = await db.getAllAsync("SELECT id FROM archived_timetables");
  const archiveId = list[0].id;

  const before = await databasePrint(db);

  const read = await readArchivedSnapshotRow(db, archiveId);
  check("its snapshot reads back", read.ok);

  const events = calendarOccurrencesIn(read.snapshot, { from: "2026-09-07", to: "2026-12-20" }, TEXT);
  check("and it exports events of its own", events.length > 0, String(events.length));

  const text = buildIcsCalendar({
    calendarName: read.snapshot.timetable.name,
    occurrences: events,
    exportedAt: NOW,
  });
  check("which build into a calendar", text.startsWith("BEGIN:VCALENDAR"));
  check("named after the archive", unfold(text).includes("X-WR-CALNAME:Spring 2025"));

  const after = await databasePrint(db);
  equal("the database is byte-for-byte identical afterwards", after, before);

  // And the archive was not restored on the way: there is still no active
  // timetable, which is what archiving left behind.
  const reloaded = await loadTimetable(db);
  equal("the archive was read, never restored", reloaded.timetable, null);
}

/* -------------------------------------------------------------------- run */

export async function runCalendarHarness() {
  try {
    const { snapshot } = await buildFixture();
    const text = buildIcsCalendar({
      calendarName: snapshot.timetable.name,
      occurrences: calendarOccurrencesIn(snapshot, RANGE, TEXT),
      exportedAt: "2026-09-14T07:15:00.000Z",
    });

    testEnvelope(text);
    testEscaping(text);
    testFolding(text);
    testDateTimes(text);
    testFileNames();
    testRange();
    testOccurrenceSemantics(snapshot);
    testAgreesWithTheResolver(snapshot);
    testBoundaries(snapshot);
    testEmptyRange(snapshot);
    testDeterminism(snapshot);
    await testArchivedExportChangesNothing();
  } finally {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      console.log(`\n(left ${directory} behind; the platform still had it open)`);
    }
  }
}
