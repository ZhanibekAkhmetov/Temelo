/**
 * Create, archive, restore, rename, delete.
 *
 * Everything here is a *swap*, and every swap is one transaction. That is the
 * whole design and it is the reason this module exists separately from
 * `timetableRepository`: an ordinary save is a diff against what the app was
 * showing a moment ago, and these are not diffs. Creating a new timetable
 * while one is active means the old one is archived and the new one activated,
 * and there must be no instant — not even inside SQLite — at which the old one
 * has been cleared and the new one has not landed.
 *
 * So each operation below:
 *
 *  - reads and validates everything it needs *before* it destroys anything.
 *    A restore parses its snapshot first, so a malformed archive is declined
 *    with the active timetable untouched rather than discovered half-way
 *    through replacing it.
 *  - does all its writes in one `withTransaction`, which is serialized against
 *    every other writer on the connection (see `storage/transaction`), so the
 *    timetable save queue and the reminder ledger cannot interleave with it.
 *  - returns the state the app should now be in, read back from the database
 *    it just wrote. The caller does not reconstruct it from what it hoped
 *    happened; it is told what is actually there.
 *
 * That last point matters more than it looks. `AppStateProvider` persists by
 * diffing against a baseline, and these operations write behind its back — so
 * they hand back a `PersistedTimetable` that becomes both the new state and
 * the new baseline, which is exactly what hydration does. Anything less and
 * the next ordinary edit would be diffed against a timetable that is no longer
 * there.
 */

import type { SQLiteDatabase } from "expo-sqlite";

import { createId } from "@/domain/id";
import { nextDefaultTimetableName } from "@/domain/timetableName";
import {
  courseToRow,
  exceptionToRow,
  placementToRow,
  timeSlotToRow,
  ACTIVE_TIMETABLE_ROW_ID,
  type ArchivedTimetableRow,
} from "@/storage/records";
import {
  buildTimetableSnapshot,
  parseTimetableSnapshot,
  serializeTimetableSnapshot,
  settingsWithTimetableSettings,
  summarizeTimetableSnapshot,
  timetableSettingsOf,
  type TimetableSnapshot,
  type TimetableSnapshotSummary,
} from "@/storage/snapshot";
import { cloneSnapshotWithFreshIds } from "@/storage/timetableFile";
import {
  loadTimetable,
  markInitializedWithin,
  upsertSettingsWithin,
  type PersistedTimetable,
} from "@/storage/timetableRepository";
import { withTransaction } from "@/storage/transaction";
import type { Settings, TimeSlot, Timetable, TimetableSettings } from "@/types/models";

/* ------------------------------------------------------------------- names */

/**
 * The longest a timetable name may be.
 *
 * Counted in code points, not UTF-16 units, so "🎓" costs one and a Cyrillic
 * or German name is not penalised for being spelled in its own alphabet.
 * Generous rather than tight: the name is a label the user chooses, and the
 * only real requirement is that it cannot become unbounded.
 */
export const MAX_TIMETABLE_NAME_LENGTH = 60;

/** The name a timetable would be stored under, or null if it is not a name. */
export function normalizeTimetableName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const points = [...trimmed];
  return points.length <= MAX_TIMETABLE_NAME_LENGTH ? trimmed : points.slice(0, MAX_TIMETABLE_NAME_LENGTH).join("");
}

/* ----------------------------------------------------------------- reading */

/**
 * What the Timetables list shows for one archived timetable.
 *
 * Deliberately not the snapshot. A list row needs a name, a date and a line
 * about the shape of the day; handing screens the whole parsed timetable would
 * invite them to read a class out of an archive, which is the one thing
 * archived data must never be used for.
 *
 * `contents` is null when the snapshot cannot be read at all. The row still
 * appears — with its name and the day it was archived, both of which are
 * columns — so the user can rename or delete it. It simply cannot be restored,
 * and `Restore` says so rather than failing when pressed.
 */
export interface ArchivedTimetableSummary {
  id: string;
  name: string;
  /** ISO timestamp. */
  archivedAt: string;
  createdAt: string;
  contents: TimetableSnapshotSummary | null;
}

function summaryOf(row: ArchivedTimetableRow): ArchivedTimetableSummary {
  const parsed = parseTimetableSnapshot(row.snapshot);
  return {
    id: row.id,
    name: row.name,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    contents: parsed.ok ? summarizeTimetableSnapshot(parsed.snapshot) : null,
  };
}

/** Every archived timetable, most recently archived first. */
export async function listArchivedTimetables(db: SQLiteDatabase): Promise<ArchivedTimetableSummary[]> {
  const rows = await db.getAllAsync<ArchivedTimetableRow>(
    "SELECT * FROM archived_timetables ORDER BY archived_at DESC, rowid DESC",
  );
  return rows.map(summaryOf);
}

/**
 * One archived timetable's snapshot, validated, for export.
 *
 * The row's `name` is applied on the way out, for the same reason
 * `restoreArchivedTimetable` applies it on the way in: renaming an archive
 * updates the column and deliberately does not rewrite the snapshot, so the
 * column is the name. Without this, exporting a timetable the user had renamed
 * would quietly hand their friend the old name.
 *
 * A read, so it is not queued behind the write queue and takes no transaction.
 * The failure shapes are the archive-reading ones the rest of this module
 * already uses, so a caller has one vocabulary rather than two.
 */
export async function readArchivedSnapshotRow(
  db: SQLiteDatabase,
  archiveId: string,
): Promise<{ ok: true; snapshot: TimetableSnapshot } | { ok: false; reason: LifecycleFailure }> {
  const row = await db.getFirstAsync<ArchivedTimetableRow>(
    "SELECT * FROM archived_timetables WHERE id = ?",
    archiveId,
  );
  if (!row) return { ok: false, reason: { kind: "archiveNotFound" } };

  const parsed = parseTimetableSnapshot(row.snapshot);
  if (!parsed.ok) return { ok: false, reason: { kind: "archiveUnreadable", detail: parsed.reason } };

  return {
    ok: true,
    snapshot: { ...parsed.snapshot, timetable: { ...parsed.snapshot.timetable, name: row.name } },
  };
}

export async function countArchivedTimetables(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM archived_timetables");
  return row?.count ?? 0;
}

/* ----------------------------------------------------------------- results */

/**
 * Every lifecycle operation's result: what the app should now hold, or why
 * nothing happened.
 *
 * A failure is a value rather than an exception because every one of these is
 * reachable from a button, and "the archive is damaged" is something to tell
 * the user, not something to crash on. A genuinely unexpected SQLite failure
 * still throws — the caller's `catch` is what reports that the change was not
 * saved, exactly as it does for an ordinary write.
 */
export type LifecycleResult =
  | { ok: true; state: PersistedTimetable }
  | { ok: false; reason: LifecycleFailure };

export type LifecycleFailure =
  /** There was no active timetable to archive or rename. */
  | { kind: "noActiveTimetable" }
  /** The archive named does not exist — most likely deleted on another screen. */
  | { kind: "archiveNotFound" }
  /** The archive exists but cannot be read; `detail` is for the log, not the UI. */
  | { kind: "archiveUnreadable"; detail: string }
  /** The name was empty after trimming. */
  | { kind: "nameRequired" };

/* ---------------------------------------------------------- writing inside */

/**
 * The current timetable, as a snapshot row, written into the archive.
 *
 * Caller-owned transaction on purpose: this is never the whole of an
 * operation. Archiving is this plus clearing; creating is this plus writing
 * the new one; restoring is this plus reading another back.
 */
async function archiveWithin(
  db: SQLiteDatabase,
  state: PersistedTimetable,
  timetable: Timetable,
  now: string,
): Promise<void> {
  const snapshot = buildTimetableSnapshot({
    timetable,
    settings: timetableSettingsOf(state.settings),
    timeSlots: state.timeSlots,
    courses: state.courses,
    placements: state.placements,
    exceptions: state.exceptions,
  });

  await db.runAsync(
    `INSERT INTO archived_timetables (id, name, archived_at, created_at, format_version, snapshot)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       archived_at = excluded.archived_at,
       created_at = excluded.created_at,
       format_version = excluded.format_version,
       snapshot = excluded.snapshot`,
    timetable.id,
    timetable.name,
    now,
    timetable.createdAt,
    snapshot.formatVersion,
    serializeTimetableSnapshot(snapshot),
  );
}

/**
 * Empties the working tables and removes the active-timetable row.
 *
 * Children before parents, so no statement leaves a dangling foreign key even
 * momentarily — the same ordering rule the diff writer follows, for the same
 * reason. `settings` is deliberately untouched: appearance, language and the
 * default reminder are the user's, not the timetable's.
 */
async function clearActiveWithin(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    DELETE FROM occurrence_exceptions;
    DELETE FROM placements;
    DELETE FROM courses;
    DELETE FROM time_slots;
  `);
  await db.runAsync("DELETE FROM active_timetable WHERE singleton = ?", ACTIVE_TIMETABLE_ROW_ID);
}

/** Writes a whole timetable into the freshly emptied working tables. */
async function writeActiveWithin(
  db: SQLiteDatabase,
  timetable: Timetable,
  settings: Settings,
  timeSlots: TimeSlot[],
  courses: PersistedTimetable["courses"],
  placements: PersistedTimetable["placements"],
  exceptions: PersistedTimetable["exceptions"],
): Promise<void> {
  await upsertSettingsWithin(db, settings);

  await db.runAsync(
    `INSERT INTO active_timetable (singleton, id, name, anchor_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ACTIVE_TIMETABLE_ROW_ID,
    timetable.id,
    timetable.name,
    timetable.anchorDate,
    timetable.createdAt,
    timetable.updatedAt,
  );

  for (const slot of timeSlots) {
    const row = timeSlotToRow(slot);
    await db.runAsync(
      "INSERT INTO time_slots (id, position, start_time, end_time) VALUES (?, ?, ?, ?)",
      row.id,
      row.position,
      row.start_time,
      row.end_time,
    );
  }

  // Parents before children, so every foreign key is satisfiable when checked.
  for (const course of courses) {
    const row = courseToRow(course);
    await db.runAsync(
      `INSERT INTO courses (id, name, room, teacher, notes, appearance_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  for (const placement of placements) {
    const row = placementToRow(placement);
    await db.runAsync(
      `INSERT INTO placements (
         id, course_id, weekday, time_slot_id, slot_span, recurrence_type,
         starts_on, ends_on, starts_with_timetable, reminder_minutes, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.course_id,
      row.weekday,
      row.time_slot_id,
      row.slot_span,
      row.recurrence_type,
      row.starts_on,
      row.ends_on,
      row.starts_with_timetable,
      row.reminder_minutes,
      row.created_at,
      row.updated_at,
      row.deleted_at,
    );
  }

  for (const exception of exceptions) {
    const row = exceptionToRow(exception);
    await db.runAsync(
      `INSERT INTO occurrence_exceptions (
         id, placement_id, original_date, effective_date, state, time_slot_id,
         slot_span, name, room, teacher, notes, appearance_id, reminder_minutes,
         created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  await markInitializedWithin(db);
}

/**
 * The state the app should now hold, read back from the database.
 *
 * Inside the transaction, before it commits, so the value handed to the caller
 * is the one the commit is about to make true — and if the read itself fails,
 * the whole operation rolls back rather than leaving the app describing a
 * timetable it never confirmed.
 */
async function readBackWithin(db: SQLiteDatabase): Promise<PersistedTimetable> {
  const state = await loadTimetable(db);
  if (!state) {
    // `settings` is written by every path that reaches here, so this is a
    // genuine invariant failure rather than a state to handle.
    throw new Error("[temelo/storage] the timetable could not be read back after a lifecycle change.");
  }
  return state;
}

/** Every timetable name in use: the active timetable's and each archive's. */
async function existingNamesWithin(db: SQLiteDatabase, current: PersistedTimetable): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>("SELECT name FROM archived_timetables");
  const names = rows.map((row) => row.name);
  return current.timetable ? [current.timetable.name, ...names] : names;
}

/* -------------------------------------------------------------- operations */

export interface NewTimetableInput {
  /** What the user typed. Blank is allowed: see `defaultName`. */
  name: string;
  /**
   * The word a blank name is built from, already translated — storage has no
   * languages. The number, if one is needed, is chosen here, inside the
   * transaction, against every name that exists at that moment.
   */
  defaultName: string;
  /** The timetable-specific settings the creation flow collected. */
  settings: TimetableSettings;
  /** Generated from those settings; ids already assigned. */
  timeSlots: TimeSlot[];
  /**
   * The timetable's start date, as the creation flow collected it — this
   * week's Monday unless the user chose another.
   */
  anchorDate: string;
  /** The moment, as an ISO timestamp. */
  now: string;
}

/**
 * Creates a timetable and makes it active, archiving whatever was active
 * before — both in one transaction.
 *
 * The ordering is the guarantee the user was promised when they started the
 * flow: their current timetable is archived *because* the new one succeeded,
 * so cancelling the flow (which simply never calls this) leaves everything
 * exactly as it was, and a failure anywhere in here leaves the old timetable
 * active rather than archived-and-replaced-by-nothing.
 */
export async function createTimetable(
  db: SQLiteDatabase,
  current: PersistedTimetable,
  input: NewTimetableInput,
): Promise<LifecycleResult> {
  const typed = normalizeTimetableName(input.name);
  const fallback = normalizeTimetableName(input.defaultName);
  if (!typed && !fallback) return { ok: false, reason: { kind: "nameRequired" } };

  const settings: Settings = {
    ...settingsWithTimetableSettings(current.settings, input.settings),
    // The one app-global flag this flow sets: the app has now been set up at
    // least once, and archiving every timetable later must not undo that.
    onboardingCompleted: true,
  };

  const state = await withTransaction(db, async () => {
    /*
     * A generated name is chosen here, in the same transaction that creates
     * the timetable, against every name that exists right now — the active
     * one and each archive. Chosen any earlier, it could be taken by the time
     * it was used; chosen outside the transaction, two creations could pick
     * the same number.
     */
    const name = typed ?? nextDefaultTimetableName(fallback ?? "", await existingNamesWithin(db, current));
    const timetable: Timetable = {
      id: createId(),
      name,
      anchorDate: input.anchorDate,
      createdAt: input.now,
      updatedAt: input.now,
    };

    if (current.timetable) await archiveWithin(db, current, current.timetable, input.now);
    await clearActiveWithin(db);
    await writeActiveWithin(db, timetable, settings, input.timeSlots, [], [], []);
    return readBackWithin(db);
  });

  return { ok: true, state };
}

/**
 * Archives the active timetable and leaves none active.
 *
 * The classes are not deleted and the archive is written before the working
 * tables are cleared, inside the same transaction — so there is no ordering of
 * events, and no crash, in which the timetable is gone from both places.
 */
export async function archiveActiveTimetable(
  db: SQLiteDatabase,
  current: PersistedTimetable,
  now: string,
): Promise<LifecycleResult> {
  const timetable = current.timetable;
  if (!timetable) return { ok: false, reason: { kind: "noActiveTimetable" } };

  const state = await withTransaction(db, async () => {
    await archiveWithin(db, current, timetable, now);
    await clearActiveWithin(db);
    return readBackWithin(db);
  });

  return { ok: true, state };
}

/**
 * Makes an archived timetable the active one, archiving the current one first
 * if there is one.
 *
 * The snapshot is read and validated *outside* the transaction, before
 * anything is touched. That is what makes a damaged archive harmless: it is
 * declined here, with the active timetable still active and not one row
 * written. Validating inside the transaction would also be correct — the
 * rollback would undo it — but "correct because it rolls back" is a much
 * weaker promise than "never started".
 */
export async function restoreArchivedTimetable(
  db: SQLiteDatabase,
  current: PersistedTimetable,
  archiveId: string,
  now: string,
): Promise<LifecycleResult> {
  const row = await db.getFirstAsync<ArchivedTimetableRow>(
    "SELECT * FROM archived_timetables WHERE id = ?",
    archiveId,
  );
  if (!row) return { ok: false, reason: { kind: "archiveNotFound" } };

  const parsed = parseTimetableSnapshot(row.snapshot);
  if (!parsed.ok) return { ok: false, reason: { kind: "archiveUnreadable", detail: parsed.reason } };
  const snapshot = parsed.snapshot;

  /*
   * The row's `name` wins over the snapshot's.
   *
   * Renaming an archived timetable updates the column — it is the only field
   * of an archive that is editable, and rewriting the whole snapshot to change
   * one string would be a needless rewrite of the data we are trying hardest
   * not to disturb. So on the way back in, the column is the name.
   */
  const timetable: Timetable = { ...snapshot.timetable, name: row.name, updatedAt: now };
  const settings = settingsWithTimetableSettings(current.settings, snapshot.settings);

  const state = await withTransaction(db, async () => {
    if (current.timetable) await archiveWithin(db, current, current.timetable, now);
    await clearActiveWithin(db);
    await writeActiveWithin(
      db,
      timetable,
      settings,
      snapshot.timeSlots,
      snapshot.courses,
      snapshot.placements,
      snapshot.exceptions,
    );
    // It is the active timetable now, so it is no longer in the archive. Last,
    // so that a failure at any earlier point leaves the archive intact.
    await db.runAsync("DELETE FROM archived_timetables WHERE id = ?", archiveId);
    return readBackWithin(db);
  });

  return { ok: true, state };
}

/**
 * Renames an archived timetable.
 *
 * One column, and not the snapshot — see the note in `restoreArchivedTimetable`
 * about which of the two the name comes from on the way back.
 */
export async function renameArchivedTimetable(
  db: SQLiteDatabase,
  archiveId: string,
  rawName: string,
): Promise<{ ok: true } | { ok: false; reason: LifecycleFailure }> {
  const name = normalizeTimetableName(rawName);
  if (!name) return { ok: false, reason: { kind: "nameRequired" } };

  const changed = await withTransaction(db, async () => {
    const row = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM archived_timetables WHERE id = ?",
      archiveId,
    );
    if (!row) return false;
    await db.runAsync("UPDATE archived_timetables SET name = ? WHERE id = ?", name, archiveId);
    return true;
  });

  return changed ? { ok: true } : { ok: false, reason: { kind: "archiveNotFound" } };
}

/**
 * "Delete all data": every timetable, active and archived, and the settings
 * back to what a fresh install has.
 *
 * A lifecycle operation rather than an ordinary save, for the reason the whole
 * module exists: an empty `AppState` diffed against the previous one empties
 * the working tables correctly but has no way to *remove* the
 * `active_timetable` row — the diff writer deliberately never deletes it —
 * and no way to reach `archived_timetables` at all, which app state does not
 * model. The result would be a database claiming an active timetable with no
 * periods in it, and a list of archives the user had asked to delete.
 *
 * `settings` is passed in rather than imported from `state/defaults`, so that
 * storage still knows nothing about the layer above it.
 */
export async function deleteAllTimetableData(
  db: SQLiteDatabase,
  settings: Settings,
): Promise<PersistedTimetable> {
  return withTransaction(db, async () => {
    await clearActiveWithin(db);
    await db.execAsync("DELETE FROM archived_timetables");
    await upsertSettingsWithin(db, settings);
    return readBackWithin(db);
  });
}

/**
 * Deletes an archived timetable permanently.
 *
 * Only an archived one. There is no path from here to the active timetable,
 * which is deliberate: the three actions — archive, restore, delete — are
 * distinct, and the destructive one cannot be aimed at the timetable the user
 * is currently using.
 */
export async function deleteArchivedTimetable(
  db: SQLiteDatabase,
  archiveId: string,
): Promise<{ ok: true } | { ok: false; reason: LifecycleFailure }> {
  const deleted = await withTransaction(db, async () => {
    const row = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM archived_timetables WHERE id = ?",
      archiveId,
    );
    if (!row) return false;
    await db.runAsync("DELETE FROM archived_timetables WHERE id = ?", archiveId);
    return true;
  });

  return deleted ? { ok: true } : { ok: false, reason: { kind: "archiveNotFound" } };
}

/* ------------------------------------------------------------------ import */

/**
 * Where an imported timetable landed.
 *
 * Two outcomes, and the rule that picks between them is deliberately the
 * simplest one that cannot surprise anybody: **an import never takes the user
 * away from the timetable they are using.**
 *
 * With a timetable active, the import is added to the archive. Not because an
 * archive is where imports belong — it is where timetables that are not the
 * current one belong, which is the same shelf `archiveActiveTimetable` puts
 * things on — but because the alternative is to decide, on the user's behalf,
 * that the file they just opened matters more than the term they are half way
 * through. Restore is one tap away and is the existing, explained, confirmed
 * way to make that swap, so the import does not need its own.
 *
 * With none active, the import becomes the active timetable directly. There is
 * nothing to displace, and landing a freshly imported timetable in the archive
 * of an app showing "No timetable yet" would be a puzzle rather than a result.
 */
export type ImportDestination = "active" | "archive";

/**
 * What an import produced.
 *
 * There is deliberately no failure variant. Every way an import can be
 * *declined* — not a Temelo file, a newer format, a damaged snapshot, too
 * large — is decided by `storage/timetableFile` before this module is called,
 * with nothing written and nothing to report back from here. What is left is
 * the ordinary storage failure every writer shares: SQLite throwing, which
 * rolls the transaction back and propagates, and which the caller already has
 * a `catch` for. Inventing a `{ ok: false }` here would be a branch no code
 * path can reach, sitting in front of every call site.
 */
export interface ImportTimetableResult {
  destination: ImportDestination;
  /** The app's state after the import — unchanged when it went to the archive. */
  state: PersistedTimetable;
  /** The local id the imported timetable was given. Never the file's. */
  timetableId: string;
}

/**
 * Adds a validated snapshot to this device as a new local timetable.
 *
 * Three things make this safe to point at a file a stranger sent:
 *
 *  - **It is only ever handed a validated snapshot.** Parsing and validating a
 *    `.temelo` happens in `storage/timetableFile`, before this is called and
 *    before the user has confirmed anything, so a malformed file never reaches
 *    a transaction at all — it is declined with nothing written, which is a
 *    stronger promise than "it would have rolled back".
 *  - **Every id is replaced before the transaction opens.** See
 *    `cloneSnapshotWithFreshIds`: the clone is a pure value, computed outside
 *    the write, so the transaction's job is reduced to putting one finished
 *    thing in one place.
 *  - **It is one transaction, and it is the same one everything else here
 *    uses.** The archive path is a single `INSERT`. The activate path is the
 *    clear-and-write pair `restoreArchivedTimetable` performs, in the same
 *    order, with the same read-back — so "half an active timetable" is not a
 *    state this can produce any more than a restore can.
 *
 * `now` becomes the archive's `archived_at` (the imported-on date the list
 * shows) and the local timetable's `updatedAt`. `createdAt` is the file's:
 * a backup of a timetable made last September is a timetable made last
 * September, and rewriting that would be the app editing the user's history to
 * record its own filing.
 */
export async function importTimetableSnapshot(
  db: SQLiteDatabase,
  current: PersistedTimetable,
  snapshot: TimetableSnapshot,
  now: string,
): Promise<ImportTimetableResult> {
  /*
   * A local copy, with every id in the file replaced by one generated here.
   *
   * Outside the transaction on purpose. It cannot fail in a way the database
   * would care about, and doing it inside would hold a write lock for the
   * length of a map over every record for no benefit.
   */
  const local = cloneSnapshotWithFreshIds(snapshot, now);

  /*
   * The name is taken from the file exactly as it was validated, and is *not*
   * made unique. Two timetables called "Timetable1" — a friend's and mine — is
   * a thing the Timetables screen has always been able to draw, and renaming
   * somebody's timetable because a name was taken would be a worse answer to a
   * problem the user does not have. `nextDefaultTimetableName` exists for the
   * one case that genuinely needs a free number: a *blank* name at creation.
   */
  const name = normalizeTimetableName(local.timetable.name) ?? local.timetable.name;
  const timetable: Timetable = { ...local.timetable, name };

  if (current.timetable) {
    const state = await withTransaction(db, async () => {
      await db.runAsync(
        `INSERT INTO archived_timetables (id, name, archived_at, created_at, format_version, snapshot)
         VALUES (?, ?, ?, ?, ?, ?)`,
        timetable.id,
        timetable.name,
        now,
        timetable.createdAt,
        local.formatVersion,
        serializeTimetableSnapshot({ ...local, timetable }),
      );
      // Read back inside the transaction, exactly as every other operation
      // here does. The active timetable is untouched, and this is what proves
      // it rather than assumes it.
      return readBackWithin(db);
    });

    return { destination: "archive", state, timetableId: timetable.id };
  }

  const settings: Settings = {
    ...settingsWithTimetableSettings(current.settings, local.settings),
    /*
     * Importing a timetable into an app that has none *is* setting the app up,
     * so the same flag `createTimetable` sets is set here. Without it a user
     * who restored a backup would be sent back into the creation flow on the
     * next launch, with their imported timetable sitting behind it — the one
     * outcome a restore must not produce.
     */
    onboardingCompleted: true,
  };

  const state = await withTransaction(db, async () => {
    // `clearActiveWithin` with nothing active is four empty DELETEs; it is here
    // so that this path is literally the restore path and cannot drift from it.
    await clearActiveWithin(db);
    await writeActiveWithin(
      db,
      timetable,
      settings,
      local.timeSlots,
      local.courses,
      local.placements,
      local.exceptions,
    );
    return readBackWithin(db);
  });

  return { destination: "active", state, timetableId: timetable.id };
}
