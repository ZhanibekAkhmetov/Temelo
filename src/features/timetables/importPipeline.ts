/**
 * Everything an import does between "here are some bytes" and "here is what
 * would happen if you said yes".
 *
 * Two doors lead to an import — the document picker, and a `.temelo` another
 * app shared into Temelo — and this is the single room they both open onto.
 * Split out of `transfer` as a plain function rather than left inside the hook
 * for two reasons, and both of them are the point of the module:
 *
 *  - **There can only be one of it.** A second way in must not be able to grow
 *    a second idea of what a valid file is, of how large is too large, or of
 *    what the imported timetable will be called. Those decisions are made here,
 *    once, and neither caller has any others to offer.
 *  - **It can be tested where it matters.** No React, no native module, no
 *    database: a string in, a preview or a refusal out. The Node harness
 *    exercises *this* function, so "a file shared into the app goes through
 *    exactly the same validator as one picked from Downloads" is something the
 *    harness proves rather than something a comment claims.
 *
 * Nothing here writes. The most it produces is a description of a timetable and
 * a snapshot that `importTimetableSnapshot` would accept — which is why a file
 * that fails any check costs one wasted parse and cannot leave a row behind.
 */

import { nextAvailableImportName } from "@/domain/timetableName";
import {
  summarizeTimetableSnapshot,
  type TimetableSnapshot,
  type TimetableSnapshotSummary,
} from "@/storage/snapshot";
import { parseTemeloFile, type TemeloFileFailure } from "@/storage/timetableFile";
import { MAX_TIMETABLE_NAME_LENGTH, type ImportDestination } from "@/storage/timetableLifecycle";

/**
 * A validated file, described the way the preview draws it.
 *
 * Everything that preview shows and nothing it does not: the name, the one-line
 * shape the Timetables list already gives every other timetable, how many
 * classes are in it, and which of the two things importing will do. No ids, no
 * versions, no record counts beyond the one a person would ask for.
 */
export interface ImportCandidate {
  /**
   * The name the local copy will be created under.
   *
   * The file's own name, unless the device already has a timetable called that
   * — in which case it is that name with the lowest free `(n)` after it, by the
   * rule in `nextAvailableImportName`. The *final* name rather than the file's,
   * so somebody importing the same timetable twice is told they are getting
   * "SoSe26 (1)" before they agree to it rather than afterwards.
   *
   * A prediction, and allowed to be one: the name actually used is chosen by
   * `importTimetableSnapshot` inside its own transaction, against the names
   * that exist at that moment. Handing that decision to the preview instead
   * would mean two imports started at once could agree on a name and both take
   * it.
   */
  name: string;
  summary: TimetableSnapshotSummary;
  /** Where it will land if confirmed — decided by whether a timetable is active. */
  destination: ImportDestination;
  /** The validated snapshot itself. Not drawn; handed to the import. */
  snapshot: TimetableSnapshot;
}

export type ImportPreviewResult =
  | { ok: true; candidate: ImportCandidate }
  | { ok: false; failure: TemeloFileFailure };

export interface ImportPreviewInput {
  /** The file's text, exactly as it was read. Treated as hostile throughout. */
  text: string;
  /** Whether a timetable is currently active, which is what picks the destination. */
  hasActive: boolean;
  /** Every timetable name on the device — the active one's and each archive's. */
  existingNames: readonly string[];
}

/**
 * A `.temelo`'s text, turned into the question the user is about to be asked.
 *
 * `parseTemeloFile` does the whole of the judging — the length bound before the
 * parse, the magic, both version numbers, the record counts, and then every
 * record and every reference through the same validator a restore uses. This
 * adds no checks of its own and skips none, which is exactly what makes a
 * shared file no more trusted than a picked one: there is no argument this
 * function takes that could loosen anything.
 *
 * The destination is a consequence of the *user's* state rather than the
 * file's: with a timetable active the import joins the archive, and with none it
 * becomes the active one. An import never displaces the timetable somebody is
 * in the middle of a term with.
 */
export function previewTimetableFile(input: ImportPreviewInput): ImportPreviewResult {
  const parsed = parseTemeloFile(input.text);
  if (!parsed.ok) return { ok: false, failure: parsed.failure };

  const snapshot = parsed.file.timetable;
  return {
    ok: true,
    candidate: {
      name: nextAvailableImportName(snapshot.timetable.name, input.existingNames, MAX_TIMETABLE_NAME_LENGTH),
      summary: summarizeTimetableSnapshot(snapshot),
      destination: input.hasActive ? "archive" : "active",
      snapshot,
    },
  };
}
