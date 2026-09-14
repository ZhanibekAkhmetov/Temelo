/**
 * The `.temelo` file: a timetable as something the user owns.
 *
 * ## Why a wrapper and not the snapshot itself
 *
 * `TimetableSnapshot` is already a self-contained, validated, versioned value
 * — writing one to disk verbatim would work. It is deliberately not what this
 * does, for two reasons that only apply once the value leaves the app.
 *
 * A stored archive arrives from a column this build wrote. A file arrives from
 * a messaging app, a Downloads folder, a friend's phone, or a `.temelo` that is
 * actually a photo somebody renamed. So the document says what it *is* —
 * `type: "temelo-timetable"` — before it says anything else, and that magic is
 * checked before the snapshot's own version is even read. Without it, the only
 * thing separating "this is not a Temelo file" from "this Temelo file is
 * damaged" would be which field happened to be missing first, and those are two
 * different sentences to put in front of a user.
 *
 * And the envelope versions *the file*, separately from the snapshot inside it.
 * The two change for different reasons: the snapshot's version moves when what
 * a timetable is changes, the envelope's when how a file is laid out does. A
 * later build that adds, say, a checksum or a second payload alongside the
 * timetable bumps the envelope and leaves the snapshot alone, and a build that
 * changes a placement field bumps the snapshot and leaves the envelope alone.
 * Collapsing them into one number would make every such change break the other
 * half's compatibility story.
 *
 * ## The file is input, always
 *
 * Everything below treats the text as hostile. `JSON.parse`'s result is never
 * used as application state: it is handed to `parseTimetableSnapshotValue`,
 * the same validator a restore uses, which rebuilds every record field by
 * field and checks the referential invariants the working tables would
 * otherwise discover half-way through an INSERT. Nothing here writes to the
 * database, so a file that fails any check costs exactly one wasted parse.
 *
 * The limits are part of that. A `.temelo` holding a real timetable is a few
 * tens of kilobytes; the caps below are orders of magnitude above anything the
 * app can produce and are there so that a deliberately enormous file is
 * declined in milliseconds rather than parsed until the app stops responding.
 * They are checked in cost order: the length of the text before it is parsed,
 * the record counts before the records are validated.
 *
 * ## What is not in it
 *
 * Appearance, language, the default reminder lead time, the developer
 * settings, the reminder ledger, OS notification identifiers, `user_version`
 * and every other piece of SQLite bookkeeping. None of that is a fact about a
 * timetable — it is a fact about a person or about one installation — and the
 * line is not drawn here: it is `TIMETABLE_SETTING_KEYS`, drawn once in
 * `types/models`, and this file inherits it by carrying a `TimetableSnapshot`
 * and nothing beside it. That is the main thing the wrapper is *not* allowed
 * to grow: a second payload next to `timetable` would be a second definition
 * of what belongs to a timetable.
 */

import { createId } from "@/domain/id";
import { sanitizeFileNameStem } from "@/storage/fileName";
import {
  buildTimetableSnapshot,
  parseTimetableSnapshotValue,
  type TimetableSnapshot,
} from "@/storage/snapshot";
import type { Course, OccurrenceException, Placement, TimeSlot } from "@/types/models";

/** The magic: the first thing read, and the first thing checked. */
export const TEMELO_FILE_TYPE = "temelo-timetable";

/**
 * The envelope version this build writes.
 *
 * Not the snapshot's — see the note above — and not the database's
 * `user_version`, which never leaves the device.
 */
export const TEMELO_FILE_FORMAT_VERSION = 1;

export const TEMELO_FILE_EXTENSION = ".temelo";

/**
 * What the share sheet is told the file is.
 *
 * `.temelo` is registered with nothing, so Android has no type of its own to
 * offer and the choice is ours. `application/octet-stream` is the one every
 * target accepts — mail attaches it, messengers send it, Drive stores it,
 * Quick Share transfers it — whereas `application/json` is filtered out by
 * several of them on the grounds that it is not a document. The content is
 * JSON regardless, and nothing about importing depends on the type: the file
 * is identified by what is inside it.
 */
export const TEMELO_FILE_MIME_TYPE = "application/octet-stream";

/**
 * The most text a `.temelo` may hold, in UTF-16 code units.
 *
 * Counted in `String.length` rather than bytes on purpose. The byte length is
 * what the caller checks against the file on disk *before* reading it — see
 * `util/timetableFiles` — and by the time the text is here, bytes are no
 * longer the resource at risk; the parse is. A code unit is never more than
 * one byte's worth of UTF-8 and usually less, so this bound is strictly
 * tighter than the same number of bytes would be, which is the right direction
 * for a guard.
 *
 * Four million is roughly a hundred times the largest timetable the app can
 * produce (a few hundred classes across a few years of exceptions), so it is
 * not a limit any real user will meet.
 */
export const MAX_TEMELO_FILE_LENGTH = 4_000_000;

/**
 * The most records a `.temelo` may describe, across all four collections.
 *
 * The second guard, and the one that matters for a file that is small but
 * pathological — fifty thousand one-period placements is well under the length
 * cap and would still take long enough to validate and remap to look like a
 * freeze. A timetable with more entries than this is not a timetable.
 */
export const MAX_TEMELO_FILE_RECORDS = 20_000;

/**
 * A Temelo timetable file.
 *
 * The field order is the order it is validated in, and it is also the order it
 * is written in, so a human looking at the first line of the JSON sees what the
 * document is without reading the rest of it.
 */
export interface TemeloTimetableFile {
  type: typeof TEMELO_FILE_TYPE;
  formatVersion: number;
  /** When the file was written, as an ISO timestamp. Informational. */
  exportedAt: string;
  timetable: TimetableSnapshot;
}

/**
 * Why a file was declined, in the four shapes the UI actually distinguishes.
 *
 * `detail` never reaches the user. It names a field of a JSON document, which
 * is the only thing that would ever explain a failure in a log and the last
 * thing that helps somebody holding a phone.
 */
export type TemeloFileFailure =
  /** Too long to be worth parsing, or too many records to be worth validating. */
  | { kind: "tooLarge"; detail: string }
  /** Not JSON, not an object, or not carrying Temelo's magic. */
  | { kind: "notTemelo"; detail: string }
  /** Genuinely a Temelo file, from a build newer than this one. */
  | { kind: "futureVersion"; detail: string }
  /** A Temelo file this build should understand, that does not hold together. */
  | { kind: "damaged"; detail: string };

export type TemeloFileParseResult =
  | { ok: true; file: TemeloTimetableFile }
  | { ok: false; failure: TemeloFileFailure };

/* -------------------------------------------------------------- writing out */

export function buildTemeloFile(snapshot: TimetableSnapshot, exportedAt: string): TemeloTimetableFile {
  return {
    type: TEMELO_FILE_TYPE,
    formatVersion: TEMELO_FILE_FORMAT_VERSION,
    exportedAt,
    timetable: snapshot,
  };
}

export function serializeTemeloFile(file: TemeloTimetableFile): string {
  return JSON.stringify(file);
}

/**
 * A file's text, built and then read back to prove it is a file this build
 * would accept.
 *
 * The round trip is deliberate and is the whole of what "a validated snapshot"
 * means here. Export is the one moment a timetable leaves the app, and the
 * value being written comes from live app state — which is trusted, but is
 * trusted for the wrong reason: it is trusted because we built it, not because
 * anything checked it. So it is serialized, parsed back through the same
 * validator an import uses, and only then written to disk. A timetable that
 * cannot survive that is one that could not have been restored either, and
 * finding out at export time — with a normal error and nothing shared — is
 * enormously better than finding out on the friend's phone.
 *
 * It costs one extra parse of a few tens of kilobytes, once, behind a button
 * press.
 */
export function buildValidatedTemeloFile(
  snapshot: TimetableSnapshot,
  exportedAt: string,
): { ok: true; text: string } | { ok: false; failure: TemeloFileFailure } {
  const text = serializeTemeloFile(buildTemeloFile(snapshot, exportedAt));
  const parsed = parseTemeloFile(text);
  return parsed.ok ? { ok: true, text } : { ok: false, failure: parsed.failure };
}

/* --------------------------------------------------------------- file names */

/**
 * The longest a generated filename's stem may be, in code points.
 *
 * Comfortably inside every filesystem limit Android's cache directory and
 * every share target impose, counted in code points so a Cyrillic or German
 * name is not truncated harder than an English one.
 */
const MAX_FILE_NAME_STEM = 60;

/**
 * A timetable's name, as a filename somebody would recognise in a Downloads
 * folder.
 *
 * "My timetable" becomes `My timetable.temelo`. The cleaning itself is
 * `storage/fileName`, shared with the calendar exporter so that what a
 * filesystem accepts is decided in one place; what belongs here is the
 * extension and the fallback.
 *
 * A name that survives none of the cleaning falls back to `timetable.temelo`.
 * That is not a failure worth reporting: the file's contents carry the real
 * name, and the import preview reads it from there.
 */
export function temeloFileName(timetableName: string): string {
  const stem = sanitizeFileNameStem(timetableName, MAX_FILE_NAME_STEM);
  return `${stem.length > 0 ? stem : "timetable"}${TEMELO_FILE_EXTENSION}`;
}

/* -------------------------------------------------------------- reading in */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countRecords(snapshot: TimetableSnapshot): number {
  return (
    snapshot.timeSlots.length +
    snapshot.courses.length +
    snapshot.placements.length +
    snapshot.exceptions.length
  );
}

/**
 * How many records a *parsed but not yet validated* document claims.
 *
 * Read off the raw arrays, before a single record is rebuilt, so a file
 * claiming fifty thousand classes is refused having cost one `JSON.parse` and
 * four `length` reads rather than fifty thousand field-by-field validations.
 * Anything that is not an array counts as nothing here and is refused a moment
 * later by the validator, which is the module that owns that complaint.
 */
function claimedRecordCount(raw: Record<string, unknown>): number {
  let total = 0;
  for (const key of ["timeSlots", "courses", "placements", "exceptions"]) {
    const value = raw[key];
    if (Array.isArray(value)) total += value.length;
  }
  return total;
}

/**
 * A `.temelo` file's text, validated into a value the app may act on.
 *
 * Never throws, and never returns something partially checked: either the
 * result carries a snapshot every field of which has been rebuilt and
 * cross-referenced, or it carries a reason. There is no third state, which is
 * what lets the caller decide to import *after* validating rather than
 * discovering a bad file half-way through a transaction.
 *
 * The order of the checks is the order of their cost, and the order of how
 * specific their error messages can be:
 *
 *  1. length — before `JSON.parse`, which is the expensive step;
 *  2. JSON, object, magic — "this is not a Temelo file at all";
 *  3. envelope version — "this came from a newer Temelo";
 *  4. record counts — before per-record validation, which is the second
 *     expensive step;
 *  5. the snapshot itself, through the validator a restore uses.
 *
 * Step 5 distinguishes a future *snapshot* version from a damaged one and
 * reports it as `futureVersion` too: from the user's side, a newer Temelo
 * wrote it either way, and which of the two version numbers moved is not
 * something anyone should be asked to care about.
 */
export function parseTemeloFile(text: string): TemeloFileParseResult {
  if (text.length > MAX_TEMELO_FILE_LENGTH) {
    return {
      ok: false,
      failure: { kind: "tooLarge", detail: `${text.length} code units exceeds ${MAX_TEMELO_FILE_LENGTH}` },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    return {
      ok: false,
      failure: { kind: "notTemelo", detail: error instanceof Error ? error.message : "not valid JSON" },
    };
  }

  if (!isObject(raw)) return { ok: false, failure: { kind: "notTemelo", detail: "the file is not a JSON object" } };

  if (raw.type !== TEMELO_FILE_TYPE) {
    return {
      ok: false,
      failure: { kind: "notTemelo", detail: `type is ${JSON.stringify(raw.type)}, not ${TEMELO_FILE_TYPE}` },
    };
  }

  const formatVersion = raw.formatVersion;
  if (typeof formatVersion !== "number" || !Number.isInteger(formatVersion) || formatVersion < 1) {
    return {
      ok: false,
      failure: { kind: "damaged", detail: `formatVersion is ${JSON.stringify(formatVersion)}` },
    };
  }
  if (formatVersion > TEMELO_FILE_FORMAT_VERSION) {
    return {
      ok: false,
      failure: {
        kind: "futureVersion",
        detail: `file format ${formatVersion} is newer than ${TEMELO_FILE_FORMAT_VERSION}`,
      },
    };
  }

  const exportedAt = typeof raw.exportedAt === "string" ? raw.exportedAt : "";

  const payload = raw.timetable;
  if (!isObject(payload)) {
    return { ok: false, failure: { kind: "damaged", detail: "the file holds no timetable" } };
  }

  const claimed = claimedRecordCount(payload);
  if (claimed > MAX_TEMELO_FILE_RECORDS) {
    return {
      ok: false,
      failure: { kind: "tooLarge", detail: `${claimed} records exceeds ${MAX_TEMELO_FILE_RECORDS}` },
    };
  }

  const parsed = parseTimetableSnapshotValue(payload);
  if (!parsed.ok) {
    return {
      ok: false,
      failure: {
        kind: parsed.unsupportedVersion ? "futureVersion" : "damaged",
        detail: parsed.reason,
      },
    };
  }

  // Belt and braces after validation: `claimedRecordCount` reads arrays that
  // the validator may legitimately have reshaped, and this is the count that
  // the import is actually going to remap.
  const actual = countRecords(parsed.snapshot);
  if (actual > MAX_TEMELO_FILE_RECORDS) {
    return {
      ok: false,
      failure: { kind: "tooLarge", detail: `${actual} records exceeds ${MAX_TEMELO_FILE_RECORDS}` },
    };
  }

  return {
    ok: true,
    file: { type: TEMELO_FILE_TYPE, formatVersion, exportedAt, timetable: parsed.snapshot },
  };
}

/* ------------------------------------------------------------------ cloning */

/**
 * A snapshot re-identified: the same timetable, with every id in it replaced
 * by a fresh one generated on this device.
 *
 * ## Why importing cannot keep the ids it was given
 *
 * A `.temelo` may have been written by this very installation ten minutes ago.
 * Importing it while the timetable it came from is still on the device — as an
 * archive, or as the active one — would mean two records claiming the same
 * primary key, and the second `INSERT` failing part way through a swap. That
 * alone settles it, but the consequence that would survive a looser fix is
 * worse: a reminder's identity is derived from its placement id and occurrence
 * date (`domain/reminderSchedule`), so two copies of a class sharing an id
 * share a reminder. Cancelling one would silence the other, and the ledger
 * would record a delivery against a class the user never saw.
 *
 * So there is no "import if the id is free" path, and no attempt to detect
 * whether the file came from here. Every import is a new local copy, which
 * makes importing the same file twice mean exactly what it looks like: two
 * timetables.
 *
 * ## How the remapping stays total
 *
 * `idFor` is a memo over a generator rather than a lookup in a prebuilt table,
 * and that is what makes it safe for the references the snapshot deliberately
 * does not check. A soft-deleted placement may point at a period that an
 * academic-day change replaced years ago — intended history, not a broken
 * reference, and `assertCoherent` says so — so a prebuilt slot table would
 * have no entry for it. The memo mints one, consistently, so the reference
 * still points where it pointed relative to everything else in the file and no
 * id from the source survives anywhere in the result.
 *
 * Nothing else changes. Names, rooms, notes, colours, recurrence, parity
 * anchors, end dates, exceptions, reminder lead times and `createdAt` are
 * copied exactly: the user asked to import their timetable, not a timetable
 * that has been tidied. `updatedAt` on the timetable record alone moves to
 * `now`, because the local copy genuinely came into existence now.
 */
export function cloneSnapshotWithFreshIds(
  snapshot: TimetableSnapshot,
  now: string,
  newId: () => string = createId,
): TimetableSnapshot {
  const minted = new Map<string, string>();
  const idFor = (original: string): string => {
    const existing = minted.get(original);
    if (existing !== undefined) return existing;
    const fresh = newId();
    minted.set(original, fresh);
    return fresh;
  };
  /** The same memo for a nullable reference; null stays null. */
  const optionalIdFor = (original: string | null): string | null => (original === null ? null : idFor(original));

  const timeSlots: TimeSlot[] = snapshot.timeSlots.map((slot) => ({ ...slot, id: idFor(slot.id) }));
  const courses: Course[] = snapshot.courses.map((course) => ({ ...course, id: idFor(course.id) }));
  const placements: Placement[] = snapshot.placements.map((placement) => ({
    ...placement,
    id: idFor(placement.id),
    courseId: idFor(placement.courseId),
    timeSlotId: idFor(placement.timeSlotId),
  }));
  const exceptions: OccurrenceException[] = snapshot.exceptions.map((exception) => ({
    ...exception,
    id: idFor(exception.id),
    placementId: idFor(exception.placementId),
    timeSlotId: optionalIdFor(exception.timeSlotId),
  }));

  return buildTimetableSnapshot({
    timetable: {
      ...snapshot.timetable,
      id: idFor(snapshot.timetable.id),
      updatedAt: now,
    },
    settings: { ...snapshot.settings },
    timeSlots,
    courses,
    placements,
    exceptions,
  });
}
