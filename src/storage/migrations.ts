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

export const MIGRATIONS: Migration[] = [createInitialSchema];

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
    await db.withTransactionAsync(async () => {
      await migration.up(db);
      // PRAGMA takes no bound parameters; the value is a number literal from
      // this module, never user input.
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
  }

  return version;
}
