/**
 * Startup: open, migrate, import-if-needed, load — in that order, once.
 *
 * The memoized promise is not an optimization. React mounts effects twice in
 * development, and any remount would otherwise start a second startup while
 * the first was still deciding whether the database was empty. Two runs that
 * both saw "empty" would both import the legacy seed, each with its own
 * freshly generated IDs, and the timetable would come back doubled. One
 * shared promise makes that impossible regardless of how many callers ask.
 */

import type { SQLiteDatabase } from "expo-sqlite";

import { openTemeloDatabase } from "@/storage/database";
import { logDatabaseDiagnostics } from "@/storage/diagnostics";
import { importLegacySeedIfNeeded } from "@/storage/legacySeedMigration";
import { loadTimetable, type PersistedTimetable } from "@/storage/timetableRepository";

export interface StorageBootstrap {
  db: SQLiteDatabase;
  schemaVersion: number;
  /** Null when this database has never held a timetable. */
  timetable: PersistedTimetable | null;
  legacySeedImported: boolean;
}

let bootstrapPromise: Promise<StorageBootstrap> | null = null;

async function runBootstrap(): Promise<StorageBootstrap> {
  const { db, schemaVersion } = await openTemeloDatabase();

  const legacy = await importLegacySeedIfNeeded(db);
  // The import already has the timetable it just wrote, so it is used
  // directly rather than read straight back out again.
  const timetable = legacy.imported ? legacy.timetable : await loadTimetable(db);

  await logDatabaseDiagnostics(db);

  return { db, schemaVersion, timetable, legacySeedImported: legacy.imported };
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
