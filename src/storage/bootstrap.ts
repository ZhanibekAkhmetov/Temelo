/**
 * Startup: open, migrate, load — in that order, once.
 *
 * The memoized promise is not an optimization. React mounts effects twice in
 * development, and any remount would otherwise start a second startup while
 * the first was still opening and migrating the database. One shared promise
 * makes that impossible regardless of how many callers ask.
 *
 * Nothing here writes. A database that has never held a timetable stays
 * empty and `timetable` comes back null, which is what sends a fresh
 * install to onboarding rather than into someone else's term.
 */

import type { SQLiteDatabase } from "expo-sqlite";

import { openTemeloDatabase } from "@/storage/database";
import { logDatabaseDiagnostics } from "@/storage/diagnostics";
import { countArchivedTimetables } from "@/storage/timetableLifecycle";
import { loadTimetable, type PersistedTimetable } from "@/storage/timetableRepository";

export interface StorageBootstrap {
  db: SQLiteDatabase;
  schemaVersion: number;
  /** Columns and tables the post-migration guard had to add; empty when healthy. */
  repairedColumns: string[];
  /**
   * Null when this database has never been written to at all — a fresh
   * install. A database that *has* been written to but currently has no active
   * timetable comes back with `timetable: null` inside this object instead;
   * the two are different states and lead to different screens.
   */
  timetable: PersistedTimetable | null;
  /** How many archived timetables the database holds. */
  archivedCount: number;
}

let bootstrapPromise: Promise<StorageBootstrap> | null = null;

async function runBootstrap(): Promise<StorageBootstrap> {
  const { db, schemaVersion, repairedColumns } = await openTemeloDatabase();
  const timetable = await loadTimetable(db);
  const archivedCount = await countArchivedTimetables(db);

  await logDatabaseDiagnostics(db);

  return { db, schemaVersion, repairedColumns, timetable, archivedCount };
}

export function bootstrapStorage(): Promise<StorageBootstrap> {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap().catch((error: unknown) => {
      // A failed startup must not be cached as the answer forever; clearing
      // it lets a remount try again instead of inheriting the failure.
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}
