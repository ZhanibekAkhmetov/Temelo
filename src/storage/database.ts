/**
 * Opening the Temelo database.
 *
 * This is the only place that knows the database's name or its connection
 * settings. Everything above it takes an already-open, already-migrated
 * handle, so the repository never has to wonder what state the connection
 * is in.
 */

import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { LATEST_SCHEMA_VERSION, migrateToLatest } from "@/storage/migrations";
import { findMissingColumns, findMissingTables, repairSchema } from "@/storage/schema";
import { runSerialized } from "@/storage/transaction";

export const DATABASE_NAME = "temelo.db";

export interface OpenedDatabase {
  db: SQLiteDatabase;
  schemaVersion: number;
  /**
   * Columns the post-migration guard had to add, as "table.column". Empty on
   * every ordinary launch; non-empty only on a database whose version number
   * was ahead of its actual shape.
   */
  repairedColumns: string[];
}

/**
 * Opens the database, applies the connection settings, and migrates it.
 *
 * - WAL keeps a write from blocking the read that the grid is doing, and
 *   survives the app being killed mid-write far better than the rollback
 *   journal does — which is the failure this whole milestone is about.
 * - `foreign_keys` is off by default in SQLite and is per-connection, so it
 *   has to be switched on here, on the connection everything else uses.
 * - `busy_timeout` turns the rare concurrent-write moment into a short wait
 *   instead of an immediate SQLITE_BUSY.
 *
 * Both pragmas are set *before* migrating, so the very first schema creation
 * already runs under them.
 */
export async function openTemeloDatabase(): Promise<OpenedDatabase> {
  const db = await openDatabaseAsync(DATABASE_NAME);

  // journal_mode is persistent, the others are per-connection; setting all
  // three on every open is cheap and keeps the two cases indistinguishable.
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  const schemaVersion = await migrateToLatest(db);

  /*
   * The last line of defence, and the only one that survives a version number
   * we did not write.
   *
   * Migration v5 repairs a database reporting version 4. It cannot repair one
   * reporting 5 or higher — `migrateToLatest` runs nothing at all there, by
   * design — and an abandoned branch is free to have bumped the version as far
   * as it liked. That is precisely the situation where every write fails while
   * every read succeeds, so it is worth one `PRAGMA table_info` per launch to
   * rule out.
   *
   * A no-op on every ordinary launch: after the migrations have run, nothing is
   * missing, and this costs three pragma reads and returns an empty list.
   *
   * Deliberately outside the migration transaction and deliberately not
   * bumping `user_version`. It is not a schema *change*, it is an assertion
   * that the schema matches what the writes assume; claiming a version for it
   * would be inventing history the database does not have.
   */
  const missingColumns = await findMissingColumns(db);
  const missingTables = await findMissingTables(db);
  // Through the connection's queue, not inside a transaction: `ALTER TABLE` and
  // `CREATE TABLE` are each their own atomic unit, and `repairSchema` is also
  // called from migration v5, which already holds the queue — taking it again
  // in there would deadlock.
  const repaired =
    missingColumns.length > 0 || missingTables.length > 0
      ? await runSerialized(db, () => repairSchema(db))
      : { addedColumns: [], addedTables: [] };
  const repairedColumns = [...repaired.addedTables, ...repaired.addedColumns];

  if (repairedColumns.length > 0) {
    console.warn(
      `[temelo/storage] the database reported schema version ${schemaVersion} but was missing ${repairedColumns.join(", ")}; added them so writes can succeed. This usually means another build wrote this file.`,
    );
  }

  return { db, schemaVersion, repairedColumns };
}

export { LATEST_SCHEMA_VERSION };
