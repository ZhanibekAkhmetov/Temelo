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

import { repairSchema } from "@/storage/schema";
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

export const MIGRATIONS: Migration[] = [
  createInitialSchema,
  addClassReminders,
  addReminderLedger,
  addAppearanceLanguageAndClassColour,
  convergeSchemaAfterExperimentalBranches,
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
