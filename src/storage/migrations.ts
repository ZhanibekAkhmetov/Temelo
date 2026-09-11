/**
 * Schema versioning.
 *
 * Every schema change is a new entry in `MIGRATIONS` with the next version
 * number; nothing is ever edited in place once it has shipped, because a
 * device that already ran version N will only ever run N+1 onwards. The
 * database's own `PRAGMA user_version` is the record of how far it has got,
 * so `CREATE TABLE IF NOT EXISTS` is never load-bearing here — it is the
 * version number that decides what runs.
 */

import type { SQLiteDatabase } from "expo-sqlite";

import { repairSchema, tableColumns } from "@/storage/schema";
import { withTransaction } from "@/storage/transaction";

export interface Migration {
  /** The `user_version` the database has once this migration has run. */
  version: number;
  description: string;
  up: (db: SQLiteDatabase) => Promise<void>;
}

/**
 * Notes on the shape chosen in v1:
 *
 * - Every table is keyed by the domain's own device-generated string ID, so
 *   a row's identity is the same one the in-memory model uses and re-saving
 *   a record can never duplicate it.
 * - `deleted_at` is kept as a column rather than as a hard delete: the
 *   domain soft-deletes, and future sync needs the tombstone.
 * - Foreign keys are declared from placements to courses and from
 *   exceptions to placements, which are soft-deleted and therefore always
 *   present. `time_slot_id` deliberately carries *no* foreign key: changing
 *   the academic-day configuration replaces the whole slot set while
 *   soft-deleted placements and exceptions keep pointing at the old slots,
 *   and that is intended history, not a broken reference.
 */
const createInitialSchema: Migration = {
  version: 1,
  description: "Initial timetable schema",
  up: async (db) => {
    await db.execAsync(`
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      CREATE TABLE settings (
        id                              TEXT PRIMARY KEY NOT NULL CHECK (id = 'app'),
        weekend_mode                    TEXT NOT NULL,
        grid_orientation                TEXT NOT NULL,
        academic_day_start              TEXT NOT NULL,
        default_lesson_duration_minutes INTEGER NOT NULL,
        default_break_duration_minutes  INTEGER NOT NULL,
        slot_count                      INTEGER NOT NULL,
        onboarding_completed            INTEGER NOT NULL
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
        deleted_at      TEXT
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
        deleted_at     TEXT
      );

      CREATE INDEX idx_placements_course ON placements (course_id);
      CREATE INDEX idx_exceptions_placement ON occurrence_exceptions (placement_id);
      CREATE UNIQUE INDEX idx_time_slots_position ON time_slots (position);
    `);
  },
};

/**
 * Class reminders, which arrived after v1 had already shipped.
 *
 * All three columns are added nullable, so the `ALTER TABLE` statements need
 * no table rebuild and existing rows are valid the moment they land.
 *
 * The backfill values are written as literals rather than imported from
 * `domain/reminder`. A migration has to keep doing what it did on the day it
 * shipped: if this read `DEFAULT_REMINDER_MINUTES` and that constant were
 * ever retuned, two devices that upgraded from v1 at different times would
 * end up with different data from the same migration.
 *
 * Why the two backfills differ:
 *
 * - `settings.default_reminder_minutes` and `placements.reminder_minutes`
 *   are filled with 30, the default a fresh install gets. Leaving them NULL
 *   would read as "None", so an upgrading user would find the reminder
 *   feature present, its default apparently set, and not one class actually
 *   reminding them.
 * - `occurrence_exceptions.reminder_minutes` is deliberately left NULL,
 *   because NULL there does not mean "no reminder" — it means "follow the
 *   series". A v1 exception never expressed an opinion about reminders, so
 *   inheriting is exactly right, and the column needs no backfill at all.
 */
const addClassReminders: Migration = {
  version: 2,
  description: "Class reminder lead times on settings, placements and exceptions",
  up: async (db) => {
    await db.execAsync(`
      ALTER TABLE settings ADD COLUMN default_reminder_minutes INTEGER;
      ALTER TABLE placements ADD COLUMN reminder_minutes INTEGER;
      ALTER TABLE occurrence_exceptions ADD COLUMN reminder_minutes TEXT;

      UPDATE settings SET default_reminder_minutes = 30;
      UPDATE placements SET reminder_minutes = 30;
    `);
  },
};

/**
 * The reminder delivery ledger: what Temelo has already done about each
 * concrete occurrence's reminder.
 *
 * This is bookkeeping, not timetable data, and deliberately not a mirror of
 * the OS. It never records what Android is holding, whether a notification
 * was seen, or what permission is granted — those are the platform's to
 * answer and are still read live. It records only the one thing the platform
 * cannot tell us after a reboot: whether *we* already dealt with this
 * occurrence.
 *
 * Keyed by the reminder key alone — placement, occurrence date and course,
 * built by `planReminders` from the same stable occurrence identity the grid
 * uses. One row per occurrence, because "this occurrence has already
 * reminded" has to survive the reminder's moment being changed by a later
 * move or edit; `remind_at` rides along as data about that row, not as part
 * of its identity.
 *
 * No foreign key to placements. A cascade from a hard-deleted placement
 * would erase exactly the memory that stops a duplicate, and rows are
 * cheap to age out by `start_at` instead.
 */
const addReminderLedger: Migration = {
  version: 3,
  description: "Reminder delivery ledger for cross-restart deduplication",
  up: async (db) => {
    await db.execAsync(`
      CREATE TABLE reminder_deliveries (
        reminder_key TEXT PRIMARY KEY NOT NULL,
        remind_at    INTEGER NOT NULL,
        start_at     INTEGER NOT NULL,
        state        TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE INDEX idx_reminder_deliveries_start_at ON reminder_deliveries (start_at);
    `);
  },
};

/**
 * Theming, language and per-class colour, which all arrived together.
 *
 * Three unrelated-looking columns and one data rewrite, in one migration
 * because they ship in one release and a device must never end up having run
 * two of the three.
 *
 * Why each is shaped the way it is:
 *
 * - `settings.appearance_preference` and `settings.language_preference` store
 *   the user's *preference* — 'system' | 'light' | 'dark', and 'system' |
 *   'en' | 'ru' | 'de'. Never the scheme or language it currently resolves
 *   to: a device that later switches to dark must find Temelo still set to
 *   "follow me", not pinned to the light it happened to be on today. Both are
 *   backfilled to 'system', which is the default a fresh install gets, so an
 *   upgrading user's app looks and reads exactly as it did before the upgrade
 *   until they say otherwise.
 *
 * - `occurrence_exceptions.appearance_id` is added nullable and is *not*
 *   backfilled, for the same reason v2 left the exceptions' reminder alone:
 *   NULL there does not mean "no colour", it means "follow the course". A v3
 *   exception never expressed an opinion about colour, so inheriting is
 *   exactly right.
 *
 * - The `UPDATE courses` statements move the two palette ids that no longer
 *   exist onto their nearest surviving hue. The literals are written out
 *   rather than imported from `domain/classColor`: a migration has to keep
 *   doing what it did the day it shipped, and a later retune of the palette
 *   must not change what a device upgrading from v3 next year ends up with.
 *   Every other v3 id — blue, red, amber, teal, magenta — survives into the
 *   new palette unchanged and needs no statement at all.
 *
 * All three columns are nullable additions, so no table is rebuilt and every
 * existing row is valid the moment the ALTERs land.
 */
const addAppearanceLanguageAndClassColour: Migration = {
  version: 4,
  description: "Appearance and language preferences, and per-occurrence class colour",
  up: async (db) => {
    await db.execAsync(`
      ALTER TABLE settings ADD COLUMN appearance_preference TEXT;
      ALTER TABLE settings ADD COLUMN language_preference TEXT;
      ALTER TABLE occurrence_exceptions ADD COLUMN appearance_id TEXT;

      UPDATE settings SET appearance_preference = 'system', language_preference = 'system';

      UPDATE courses SET appearance_id = 'green'  WHERE appearance_id = 'emerald';
      UPDATE courses SET appearance_id = 'purple' WHERE appearance_id = 'violet';
    `);
  },
};

/**
 * Schema convergence, for databases whose version number is not a reliable
 * description of their shape.
 *
 * `user_version` is only trustworthy while this app is the only thing that has
 * ever written it. A development device that ran an *abandoned* branch which
 * defined its own version 4 reports 4, so `migrateToLatest` skips the version 4
 * above — correctly, by its own rules — and the columns it would have added are
 * never created. Reads survive that (`SELECT *`, then a normalising mapper);
 * writes do not, because they name their columns, and the first failure poisons
 * every later write in the session. The app then looks healthy until it is
 * restarted, at which point everything done in that session is gone.
 *
 * So this migration does not repeat version 4's statements — re-running an
 * `ALTER TABLE ADD COLUMN` would fail with "duplicate column name" on every
 * database that took the ordinary path. It asks the database what it actually
 * has and adds only what is missing, which makes both routes end at the same
 * schema:
 *
 *     v3 -> v4 -> v5      the ordinary upgrade; v5 finds nothing to do
 *     abandoned v4 -> v5  the repair; v5 adds whatever that branch lacked
 *     fresh install       v1..v4 then v5, again with nothing to do
 *
 * The two `UPDATE courses` statements are version 4's data step, repeated here
 * because a database that skipped version 4 never ran them. They are written as
 * literals for the usual reason, and they match nothing on a database that did
 * run version 4, so repeating them costs one scan and changes no row. The same
 * pair is applied to `occurrence_exceptions`, whose colour override column did
 * not exist when version 4's data step was written.
 *
 * Nothing here deletes, rebuilds or resets anything. Columns an abandoned
 * branch added on its own are left alone: we cannot know what they held, and
 * dropping a user's data to tidy up the schema is not a repair.
 */
const convergeSchemaAfterExperimentalBranches: Migration = {
  version: 5,
  description: "Converge appearance, language and class-colour columns however the database got here",
  up: async (db) => {
    await repairSchema(db);

    await db.execAsync(`
      UPDATE courses SET appearance_id = 'green'  WHERE appearance_id = 'emerald';
      UPDATE courses SET appearance_id = 'purple' WHERE appearance_id = 'violet';

      UPDATE occurrence_exceptions SET appearance_id = 'green'  WHERE appearance_id = 'emerald';
      UPDATE occurrence_exceptions SET appearance_id = 'purple' WHERE appearance_id = 'violet';
    `);
  },
};

/**
 * The timetable lifecycle: one active timetable, any number of archived ones,
 * and no semester dates anywhere.
 *
 * This is a product change before it is a schema change, so it is worth being
 * precise about what it does to a database that already has a user's real
 * timetable in it. Three things, and nothing else:
 *
 * 1. Two new tables. `active_timetable` holds the one timetable the working
 *    tables belong to — a `singleton` primary key `CHECK`ed to one value, so
 *    "at most one active timetable" is enforced by SQLite rather than by us,
 *    and *no* row is the real state of a user who archived their only one.
 *    `archived_timetables` holds each archived timetable as one versioned JSON
 *    snapshot; see `storage/snapshot` for why a snapshot rather than a
 *    `timetable_id` column on all six working tables.
 *
 * 2. The existing term becomes the active timetable. Its name carries over
 *    when it has one, and its `start_date` becomes the timetable's internal
 *    anchor — so every weekly class keeps starting exactly where it started
 *    and no alternating class changes which weeks it falls on.
 *
 * 3. The global end date stops governing recurrence. Any repeating placement
 *    whose `ends_on` reached the term's estimated end is opened to
 *    `9999-12-31`, the open-ended sentinel, because that end date was never
 *    the user's decision — it was a guess the old onboarding made them type,
 *    and leaving it in place is precisely the "classes secretly stop in
 *    December" bug this release exists to remove.
 *
 * What it deliberately does *not* do:
 *
 * - It does not touch a repeating placement whose `ends_on` is *earlier* than
 *   the term's end. That is either the earlier half of a series a "this and
 *   future" edit split, where the end date is load-bearing and rewriting it
 *   would resurrect occurrences the user deliberately changed, or a date the
 *   user set themselves. Both are real data.
 * - It does not touch one-off placements at all. A one-off's `ends_on` is its
 *   own single day, and opening it would turn one lesson into an infinite one.
 * - It does not drop the `terms` table, or `settings.onboarding_completed`.
 *   Nothing reads `terms` any more, and that is the point: the product stops
 *   depending on it without a rewrite of a table that still holds the only
 *   copy of the name and anchor this migration derived from. `DROP TABLE` here
 *   would buy tidiness and risk the one thing that must not go wrong.
 * - It creates nothing for a database that has never held a timetable. A fresh
 *   install has no `settings` row, so there is no term to convert, and it goes
 *   into the creation flow with `active_timetable` legitimately empty.
 *
 * Every literal is written out rather than imported, as in every migration
 * here: `OPEN_ENDED_DATE` and the default name may be retuned later, and two
 * devices upgrading at different times must still get the same data out of
 * this one statement.
 */
const addTimetableLifecycle: Migration = {
  version: 6,
  description: "Active timetable and archived timetable snapshots; recurrence no longer bounded by a term",
  up: async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS active_timetable (
        singleton   TEXT PRIMARY KEY NOT NULL CHECK (singleton = 'active'),
        id          TEXT NOT NULL,
        name        TEXT NOT NULL,
        anchor_date TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS archived_timetables (
        id             TEXT PRIMARY KEY NOT NULL,
        name           TEXT NOT NULL,
        archived_at    TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        format_version INTEGER NOT NULL,
        snapshot       TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_archived_timetables_archived_at
        ON archived_timetables (archived_at);
    `);

    /*
     * The term, promoted.
     *
     * Read rather than assumed: a database that never completed onboarding has
     * no term row, and one that never opened at all has no settings row
     * either. Both are left with no active timetable, which is exactly what
     * sends them into the creation flow.
     *
     * A blank term name becomes "My timetable". The old seed deliberately left
     * the name empty rather than writing an English string into a Russian
     * user's database, and onboarding then prefilled a translated suggestion —
     * so a name is empty here only if the user got past that screen without
     * one. An English fallback in the database is the lesser evil against a
     * timetable with no name at all, and it is only ever written when there is
     * nothing to overwrite.
     */
    const term = await db.getFirstAsync<{
      id: string;
      name: string;
      start_date: string;
      estimated_end_date: string;
    }>("SELECT id, name, start_date, estimated_end_date FROM terms ORDER BY rowid LIMIT 1");

    const settings = await db.getFirstAsync<{ id: string }>("SELECT id FROM settings WHERE id = 'app'");

    if (!term || !settings) return;

    const name = term.name.trim() === "" ? "My timetable" : term.name;
    const now = new Date().toISOString();

    await db.runAsync(
      `INSERT INTO active_timetable (singleton, id, name, anchor_date, created_at, updated_at)
       VALUES ('active', ?, ?, ?, ?, ?)
       ON CONFLICT (singleton) DO NOTHING`,
      term.id,
      name,
      term.start_date,
      now,
      now,
    );

    /*
     * The end date stops governing recurrence.
     *
     * Scoped by both conditions on purpose. `recurrence_type <> 'once'` keeps
     * single lessons finite; `ends_on >= the term's estimated end` opens only
     * the series that were running to the end of the term — including any the
     * user pushed past it — and leaves a split series' earlier half exactly as
     * it is.
     */
    await db.runAsync(
      `UPDATE placements
          SET ends_on = '9999-12-31', updated_at = ?
        WHERE recurrence_type <> 'once'
          AND ends_on >= ?`,
      now,
      term.estimated_end_date,
    );
  },
};

/**
 * Which series start with the timetable, and which genuinely begin on their
 * own `starts_on`.
 *
 * Until now `starts_on` was all three of: how far back a series reaches, which
 * half of the fortnight an alternating class is on, and where the later half
 * of a "this and future" split begins. Moving a timetable's start earlier
 * therefore could not bring an ordinary weekly class into the new weeks: its
 * own `starts_on` still stopped it. The fix is to let an ordinary series reach
 * back as far as the timetable does, using `starts_on` only for parity — and
 * that needs one bit per series, because the record alone cannot tell
 *
 *     weekly, starts 5 Oct — added when the timetable began on 5 Oct
 *     weekly, starts 5 Oct — the later half of a split made on 5 Oct
 *
 * apart, and the first must extend while the second must not. Deriving it
 * afresh on every read from the *other* series would make one series' dates
 * depend on edits to another, so it is stored.
 *
 * `NOT NULL DEFAULT 1`: every existing row lands as an ordinary series with no
 * table rebuild. Then two corrections, both literals as in every migration:
 *
 *  - one-offs get 0. The flag means nothing to them; 0 says so honestly.
 *  - the later half of a split gets 0, recognised by the trace a split leaves:
 *    another repeating series with a real end date between fourteen days
 *    before this one's start and twelve after, created no later than it and
 *    last updated no earlier than it was created — both halves are written in
 *    the same instant. The same rule as `inferStartsWithTimetable`, which the
 *    harness checks this against. It errs towards 0, which is exactly how
 *    every series behaved before this migration, so a mistake can only ever
 *    withhold the new behaviour, never draw a class twice.
 *
 * `starts_on` itself is not touched, so no alternating class changes weeks.
 */
const separateSeriesStartFromTimetableStart: Migration = {
  version: 7,
  description: "Placements record whether they start with the timetable or on their own date",
  up: async (db) => {
    /*
     * Asked rather than assumed. v5's convergence adds every column in
     * `REQUIRED_COLUMNS` that it finds missing — and this one is in that list,
     * so a fresh install, or any device upgrading through v5 in the same
     * launch, already has it by now. Re-adding it would fail with "duplicate
     * column name". The same reason v6 creates its tables `IF NOT EXISTS`.
     */
    if (!(await tableColumns(db, "placements")).includes("starts_with_timetable")) {
      await db.execAsync("ALTER TABLE placements ADD COLUMN starts_with_timetable INTEGER NOT NULL DEFAULT 1");
    }

    await db.execAsync(`
      UPDATE placements SET starts_with_timetable = 0 WHERE recurrence_type = 'once';

      UPDATE placements
         SET starts_with_timetable = 0
       WHERE recurrence_type <> 'once'
         AND EXISTS (
           SELECT 1
             FROM placements AS earlier
            WHERE earlier.id <> placements.id
              AND earlier.recurrence_type <> 'once'
              AND earlier.ends_on < '9999-12-31'
              AND earlier.ends_on >= date(placements.starts_on, '-14 days')
              AND earlier.ends_on <= date(placements.starts_on, '+12 days')
              AND earlier.created_at <= placements.created_at
              AND earlier.updated_at >= placements.created_at
         );
    `);
  },
};

export const MIGRATIONS: Migration[] = [
  createInitialSchema,
  addClassReminders,
  addReminderLedger,
  addAppearanceLanguageAndClassColour,
  convergeSchemaAfterExperimentalBranches,
  addTimetableLifecycle,
  separateSeriesStartFromTimetableStart,
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);

export async function readSchemaVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  return row?.user_version ?? 0;
}

/**
 * Brings the database up to `LATEST_SCHEMA_VERSION`.
 *
 * Each migration runs inside its own transaction together with the bump of
 * `user_version`, so an interrupted upgrade leaves the database at the last
 * version that fully completed rather than half-way through one.
 */
export async function migrateToLatest(db: SQLiteDatabase): Promise<number> {
  let version = await readSchemaVersion(db);

  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;

    // Same-connection transaction on purpose: `withExclusiveTransactionAsync`
    // opens a second connection, and `PRAGMA foreign_keys` is per-connection,
    // so a migration run there would silently lose the constraint checking the
    // opening code just switched on.
    //
    // Through the connection's own queue, like every other transaction in the
    // app: migrations run before the handle is shared, so nothing can be
    // racing them today, but a `BEGIN` that is not serialized is exactly the
    // bug `storage/transaction` exists to make unrepresentable.
    await withTransaction(db, async () => {
      await migration.up(db);
      // PRAGMA takes no bound parameters; the value is a number literal from
      // this module, never user input.
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
  }

  return version;
}
