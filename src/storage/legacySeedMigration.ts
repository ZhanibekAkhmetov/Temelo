/**
 * TEMPORARY — one-time import of the legacy in-memory seed timetable.
 *
 * ============================ HOW TO REMOVE ============================
 * This whole file, and `src/state/seed.ts` with it, is meant to be deleted
 * once the personal timetable has been confirmed to have reached the device.
 * To remove it:
 *
 *   1. Set `LEGACY_SEED_IMPORT_ENABLED` to false and ship that, or
 *   2. delete this file, delete `src/state/seed.ts`, and remove the single
 *      `importLegacySeedIfNeeded` call in `AppStateContext`. Settings'
 *      "Load sample timetable" uses `createSeedState` too, so that button
 *      goes at the same time as the seed, or gets a neutral sample.
 *
 * Nothing else in the app imports the seed, and no other code path can put
 * it into the database — a fresh install after removal simply starts at
 * onboarding, which is the intended behaviour for real users.
 * ======================================================================
 *
 * The rule this obeys: import only into a database that has never held a
 * timetable. A database that has one — even an empty one the user reset
 * themselves — is left alone, so the import cannot run twice and cannot
 * resurrect data the user deliberately cleared.
 */

import type { SQLiteDatabase } from "expo-sqlite";

import { createSeedState } from "@/state/seed";
import {
  hasStoredTimetable,
  readMeta,
  saveTimetable,
  writeMeta,
  META_KEYS,
  type PersistedTimetable,
} from "@/storage/timetableRepository";

/** The one switch that turns the legacy import off for good. */
export const LEGACY_SEED_IMPORT_ENABLED = true;

export type LegacySeedImportOutcome =
  | { imported: false; reason: "disabled" | "alreadyInitialized" | "alreadyImported" }
  | { imported: true; timetable: PersistedTimetable };

/**
 * Imports the legacy seed if — and only if — this database has never been
 * initialized.
 *
 * Two independent guards, because they answer different questions. The meta
 * flag says "this import has run here before", which stays true even if the
 * user later resets the app to empty. `hasStoredTimetable` says "something
 * already lives here", which covers the case of a database written by any
 * other path before this ever ran. Either one is enough to decline.
 *
 * The import itself goes through the ordinary `saveTimetable` transaction,
 * so it is subject to the same foreign keys and the same all-or-nothing
 * commit as every other write — a failed import leaves an untouched
 * database that the next launch will simply try again.
 */
export async function importLegacySeedIfNeeded(db: SQLiteDatabase): Promise<LegacySeedImportOutcome> {
  if (!LEGACY_SEED_IMPORT_ENABLED) return { imported: false, reason: "disabled" };

  if (await readMeta(db, META_KEYS.legacySeedImported)) {
    return { imported: false, reason: "alreadyImported" };
  }
  if (await hasStoredTimetable(db)) {
    return { imported: false, reason: "alreadyInitialized" };
  }

  const timetable = createSeedState();
  await saveTimetable(db, timetable, null);
  // Written after the import commits: if the write above threw, the flag is
  // still unset and the next launch retries rather than silently skipping.
  await writeMeta(db, META_KEYS.legacySeedImported, new Date().toISOString());

  return { imported: true, timetable };
}
