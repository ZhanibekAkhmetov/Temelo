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

export const DATABASE_NAME = "temelo.db";

export interface OpenedDatabase {
  db: SQLiteDatabase;
  schemaVersion: number;
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
  return { db, schemaVersion };
}

export { LATEST_SCHEMA_VERSION };
