/**
 * An archived timetable, as one self-contained value.
 *
 * ## Why a snapshot and not a `timetable_id` column
 *
 * The obvious way to hold several timetables is to add `timetable_id` to
 * `time_slots`, `courses`, `placements` and `occurrence_exceptions`, and to
 * filter every read by the active one. It is the right design when several
 * timetables are live at once — but nothing in this product asks for that. One
 * timetable is editable; the rest are put away.
 *
 * What that column would actually cost is four table rebuilds (they are all
 * `NOT NULL`-shaped in spirit and one is uniquely indexed on `position`
 * alone), a `WHERE timetable_id = ?` on every query and every diff in
 * `saveTimetable`, and a new way for the app to be wrong: a query that forgets
 * the filter shows one timetable's classes inside another. The archived rows
 * would sit in the same tables as the live ones, which is exactly where a bug
 * can reach them.
 *
 * A snapshot inverts that. The working tables keep meaning precisely what they
 * meant before — *the* timetable — so no read, no write and no diff changes at
 * all. An archive is one row, one string, and it is unreachable from every
 * query the rest of the app makes. Archiving and restoring become the only two
 * operations that know the format exists, and both are single transactions
 * whose payload is one value rather than a fan-out across four tables.
 *
 * The price is that an archived timetable is not queryable. That is not a
 * price: it is the requirement.
 *
 * ## Why it is versioned
 *
 * `formatVersion` is not the database's `user_version`. A snapshot outlives
 * the schema that produced it — it is a value, and the next feature writes
 * these to a file the user keeps and re-imports into a later build. So the
 * format carries its own version, `parse` refuses one it does not understand,
 * and every field is validated on the way in rather than trusted because we
 * wrote it. A stored snapshot is input.
 *
 * That is also why `parse` is total and returns a reason: a restore has to be
 * able to *decline* — leaving the active timetable exactly where it was —
 * rather than throw halfway through replacing it.
 *
 * File export and import are now built on exactly this. `storage/timetableFile`
 * wraps a snapshot in a `.temelo` envelope and validates an incoming one with
 * `parseTimetableSnapshotValue` below — the same validator a restore uses, so
 * there is one definition of what a timetable is and not two. Nothing here
 * writes or reads a file, and nothing here should grow to: this module is the
 * format, and the file layer is a caller.
 */

import { normalizeClassColorId } from "@/domain/classColor";
import { isValidIsoDate } from "@/domain/date";
import { inferStartsWithTimetable } from "@/domain/recurrence";
import type { ReminderMinutes, ReminderOverride } from "@/domain/reminder";
import { ALL_WEEKDAYS_MONDAY_FIRST, ALL_WEEKEND_MODES, type Weekday, type WeekendMode } from "@/domain/week";
import {
  TIMETABLE_SETTING_KEYS,
  type Course,
  type OccurrenceException,
  type OccurrenceExceptionState,
  type Placement,
  type RecurrenceType,
  type Settings,
  type TimeSlot,
  type Timetable,
  type TimetableSettings,
} from "@/types/models";

/**
 * The format this build writes.
 *
 * Bumped only when an older build could no longer read what a newer one
 * produces. Adding a field that tolerates being absent does not need a bump;
 * changing what an existing field means does.
 */
export const SNAPSHOT_FORMAT_VERSION = 1;

export interface TimetableSnapshot {
  formatVersion: number;
  /** The timetable's own identity — the same id it had while active. */
  timetable: Timetable;
  /** Only the settings that belong to the timetable; see `TIMETABLE_SETTING_KEYS`. */
  settings: TimetableSettings;
  timeSlots: TimeSlot[];
  courses: Course[];
  /** Per-class reminder lead times ride along on these two. */
  placements: Placement[];
  exceptions: OccurrenceException[];
}

/** What a snapshot is built from, and what restoring one gives back. */
export interface TimetableContents {
  timetable: Timetable;
  settings: TimetableSettings;
  timeSlots: TimeSlot[];
  courses: Course[];
  placements: Placement[];
  exceptions: OccurrenceException[];
}

export type SnapshotParseResult =
  | { ok: true; snapshot: TimetableSnapshot }
  | {
      ok: false;
      reason: string;
      /**
       * True when the only thing wrong is that the snapshot is *newer* than
       * this build understands.
       *
       * A restore does not care — a damaged archive and a future one are both
       * "cannot be restored" — but the file layer does, because those are two
       * different sentences to put in front of a user: one says the file is
       * broken, the other says Temelo is out of date. Optional rather than a
       * discriminant so that every existing `reason` reader is untouched.
       */
      unsupportedVersion?: boolean;
    };

/**
 * The timetable-specific half of a full settings object.
 *
 * Built by walking `TIMETABLE_SETTING_KEYS` rather than by naming the six
 * fields again, so the list stays the single statement of where the line is.
 */
export function timetableSettingsOf(settings: Settings): TimetableSettings {
  const picked: Partial<TimetableSettings> = {};
  for (const key of TIMETABLE_SETTING_KEYS) {
    // One assignment per key, keyed by a literal union, so TypeScript still
    // checks that every key exists on both sides.
    Object.assign(picked, { [key]: settings[key] });
  }
  return picked as TimetableSettings;
}

/**
 * A full settings object with the timetable's half replaced.
 *
 * This is what makes a restore leave appearance, language and the default
 * reminder alone: the fields not named in `TIMETABLE_SETTING_KEYS` are copied
 * from what the app currently has, never from the archive.
 */
export function settingsWithTimetableSettings(
  current: Settings,
  incoming: TimetableSettings,
): Settings {
  // `incoming` is exactly the timetable-specific keys, so the spread replaces
  // those and nothing else — and TypeScript proves that rather than trusting
  // a loop over string keys.
  return { ...current, ...incoming };
}

export function buildTimetableSnapshot(contents: TimetableContents): TimetableSnapshot {
  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    timetable: contents.timetable,
    settings: contents.settings,
    timeSlots: contents.timeSlots,
    courses: contents.courses,
    placements: contents.placements,
    exceptions: contents.exceptions,
  };
}

export function serializeTimetableSnapshot(snapshot: TimetableSnapshot): string {
  return JSON.stringify(snapshot);
}

/* -------------------------------------------------------------- validation */

/*
 * Hand-written rather than a schema library, because adding a dependency for
 * six record shapes is not a trade worth making, and because each check below
 * is about what the *domain* needs to be true rather than about JSON types:
 * a period whose `position` is not a positive integer would pass any structural
 * validator and still break the uniquely-indexed column it is written to.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

/** A string field that is allowed to be absent or explicitly null. */
function optionalStr(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function int(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isoDate(source: Record<string, unknown>, key: string): string | null {
  const value = str(source, key);
  return value !== null && isValidIsoDate(value) ? value : null;
}

/** `HH:mm`, the only time format anything here stores. */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function hhmm(source: Record<string, unknown>, key: string): string | null {
  const value = str(source, key);
  return value !== null && HHMM.test(value) ? value : null;
}

function oneOf<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = str(source, key);
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * A reminder lead time: a non-negative number of minutes, or null for "no
 * reminder". Absent reads as null, which is the same thing.
 */
function reminderMinutes(source: Record<string, unknown>, key: string): ReminderMinutes {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** An occurrence's three-state reminder override; see `domain/reminder`. */
function reminderOverride(source: Record<string, unknown>, key: string): ReminderOverride {
  const value = source[key];
  if (value === "none") return "none";
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return null;
}

const RECURRENCE_TYPES: readonly RecurrenceType[] = ["weekly", "biweekly", "once"];
const EXCEPTION_STATES: readonly OccurrenceExceptionState[] = ["modified", "cancelled"];

class Invalid extends Error {}

function require_<T>(value: T | null, what: string): T {
  if (value === null) throw new Invalid(what);
  return value;
}

function timestamps(source: Record<string, unknown>, what: string) {
  const createdAt = require_(str(source, "createdAt"), `${what}.createdAt`);
  return {
    createdAt,
    // `updatedAt` falling back to `createdAt` rather than being required: it is
    // bookkeeping for a sync that does not exist yet, and refusing a whole
    // timetable over a missing one would be the wrong proportion.
    updatedAt: str(source, "updatedAt") ?? createdAt,
    deletedAt: optionalStr(source, "deletedAt"),
  };
}

function parseTimeSlot(value: unknown): TimeSlot {
  if (!isObject(value)) throw new Invalid("timeSlots[] is not an object");
  const position = require_(int(value, "position"), "timeSlot.position");
  if (position < 1) throw new Invalid("timeSlot.position must be positive");
  return {
    id: require_(str(value, "id"), "timeSlot.id"),
    position,
    startTime: require_(hhmm(value, "startTime"), "timeSlot.startTime"),
    endTime: require_(hhmm(value, "endTime"), "timeSlot.endTime"),
  };
}

function parseCourse(value: unknown): Course {
  if (!isObject(value)) throw new Invalid("courses[] is not an object");
  return {
    id: require_(str(value, "id"), "course.id"),
    name: require_(str(value, "name"), "course.name"),
    room: str(value, "room") ?? "",
    teacher: str(value, "teacher") ?? "",
    notes: str(value, "notes") ?? "",
    // Normalised rather than required: a colour from a palette this build no
    // longer has is not a reason to refuse a restore, it is a reason to draw
    // the class in the nearest colour that exists.
    appearanceId: normalizeClassColorId(str(value, "appearanceId") ?? ""),
    ...timestamps(value, "course"),
  };
}

/** A placement, and whether the snapshot said if it starts with the timetable. */
interface ParsedPlacement {
  placement: Placement;
  /** null for a snapshot written before the field existed. */
  startsWithTimetable: boolean | null;
}

function parsePlacement(value: unknown): ParsedPlacement {
  if (!isObject(value)) throw new Invalid("placements[] is not an object");
  const slotSpan = require_(int(value, "slotSpan"), "placement.slotSpan");
  if (slotSpan < 1) throw new Invalid("placement.slotSpan must be at least 1");
  const startsOn = require_(isoDate(value, "startsOn"), "placement.startsOn");
  const endsOn = require_(isoDate(value, "endsOn"), "placement.endsOn");
  if (endsOn < startsOn) throw new Invalid("placement ends before it starts");
  const flag = value.startsWithTimetable;
  const startsWithTimetable = typeof flag === "boolean" ? flag : null;
  return {
    startsWithTimetable,
    placement: {
      id: require_(str(value, "id"), "placement.id"),
      courseId: require_(str(value, "courseId"), "placement.courseId"),
      weekday: require_(oneOf<Weekday>(value, "weekday", ALL_WEEKDAYS_MONDAY_FIRST), "placement.weekday"),
      timeSlotId: require_(str(value, "timeSlotId"), "placement.timeSlotId"),
      slotSpan,
      recurrenceType: require_(
        oneOf<RecurrenceType>(value, "recurrenceType", RECURRENCE_TYPES),
        "placement.recurrenceType",
      ),
      startsOn,
      endsOn,
      // Provisional until `parsePlacements` has seen the whole list.
      startsWithTimetable: startsWithTimetable ?? true,
      reminderMinutes: reminderMinutes(value, "reminderMinutes"),
      ...timestamps(value, "placement"),
    },
  };
}

/**
 * Every placement, with `startsWithTimetable` settled.
 *
 * A snapshot archived before the field existed does not say, and the answer
 * for one series depends on the others — whether it is the later half of a
 * split — so it is inferred over the whole list, by the same rule migration v7
 * applied to the working tables. That is what lets an old archive restore into
 * exactly the timetable an upgraded device would have had, without the format
 * version moving: the field is new, and an older build reading it back simply
 * ignores it.
 */
function parsePlacements(values: unknown[]): Placement[] {
  const parsed = values.map(parsePlacement);
  if (parsed.every((entry) => entry.startsWithTimetable !== null)) return parsed.map((entry) => entry.placement);

  const inferred = inferStartsWithTimetable(parsed.map((entry) => entry.placement));
  return parsed.map(({ placement, startsWithTimetable }) => ({
    ...placement,
    startsWithTimetable: startsWithTimetable ?? inferred.get(placement.id) ?? true,
  }));
}

function parseException(value: unknown): OccurrenceException {
  if (!isObject(value)) throw new Invalid("exceptions[] is not an object");
  const slotSpan = int(value, "slotSpan");
  const appearanceId = optionalStr(value, "appearanceId");
  return {
    id: require_(str(value, "id"), "exception.id"),
    placementId: require_(str(value, "placementId"), "exception.placementId"),
    originalDate: require_(isoDate(value, "originalDate"), "exception.originalDate"),
    effectiveDate: require_(isoDate(value, "effectiveDate"), "exception.effectiveDate"),
    state: require_(
      oneOf<OccurrenceExceptionState>(value, "state", EXCEPTION_STATES),
      "exception.state",
    ),
    // Every override below is nullable by design: null means "follow the
    // series", so an absent field is not a defect, it is the common case.
    timeSlotId: optionalStr(value, "timeSlotId"),
    slotSpan: slotSpan !== null && slotSpan >= 1 ? slotSpan : null,
    name: optionalStr(value, "name"),
    room: optionalStr(value, "room"),
    teacher: optionalStr(value, "teacher"),
    notes: optionalStr(value, "notes"),
    appearanceId: appearanceId === null ? null : normalizeClassColorId(appearanceId),
    reminderMinutes: reminderOverride(value, "reminderMinutes"),
    ...timestamps(value, "exception"),
  };
}

function parseTimetable(value: unknown): Timetable {
  if (!isObject(value)) throw new Invalid("timetable is not an object");
  const name = require_(str(value, "name"), "timetable.name");
  const createdAt = require_(str(value, "createdAt"), "timetable.createdAt");
  return {
    id: require_(str(value, "id"), "timetable.id"),
    name,
    anchorDate: require_(isoDate(value, "anchorDate"), "timetable.anchorDate"),
    createdAt,
    updatedAt: str(value, "updatedAt") ?? createdAt,
  };
}

function parseSettings(value: unknown): TimetableSettings {
  if (!isObject(value)) throw new Invalid("settings is not an object");
  const slotCount = require_(int(value, "slotCount"), "settings.slotCount");
  if (slotCount < 1) throw new Invalid("settings.slotCount must be positive");
  const lesson = require_(int(value, "defaultLessonDurationMinutes"), "settings.defaultLessonDurationMinutes");
  const pause = require_(int(value, "defaultBreakDurationMinutes"), "settings.defaultBreakDurationMinutes");
  if (lesson < 1) throw new Invalid("settings.defaultLessonDurationMinutes must be positive");
  if (pause < 0) throw new Invalid("settings.defaultBreakDurationMinutes must not be negative");
  return {
    weekendMode: require_(oneOf<WeekendMode>(value, "weekendMode", ALL_WEEKEND_MODES), "settings.weekendMode"),
    academicDayStart: require_(hhmm(value, "academicDayStart"), "settings.academicDayStart"),
    defaultLessonDurationMinutes: lesson,
    defaultBreakDurationMinutes: pause,
    slotCount,
  };
}

/**
 * Referential and structural checks no single record can make for itself.
 *
 * These are the invariants the working tables enforce with a foreign key or a
 * unique index — so a snapshot that breaks one of them would be refused by
 * SQLite *part way through* a restore, which is the one outcome that must be
 * impossible. Checking them here means a malformed archive is declined before
 * the active timetable has been touched at all.
 */
function assertCoherent(snapshot: TimetableSnapshot): void {
  const slotCount = snapshot.settings.slotCount;
  if (snapshot.timeSlots.length !== slotCount) {
    throw new Invalid(
      `settings.slotCount is ${slotCount} but the snapshot holds ${snapshot.timeSlots.length} periods`,
    );
  }

  const positions = new Set(snapshot.timeSlots.map((slot) => slot.position));
  if (positions.size !== snapshot.timeSlots.length) {
    throw new Invalid("two periods share a position");
  }

  const slotIds = new Set(snapshot.timeSlots.map((slot) => slot.id));
  if (slotIds.size !== snapshot.timeSlots.length) throw new Invalid("two periods share an id");

  const courseIds = new Set(snapshot.courses.map((course) => course.id));
  if (courseIds.size !== snapshot.courses.length) throw new Invalid("two courses share an id");

  const placementIds = new Set(snapshot.placements.map((placement) => placement.id));
  if (placementIds.size !== snapshot.placements.length) throw new Invalid("two classes share an id");

  const exceptionIds = new Set(snapshot.exceptions.map((exception) => exception.id));
  if (exceptionIds.size !== snapshot.exceptions.length) throw new Invalid("two exceptions share an id");

  // The two foreign keys the working tables actually declare. `timeSlotId` is
  // deliberately *not* checked: a soft-deleted placement legitimately points
  // at a period a later academic-day change replaced, and that is intended
  // history rather than a broken reference — see the note in migration v1.
  for (const placement of snapshot.placements) {
    if (!courseIds.has(placement.courseId)) {
      throw new Invalid(`class ${placement.id} refers to a course that is not in the snapshot`);
    }
  }
  for (const exception of snapshot.exceptions) {
    if (!placementIds.has(exception.placementId)) {
      throw new Invalid(`exception ${exception.id} refers to a class that is not in the snapshot`);
    }
  }
}

/**
 * How many classes a snapshot describes, and the shape of its day.
 *
 * The one-line description of a timetable nobody has opened yet — what the
 * archived list already shows, and what an import preview has to show about a
 * file that is not in the database at all. Derived here, next to the format it
 * reads, so the two screens cannot drift into two different answers.
 *
 * `classCount` counts live placements: series, not occurrences, and not
 * courses. It is the only number in it, it is offered rather than imposed, and
 * the archived screens deliberately do not draw it — see the note there. An
 * import preview does, because a file is the one timetable a user is being
 * asked to accept without having seen it.
 */
export interface TimetableSnapshotSummary {
  /** The timetable's start date, exactly as it was written. */
  startDate: string;
  weekendMode: WeekendMode;
  slotCount: number;
  /** First period's start and last period's end, or null with no periods. */
  dayStart: string | null;
  dayEnd: string | null;
  classCount: number;
}

export function summarizeTimetableSnapshot(snapshot: TimetableSnapshot): TimetableSnapshotSummary {
  const ordered = [...snapshot.timeSlots].sort((a, b) => a.position - b.position);
  return {
    startDate: snapshot.timetable.anchorDate,
    weekendMode: snapshot.settings.weekendMode,
    slotCount: snapshot.settings.slotCount,
    dayStart: ordered[0]?.startTime ?? null,
    dayEnd: ordered[ordered.length - 1]?.endTime ?? null,
    classCount: snapshot.placements.filter((placement) => placement.deletedAt === null).length,
  };
}

/**
 * A snapshot that has already been through `JSON.parse`, validated.
 *
 * The whole of the validation lives here rather than in the text entry point
 * below, because an imported `.temelo` file carries its snapshot as a *field*
 * of a larger document — it has been parsed once already, and re-serializing
 * it only to re-parse it would be a round trip whose only purpose was to reach
 * this function. One validator, two ways in.
 *
 * `raw` is `unknown` and is treated as such: nothing below reads a field
 * without checking it, and a stored archive gets exactly the same scrutiny a
 * file from a stranger does.
 */
export function parseTimetableSnapshotValue(raw: unknown): SnapshotParseResult {
  if (!isObject(raw)) return { ok: false, reason: "the snapshot is not an object" };

  const formatVersion = int(raw, "formatVersion");
  if (formatVersion === null) return { ok: false, reason: "the snapshot has no format version" };
  if (formatVersion < 1) return { ok: false, reason: `the snapshot's format version is ${formatVersion}` };
  if (formatVersion > SNAPSHOT_FORMAT_VERSION) {
    return {
      ok: false,
      unsupportedVersion: true,
      reason: `the snapshot was written in format ${formatVersion}, which this version of Temelo cannot read`,
    };
  }

  try {
    const list = (key: string): unknown[] => {
      const value = raw[key];
      if (!Array.isArray(value)) throw new Invalid(`${key} is missing or not a list`);
      return value;
    };

    const snapshot: TimetableSnapshot = {
      formatVersion,
      timetable: parseTimetable(raw.timetable),
      settings: parseSettings(raw.settings),
      timeSlots: list("timeSlots").map(parseTimeSlot),
      courses: list("courses").map(parseCourse),
      placements: parsePlacements(list("placements")),
      exceptions: list("exceptions").map(parseException),
    };

    assertCoherent(snapshot);
    return { ok: true, snapshot };
  } catch (error: unknown) {
    if (error instanceof Invalid) return { ok: false, reason: error.message };
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * A stored snapshot, as the text an archive row holds, validated.
 *
 * Never throws. A restore must be able to decline and leave everything as it
 * was, so the failure is a value with a reason in it.
 */
export function parseTimetableSnapshot(text: string): SnapshotParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the archive is not valid JSON" };
  }
  return parseTimetableSnapshotValue(raw);
}
