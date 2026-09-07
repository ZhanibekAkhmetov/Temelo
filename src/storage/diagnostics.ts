/**
 * Development-only visibility into what is actually on disk.
 *
 * It exists because the two most damaging storage failures are both invisible
 * from the outside: a database that quietly started empty looks exactly like
 * one that hydrated, and a database that refuses every write looks exactly
 * like one that is saving. The first is why the launch log has always printed
 * record counts; the second is why this now also reports the schema the
 * database really has, rather than the version number it claims.
 *
 * A version number is a claim about shape. `PRAGMA table_info` is the shape.
 * When another build has written the same file those two can disagree, and it
 * is the disagreement that breaks writes — so both are reported, side by side.
 */

import type { SQLiteDatabase } from "expo-sqlite";

import { DATABASE_NAME } from "@/storage/database";
import { LATEST_SCHEMA_VERSION, readSchemaVersion } from "@/storage/migrations";
import { findMissingColumns, tableColumns } from "@/storage/schema";
import { readMeta, META_KEYS } from "@/storage/timetableRepository";

export interface DatabaseDiagnostics {
  databaseName: string;
  schemaVersion: number;
  /** Whether the first save has ever happened here. */
  initializedAt: string | null;
  counts: Record<string, number>;
}

/** Everything the storage panel shows, gathered in one pass. */
export interface StorageReport extends DatabaseDiagnostics {
  /** What this build would migrate to. Differs from `schemaVersion` only mid-upgrade. */
  targetSchemaVersion: number;
  settingsColumns: string[];
  occurrenceExceptionColumns: string[];
  /**
   * Required columns still absent. Must be empty: anything here means writes
   * naming that column will fail, which is the bug this reporting exists for.
   */
  missingColumns: string[];
  /** What the post-migration guard had to add at open time, if anything. */
  repairedColumns: string[];
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

export async function readStorageReport(db: SQLiteDatabase, repairedColumns: string[]): Promise<StorageReport> {
  const missing = await findMissingColumns(db);

  return {
    ...(await readDatabaseDiagnostics(db)),
    targetSchemaVersion: LATEST_SCHEMA_VERSION,
    settingsColumns: await tableColumns(db, "settings"),
    occurrenceExceptionColumns: await tableColumns(db, "occurrence_exceptions"),
    missingColumns: missing.map((required) => `${required.table}.${required.column}`),
    repairedColumns,
  };
}

/** No-op outside development, so nothing of this reaches a production build. */
export async function logDatabaseDiagnostics(db: SQLiteDatabase): Promise<void> {
  if (!__DEV__) return;
  try {
    const report = await readStorageReport(db, []);
    console.log("[temelo/storage]", JSON.stringify(report));
    if (report.missingColumns.length > 0) {
      console.error(
        `[temelo/storage] SCHEMA MISMATCH: the database claims version ${report.schemaVersion} but is missing ${report.missingColumns.join(", ")}. Writes naming those columns will fail and nothing will be saved.`,
      );
    }
  } catch (error) {
    console.warn("[temelo/storage] diagnostics failed", error);
  }
}
