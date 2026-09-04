/**
 * Development-only visibility into what is actually on disk.
 *
 * Deliberately has no UI. It is logged once per launch under `__DEV__` so a
 * device session shows the schema version and record counts it started with
 * — enough to tell "hydrated from storage" apart from "quietly started
 * empty", which is otherwise indistinguishable from the outside.
 */

import type { SQLiteDatabase } from "expo-sqlite";

import { DATABASE_NAME } from "@/storage/database";
import { readSchemaVersion } from "@/storage/migrations";
import { readMeta, META_KEYS } from "@/storage/timetableRepository";

export interface DatabaseDiagnostics {
  databaseName: string;
  schemaVersion: number;
  /** Whether the first save has ever happened here. */
  initializedAt: string | null;
  counts: Record<string, number>;
}

const COUNTED_TABLES = [
  "settings",
  "terms",
  "time_slots",
  "courses",
  "placements",
  "occurrence_exceptions",
  "reminder_deliveries",
] as const;

export async function readDatabaseDiagnostics(db: SQLiteDatabase): Promise<DatabaseDiagnostics> {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    // Table names are literals from this module, never user input.
    const row = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
    counts[table] = row?.count ?? 0;
  }

  return {
    databaseName: DATABASE_NAME,
    schemaVersion: await readSchemaVersion(db),
    initializedAt: await readMeta(db, META_KEYS.initialized),
    counts,
  };
}

/** No-op outside development, so nothing of this reaches a production build. */
export async function logDatabaseDiagnostics(db: SQLiteDatabase): Promise<void> {
  if (!__DEV__) return;
  try {
    const diagnostics = await readDatabaseDiagnostics(db);
    console.log("[temelo/storage]", JSON.stringify(diagnostics));
  } catch (error) {
    console.warn("[temelo/storage] diagnostics failed", error);
  }
}
