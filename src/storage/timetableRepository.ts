/**
 * The storage boundary for the timetable.
 *
 * Screens never come here; only `AppStateProvider` does. Everything it can
 * ask for is a whole-timetable operation — load it, save what changed —
 * because that is the granularity the domain actually works at: a single
 * recurring edit can truncate one placement, create another, clone a course
 * and re-point several exceptions, and none of those may land without the
 * others.
 */

import type { SQLiteDatabase } from "expo-sqlite";

import type {
  AcademicTerm,
  Course,
  OccurrenceException,
  Placement,
  Settings,
  TimeSlot,
} from "@/types/models";
import {
  courseFromRow,
  courseToRow,
  exceptionFromRow,
  exceptionToRow,
  placementFromRow,
  placementToRow,
  settingsFromRow,
  settingsToRow,
  termFromRow,
  termToRow,
  timeSlotFromRow,
  timeSlotToRow,
  SETTINGS_ROW_ID,
  type CourseRow,
  type OccurrenceExceptionRow,
  type PlacementRow,
  type SettingsRow,
  type TermRow,
  type TimeSlotRow,
} from "@/storage/records";
import { withTransaction } from "@/storage/transaction";

/**
 * The persistable slice of app state. Structurally this is `AppState` minus
 * nothing — every field of it is real user data — but it is declared here
 * rather than imported so that storage does not depend on the React layer.
 */
export interface PersistedTimetable {
  settings: Settings;
  term: AcademicTerm;
  timeSlots: TimeSlot[];
  courses: Course[];
  placements: Placement[];
  exceptions: OccurrenceException[];
}

/*
 * A device upgraded from an earlier build may still carry a
 * `legacy_seed_imported` row here, written by a one-time sample import that
 * no longer exists. It is deliberately left where it is: nothing reads it,
 * and deleting rows out of a user's database to tidy up a key we stopped
 * using would be a migration of their data for our convenience.
 */
export const META_KEYS = {
  /** Set once the database holds a usable timetable, whatever its origin. */
  initialized: "initialized",
} as const;

const UPSERT_META = `
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value
`;

export async function readMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = ?", key);
  return row?.value ?? null;
}

/** The stored timetable, or null when nothing has ever been stored. */
export async function loadTimetable(db: SQLiteDatabase): Promise<PersistedTimetable | null> {
  const settingsRow = await db.getFirstAsync<SettingsRow>(
    "SELECT * FROM settings WHERE id = ?",
    SETTINGS_ROW_ID,
  );
  if (!settingsRow) return null;

  // Exactly one term is stored, but the query is ordered so that a stray
  // second row could never make startup non-deterministic.
  const termRow = await db.getFirstAsync<TermRow>("SELECT * FROM terms ORDER BY rowid LIMIT 1");
  if (!termRow) return null;

  /*
   * `rowid` order reproduces the order the records were first written in,
   * which is the order the in-memory arrays had — so a reload gives back the
   * same arrays, not merely the same set of records.
   */
  const timeSlotRows = await db.getAllAsync<TimeSlotRow>("SELECT * FROM time_slots ORDER BY position");
  const courseRows = await db.getAllAsync<CourseRow>("SELECT * FROM courses ORDER BY rowid");
  const placementRows = await db.getAllAsync<PlacementRow>("SELECT * FROM placements ORDER BY rowid");
  const exceptionRows = await db.getAllAsync<OccurrenceExceptionRow>(
    "SELECT * FROM occurrence_exceptions ORDER BY rowid",
  );

  return {
    settings: settingsFromRow(settingsRow),
    term: termFromRow(termRow),
    timeSlots: timeSlotRows.map(timeSlotFromRow),
    courses: courseRows.map(courseFromRow),
    placements: placementRows.map(placementFromRow),
    exceptions: exceptionRows.map(exceptionFromRow),
  };
}

interface Identified {
  id: string;
}

interface RecordDiff<T> {
  upserts: T[];
  deletedIds: string[];
}

/**
 * What changed between two versions of one collection.
 *
 * Comparison is by object identity, which is sound because app state is only
 * ever replaced, never mutated in place: a record whose reference survived a
 * `setState` is a record no action touched. Where a reference changed but the
 * contents did not, the worst outcome is an upsert that writes the same
 * values back — harmless, and much cheaper than deep-comparing every record
 * after every gesture.
 */
function diffRecords<T extends Identified>(previous: T[], next: T[]): RecordDiff<T> {
  const remaining = new Map(previous.map((record) => [record.id, record]));
  const upserts: T[] = [];

  for (const record of next) {
    if (remaining.get(record.id) !== record) upserts.push(record);
    remaining.delete(record.id);
  }

  return { upserts, deletedIds: [...remaining.keys()] };
}

/**
 * The same question asked of the database itself, for when there is no
 * baseline to diff against.
 *
 * A null baseline means "what this database contains is unknown" — which is
 * where a failed write leaves us. Treating that as an empty baseline, which is
 * what `diffRecords(previous ?? [], next)` did, gets the upserts right and the
 * *deletions* silently wrong: nothing is ever removed, because an empty
 * baseline has nothing left over.
 *
 * That is not a harmless approximation. An academic-day change replaces every
 * period with a freshly generated one, and `time_slots.position` is uniquely
 * indexed — so a recovery write would insert the new periods alongside the old
 * ones it failed to delete and die on that index. One failed write therefore
 * made every later academic-day save fail too, permanently, for reasons that
 * had nothing to do with the original failure.
 *
 * Asking the database which ids it actually holds costs one indexed scan per
 * table on a path that only runs after a failure, and makes a full write mean
 * what it says: the database ends up matching `next` exactly.
 */
async function fullSyncDiff<T extends Identified>(
  db: SQLiteDatabase,
  table: string,
  next: T[],
): Promise<RecordDiff<T>> {
  // The table name is a literal from `saveTimetable`, never user input.
  const stored = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${table}`);
  const keep = new Set(next.map((record) => record.id));
  return { upserts: next, deletedIds: stored.map((row) => row.id).filter((id) => !keep.has(id)) };
}

/*
 * Upserts are `ON CONFLICT DO UPDATE`, never `INSERT OR REPLACE`. Replace is
 * a delete followed by an insert, so with foreign keys on it would cascade:
 * re-saving a course would take its placements with it, and re-saving a
 * placement would take its exceptions. Writing a row that already exists has
 * to be an update, and this is why.
 */
const UPSERT_SETTINGS = `
  INSERT INTO settings (
    id, weekend_mode, grid_orientation, academic_day_start,
    default_lesson_duration_minutes, default_break_duration_minutes,
    slot_count, default_reminder_minutes, appearance_preference,
    language_preference, onboarding_completed
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    weekend_mode = excluded.weekend_mode,
    grid_orientation = excluded.grid_orientation,
    academic_day_start = excluded.academic_day_start,
    default_lesson_duration_minutes = excluded.default_lesson_duration_minutes,
    default_break_duration_minutes = excluded.default_break_duration_minutes,
    slot_count = excluded.slot_count,
    default_reminder_minutes = excluded.default_reminder_minutes,
    appearance_preference = excluded.appearance_preference,
    language_preference = excluded.language_preference,
    onboarding_completed = excluded.onboarding_completed
`;

const UPSERT_TERM = `
  INSERT INTO terms (id, name, start_date, estimated_end_date)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    start_date = excluded.start_date,
    estimated_end_date = excluded.estimated_end_date
`;

const UPSERT_TIME_SLOT = `
  INSERT INTO time_slots (id, position, start_time, end_time)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    position = excluded.position,
    start_time = excluded.start_time,
    end_time = excluded.end_time
`;

const UPSERT_COURSE = `
  INSERT INTO courses (
    id, name, room, teacher, notes, appearance_id, created_at, updated_at, deleted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    room = excluded.room,
    teacher = excluded.teacher,
    notes = excluded.notes,
    appearance_id = excluded.appearance_id,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at
`;

const UPSERT_PLACEMENT = `
  INSERT INTO placements (
    id, course_id, weekday, time_slot_id, slot_span, recurrence_type,
    starts_on, ends_on, reminder_minutes, created_at, updated_at, deleted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    course_id = excluded.course_id,
    weekday = excluded.weekday,
    time_slot_id = excluded.time_slot_id,
    slot_span = excluded.slot_span,
    recurrence_type = excluded.recurrence_type,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    reminder_minutes = excluded.reminder_minutes,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at
`;

const UPSERT_EXCEPTION = `
  INSERT INTO occurrence_exceptions (
    id, placement_id, original_date, effective_date, state, time_slot_id,
    slot_span, name, room, teacher, notes, appearance_id, reminder_minutes,
    created_at, updated_at, deleted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    placement_id = excluded.placement_id,
    original_date = excluded.original_date,
    effective_date = excluded.effective_date,
    state = excluded.state,
    time_slot_id = excluded.time_slot_id,
    slot_span = excluded.slot_span,
    name = excluded.name,
    room = excluded.room,
    teacher = excluded.teacher,
    notes = excluded.notes,
    appearance_id = excluded.appearance_id,
    reminder_minutes = excluded.reminder_minutes,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at
`;

async function deleteByIds(db: SQLiteDatabase, table: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    // The table name is a literal from this module; only the id is bound.
    await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, id);
  }
}

/**
 * What has to be true of a timetable before it is worth writing.
 *
 * The academic-day configuration is stored in two places that must agree:
 * `settings.slot_count`, which the grid sizes itself from, and the
 * `time_slots` rows it addresses. A database where those two disagree renders
 * a timetable with periods that cannot be reached or rows that are not there —
 * which is exactly the state a half-applied academic-day change leaves behind.
 *
 * So the pair is checked as one invariant rather than trusted because the two
 * happen to be written by the same action. Checked *before* the transaction
 * opens, because a payload this wrong is a programming error and there is no
 * point taking a write lock to discover it; and again inside the transaction
 * against what the database really holds, because that is the only assertion
 * that survives a partially-applied write.
 *
 * `position` is uniquely indexed, so a duplicate would fail at the index
 * anyway — but it would fail somewhere in the middle of the write, with an
 * SQLite message about an index. Saying it here says what is actually wrong.
 */
function assertCoherent(timetable: PersistedTimetable): void {
  const { slotCount } = timetable.settings;
  const slots = timetable.timeSlots;

  if (slots.length !== slotCount) {
    throw new Error(
      `[temelo/storage] refusing to save an incoherent academic day: settings.slotCount is ${slotCount} but there are ${slots.length} time slots.`,
    );
  }

  const positions = new Set(slots.map((slot) => slot.position));
  if (positions.size !== slots.length) {
    throw new Error(
      `[temelo/storage] refusing to save ${slots.length} time slots with only ${positions.size} distinct positions.`,
    );
  }
}

/**
 * The same invariant, asked of the database, inside the transaction that has
 * just written it.
 *
 * This is the assertion that makes an academic-day save atomic in the sense
 * that matters to the user rather than only in the sense SQLite guarantees. A
 * transaction commits whatever statements it was given; it has no opinion
 * about whether they add up. Counting the rows back before the commit means a
 * save either lands as a whole consistent academic day or lands not at all —
 * and because it throws, the transaction is rolled back and the in-memory
 * state is restored from the last known-good snapshot, so neither half of the
 * app is left believing something the other half does not.
 */
async function assertStoredCoherently(db: SQLiteDatabase, timetable: PersistedTimetable): Promise<void> {
  const row = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM time_slots");
  const stored = row?.count ?? 0;
  if (stored !== timetable.settings.slotCount) {
    throw new Error(
      `[temelo/storage] academic day did not save coherently: settings.slotCount is ${timetable.settings.slotCount} but the database holds ${stored} time slots. Rolling back.`,
    );
  }
}

/**
 * Writes everything that differs between `previous` and `next`, in one
 * transaction.
 *
 * One transaction for the whole diff is the point. A "this and future" edit
 * truncates a placement, inserts a replacement, may clone a course and
 * re-points the exceptions in between; a half-applied version of that is a
 * timetable with a class in two places at once. Either all of it reaches the
 * disk or none of it does.
 *
 * Order within the transaction follows the foreign keys — parents in before
 * children, children out before parents — so no statement leaves the
 * database referentially invalid, even momentarily.
 *
 * Passing `previous` as null writes the whole timetable, which is what the
 * first save after a reset or a sample-timetable load amounts to anyway.
 */
export async function saveTimetable(
  db: SQLiteDatabase,
  next: PersistedTimetable,
  previous: PersistedTimetable | null,
): Promise<void> {
  assertCoherent(next);

  if (previous) {
    const timeSlots = diffRecords(previous.timeSlots, next.timeSlots);
    const courses = diffRecords(previous.courses, next.courses);
    const placements = diffRecords(previous.placements, next.placements);
    const exceptions = diffRecords(previous.exceptions, next.exceptions);

    const settingsChanged = previous.settings !== next.settings;
    const termChanged = previous.term !== next.term;

    const empty = (diff: RecordDiff<unknown>) => diff.upserts.length === 0 && diff.deletedIds.length === 0;
    if (
      !settingsChanged &&
      !termChanged &&
      empty(timeSlots) &&
      empty(courses) &&
      empty(placements) &&
      empty(exceptions)
    ) {
      return;
    }

    await writeDiff(db, next, { settingsChanged, termChanged, timeSlots, courses, placements, exceptions });
    return;
  }

  /*
   * No baseline: the database's contents are unknown, so they are read rather
   * than assumed. Settings and the term are always rewritten here — there is
   * nothing to compare them against — and every collection is reconciled
   * against what the database really holds, so this converges on `next`
   * whatever state a failed write left behind.
   *
   * The reads are inside the transaction so nothing can slip in between
   * deciding what to delete and deleting it.
   */
  await withTransaction(db, async () => {
    await writeDiffWithin(db, next, {
      settingsChanged: true,
      termChanged: true,
      timeSlots: await fullSyncDiff(db, "time_slots", next.timeSlots),
      courses: await fullSyncDiff(db, "courses", next.courses),
      placements: await fullSyncDiff(db, "placements", next.placements),
      exceptions: await fullSyncDiff(db, "occurrence_exceptions", next.exceptions),
    });
    await assertStoredCoherently(db, next);
  });
}

interface TimetableDiff {
  settingsChanged: boolean;
  termChanged: boolean;
  timeSlots: RecordDiff<TimeSlot>;
  courses: RecordDiff<Course>;
  placements: RecordDiff<Placement>;
  exceptions: RecordDiff<OccurrenceException>;
}

async function writeDiff(db: SQLiteDatabase, next: PersistedTimetable, diff: TimetableDiff): Promise<void> {
  const touchesAcademicDay =
    diff.settingsChanged || diff.timeSlots.upserts.length > 0 || diff.timeSlots.deletedIds.length > 0;

  await withTransaction(db, async () => {
    await writeDiffWithin(db, next, diff);
    // Only when this write could have moved either half of the pair. Every
    // other save — a class dragged, a colour changed — leaves both alone, and
    // counting a table it did not touch is a cost for nothing.
    if (touchesAcademicDay) await assertStoredCoherently(db, next);
  });
}

/** The statements themselves; the caller owns the transaction. */
async function writeDiffWithin(db: SQLiteDatabase, next: PersistedTimetable, diff: TimetableDiff): Promise<void> {
  const { settingsChanged, termChanged, timeSlots, courses, placements, exceptions } = diff;

  if (settingsChanged) {
    const row = settingsToRow(next.settings);
    await db.runAsync(
      UPSERT_SETTINGS,
      row.id,
      row.weekend_mode,
      row.grid_orientation,
      row.academic_day_start,
      row.default_lesson_duration_minutes,
      row.default_break_duration_minutes,
      row.slot_count,
      row.default_reminder_minutes,
      row.appearance_preference,
      row.language_preference,
      row.onboarding_completed,
    );
  }

  if (termChanged) {
    const row = termToRow(next.term);
    await db.runAsync(UPSERT_TERM, row.id, row.name, row.start_date, row.estimated_end_date);
    // Exactly one term exists; the one a reset replaced has to go.
    await db.runAsync("DELETE FROM terms WHERE id <> ?", row.id);
  }

  // Children first on the way out, so a cascade never surprises us.
  await deleteByIds(db, "occurrence_exceptions", exceptions.deletedIds);
  await deleteByIds(db, "placements", placements.deletedIds);
  await deleteByIds(db, "courses", courses.deletedIds);
  await deleteByIds(db, "time_slots", timeSlots.deletedIds);

  for (const slot of timeSlots.upserts) {
    const row = timeSlotToRow(slot);
    await db.runAsync(UPSERT_TIME_SLOT, row.id, row.position, row.start_time, row.end_time);
  }

  // Parents first on the way in: a placement's course and an exception's
  // placement must already exist when the foreign key is checked.
  for (const course of courses.upserts) {
    const row = courseToRow(course);
    await db.runAsync(
      UPSERT_COURSE,
      row.id,
      row.name,
      row.room,
      row.teacher,
      row.notes,
      row.appearance_id,
      row.created_at,
      row.updated_at,
      row.deleted_at,
    );
  }

  for (const placement of placements.upserts) {
    const row = placementToRow(placement);
    await db.runAsync(
      UPSERT_PLACEMENT,
      row.id,
      row.course_id,
      row.weekday,
      row.time_slot_id,
      row.slot_span,
      row.recurrence_type,
      row.starts_on,
      row.ends_on,
      row.reminder_minutes,
      row.created_at,
      row.updated_at,
      row.deleted_at,
    );
  }

  for (const exception of exceptions.upserts) {
    const row = exceptionToRow(exception);
    await db.runAsync(
      UPSERT_EXCEPTION,
      row.id,
      row.placement_id,
      row.original_date,
      row.effective_date,
      row.state,
      row.time_slot_id,
      row.slot_span,
      row.name,
      row.room,
      row.teacher,
      row.notes,
      row.appearance_id,
      row.reminder_minutes,
      row.created_at,
      row.updated_at,
      row.deleted_at,
    );
  }

  await db.runAsync(UPSERT_META, META_KEYS.initialized, "true");
}
