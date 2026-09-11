/**
 * What the write path needs the schema to actually contain, and how to make
 * that true on a database whose history we cannot reconstruct.
 *
 * `user_version` is normally a complete description of a database's shape: it
 * only ever advances by running one of our own migrations, so version N
 * implies exactly the schema migration N produced. That stops being true the
 * moment a *different* build has touched the file — an experimental branch
 * that defined its own version 4, say. Such a database reports 4, so
 * `migrateToLatest` correctly skips our version 4, and the columns that
 * migration would have added are simply never there.
 *
 * Nothing notices at read time: `loadTimetable` selects `*`, and the row
 * mappers normalise an absent field to a default. It is the *writes* that
 * break, because they name their columns — and one failed write poisons every
 * later one, which is how an app can look perfectly healthy for a whole
 * session and lose all of it on restart.
 *
 * So the required columns are declared here as data rather than being implied
 * by whichever migration happened to add them, and can be checked against the
 * database as it really is. Two callers use that: migration v5, which is the
 * ordinary repair path, and a post-migration safety net in `openTemeloDatabase`
 * for the case where the version is *ahead* of anything this build knows and
 * no migration would run at all.
 */

import type { SQLiteDatabase } from "expo-sqlite";

export interface RequiredColumn {
  table: string;
  column: string;
  /**
   * Declared type. Every one is nullable or carries a constant default, so
   * adding it never rebuilds the table and every existing row stays valid.
   */
  type: string;
}

/**
 * Every column added after v3 that the repository's INSERT and UPDATE
 * statements name by hand.
 *
 * Deliberately not "every column in the schema": v1–v3 tables are created
 * whole by a migration that cannot half-run, so a database that has them at
 * all has all of them. These three are the ones a rival version 4 could
 * plausibly have got wrong, and they are exactly the ones the write path
 * mentions.
 */
export const REQUIRED_COLUMNS: RequiredColumn[] = [
  { table: "settings", column: "appearance_preference", type: "TEXT" },
  { table: "settings", column: "language_preference", type: "TEXT" },
  { table: "occurrence_exceptions", column: "appearance_id", type: "TEXT" },
  // v7's. Named by both placement writers, so a database reporting a version
  // ahead of this build without it would refuse every save.
  { table: "placements", column: "starts_with_timetable", type: "INTEGER NOT NULL DEFAULT 1" },
];

/**
 * Whole tables the write path names, with the statement that creates each.
 *
 * The same argument as `REQUIRED_COLUMNS`, one level up. v6's two lifecycle
 * tables are the first tables added after v1, so they are the first that a
 * database reporting a version *ahead* of this build could be missing
 * altogether — and a missing table fails every archive, restore and creation,
 * which is worse than a missing column because it fails the operations whose
 * whole job is not to lose a timetable.
 *
 * `IF NOT EXISTS` rather than a check-then-create: the statement is its own
 * test, it is idempotent by construction, and unlike a column it cannot be
 * "there but wrong" in a way this could paper over.
 */
export const REQUIRED_TABLES: { table: string; create: string }[] = [
  {
    table: "active_timetable",
    create: `
      CREATE TABLE IF NOT EXISTS active_timetable (
        singleton   TEXT PRIMARY KEY NOT NULL CHECK (singleton = 'active'),
        id          TEXT NOT NULL,
        name        TEXT NOT NULL,
        anchor_date TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )`,
  },
  {
    table: "archived_timetables",
    create: `
      CREATE TABLE IF NOT EXISTS archived_timetables (
        id             TEXT PRIMARY KEY NOT NULL,
        name           TEXT NOT NULL,
        archived_at    TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        format_version INTEGER NOT NULL,
        snapshot       TEXT NOT NULL
      )`,
  },
];

/** The valid stored values, as literals — see the note in `repairSchema`. */
const VALID_APPEARANCE = "'system','light','dark'";
const VALID_LANGUAGE = "'system','en','ru','de'";

/**
 * The columns a table really has.
 *
 * `PRAGMA table_info` returns no rows for a table that does not exist, which
 * is the answer we want anyway: a missing table has no columns, and the
 * caller's `ADD COLUMN` would fail loudly rather than silently doing nothing.
 */
export async function tableColumns(db: SQLiteDatabase, table: string): Promise<string[]> {
  // The table name is a literal from `REQUIRED_COLUMNS` in this module and is
  // never user input; PRAGMA takes no bound parameters.
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((row) => row.name);
}

/** Which required tables this database does not have. Empty is healthy. */
export async function findMissingTables(db: SQLiteDatabase): Promise<string[]> {
  const missing: string[] = [];
  for (const required of REQUIRED_TABLES) {
    // A table with no columns is a table that does not exist — `PRAGMA
    // table_info` returns no rows for one, which is the answer we want.
    if ((await tableColumns(db, required.table)).length === 0) missing.push(required.table);
  }
  return missing;
}

/** Which required columns this database is missing. Empty is the healthy case. */
export async function findMissingColumns(db: SQLiteDatabase): Promise<RequiredColumn[]> {
  const byTable = new Map<string, string[]>();
  const missing: RequiredColumn[] = [];

  for (const required of REQUIRED_COLUMNS) {
    let columns = byTable.get(required.table);
    if (!columns) {
      columns = await tableColumns(db, required.table);
      byTable.set(required.table, columns);
    }
    if (!columns.includes(required.column)) missing.push(required);
  }

  return missing;
}

export interface SchemaRepairReport {
  /** "table.column" for each column that had to be added. */
  addedColumns: string[];
  /** Each whole table that had to be created. */
  addedTables: string[];
}

/**
 * Brings a database up to the shape the write path expects, whatever shape it
 * was in.
 *
 * Idempotent by construction: it asks what is there before adding anything, so
 * running it on an already-correct database does nothing at all, and running
 * it twice is the same as running it once. That is what lets the same function
 * be both a versioned migration step and an unconditional safety net.
 *
 * Existing columns are never dropped, re-added or rewritten — an abandoned
 * branch's own extra columns are left exactly where they are, because we
 * cannot know what they meant and deleting a user's data to tidy up is not a
 * repair.
 *
 * The preference normalisation only touches values that are *not* usable:
 * NULL, or a string outside the set the app can resolve. A user's real choice
 * of "dark" survives untouched — the whole point of the repair is to keep
 * their settings, not to reset them. The valid sets are written out as
 * literals rather than imported from `theme/appearance` and `i18n/language`
 * for the reason every migration does that: this has to keep doing what it did
 * the day it shipped, even if those modules later learn a new value.
 */
export async function repairSchema(db: SQLiteDatabase): Promise<SchemaRepairReport> {
  const missingTables = await findMissingTables(db);
  const missing = await findMissingColumns(db);

  // Tables first: a missing column can only be added to a table that exists.
  for (const required of REQUIRED_TABLES) {
    if (missingTables.includes(required.table)) await db.execAsync(required.create);
  }

  for (const required of missing) {
    // Identifiers are literals from `REQUIRED_COLUMNS`; nothing here is bound
    // user input. Every column is nullable, so no table is rebuilt and every
    // existing row stays valid the moment the statement lands.
    await db.execAsync(`ALTER TABLE ${required.table} ADD COLUMN ${required.column} ${required.type}`);
  }

  await db.execAsync(`
    UPDATE settings
       SET appearance_preference = 'system'
     WHERE appearance_preference IS NULL
        OR appearance_preference NOT IN (${VALID_APPEARANCE});

    UPDATE settings
       SET language_preference = 'system'
     WHERE language_preference IS NULL
        OR language_preference NOT IN (${VALID_LANGUAGE});
  `);

  return {
    addedColumns: missing.map((required) => `${required.table}.${required.column}`),
    addedTables: missingTables,
  };
}
