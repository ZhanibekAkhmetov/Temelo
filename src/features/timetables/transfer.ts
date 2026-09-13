/**
 * Sharing a timetable out and importing one in, as two hooks.
 *
 * This is the one place the layers meet: `state/AppStateContext` owns the
 * database, `storage/timetableFile` owns what a `.temelo` is,
 * `features/timetables/importPipeline` owns what a valid one *means*, and
 * `util/timetableFiles` owns the share sheet and the picker. None of them knows
 * about the others, and none of them knows how to say "this file isn't a valid
 * Temelo timetable" — that is this module's job, and it is why the
 * failure-to-copy mapping below is written out in full rather than hidden
 * behind a default.
 *
 * Two rules the hooks enforce, both of which are the whole point of the
 * feature:
 *
 *  - **Export never mutates.** Both share paths read a snapshot and write a
 *    file. Nothing is saved, no timestamp moves, and the timetable the user is
 *    looking at is the same object afterwards.
 *  - **Import writes nothing until it is confirmed.** Choosing a file parses
 *    and validates it into a *preview*, and only `confirm` reaches the
 *    database. A file that fails any check never gets as far as a transaction,
 *    so "a malformed file causes zero database changes" is true by
 *    construction rather than by rollback.
 */

import { useCallback, useRef, useState } from "react";

import { domainError, type DomainError } from "@/domain/errors";
import { previewTimetableFile, type ImportCandidate } from "@/features/timetables/importPipeline";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState, type ImportActionResult, type SnapshotResult } from "@/state/AppStateContext";
import {
  buildValidatedTemeloFile,
  temeloFileName,
  TEMELO_FILE_MIME_TYPE,
  type TemeloFileFailure,
} from "@/storage/timetableFile";
import { pickTimetableFile, shareTimetableFile } from "@/util/timetableFiles";

/**
 * The underlying reason, in the log, where it is the only thing that would ever
 * explain the message the user saw.
 *
 * Development only: in a release build a console line helps nobody, and the
 * user has already been told the one thing they can act on.
 */
function logDetail(what: string, detail: string): void {
  if (__DEV__) console.warn(`[temelo/transfer] ${what}: ${detail}`);
}

/** Why a `.temelo` was refused, in words. */
function fileError(failure: TemeloFileFailure): DomainError {
  logDetail("a file was refused", `${failure.kind} — ${failure.detail}`);
  switch (failure.kind) {
    case "notTemelo":
      return domainError("errors.fileNotTemelo");
    case "futureVersion":
      return domainError("errors.fileFutureVersion");
    case "tooLarge":
      return domainError("errors.fileTooLarge");
    case "damaged":
      return domainError("errors.fileDamaged");
  }
}

/* ------------------------------------------------------------------- share */

export interface TimetableSharing {
  /** True while a file is being written and the sheet opened. */
  sharing: boolean;
  /**
   * Why the last attempt did not happen, or null.
   *
   * Cleared by the next attempt rather than by a dismissal, because the next
   * attempt is the only thing that changes the answer — an error the user has
   * read and is not acting on is just the last thing the screen said.
   */
  error: DomainError | null;
  /** Shares the active timetable. */
  shareActive: () => void;
  /** Shares one archived timetable. */
  shareArchive: (archiveId: string) => void;
}

/**
 * Writing a timetable to a `.temelo` and handing it to the share sheet.
 *
 * The snapshot is validated on the way out — see `buildValidatedTemeloFile` —
 * so a timetable that could not be imported anywhere is caught here, with a
 * normal error and nothing shared, rather than on the recipient's phone.
 *
 * A failure is reported as one of two sentences and never as an exception:
 * "sharing isn't available" is a fact about the device, and everything else is
 * "couldn't share this timetable", with the real cause in the development log.
 */
export function useShareTimetable(): TimetableSharing {
  const { t } = useI18n();
  const { activeTimetableSnapshot, readArchivedSnapshot } = useAppState();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<DomainError | null>(null);
  /** See the note on `inFlight` in `useImportTimetable`; same reason. */
  const inFlight = useRef(false);

  const share = useCallback(
    async (load: () => SnapshotResult | Promise<SnapshotResult>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      setSharing(true);
      try {
        const loaded = await load();
        if (!loaded.ok) {
          setError(loaded.error);
          return;
        }

        const built = buildValidatedTemeloFile(loaded.snapshot, new Date().toISOString());
        if (!built.ok) {
          // The app produced a timetable it would refuse to read back. That is
          // a defect rather than something the user did, so the log gets the
          // field name and they get the ordinary sentence.
          logDetail("this device's own timetable did not validate for export", built.failure.detail);
          setError(domainError("errors.shareFailed"));
          return;
        }

        const shared = await shareTimetableFile({
          fileName: temeloFileName(loaded.snapshot.timetable.name),
          contents: built.text,
          mimeType: TEMELO_FILE_MIME_TYPE,
          dialogTitle: t("transfer.shareDialogTitle"),
        });

        if (!shared.ok) {
          if (shared.kind === "failed") logDetail("sharing failed", shared.detail);
          setError(domainError(shared.kind === "unavailable" ? "errors.shareUnavailable" : "errors.shareFailed"));
        }
      } finally {
        inFlight.current = false;
        setSharing(false);
      }
    },
    [t],
  );

  const shareActive = useCallback(() => {
    void share(() => activeTimetableSnapshot());
  }, [share, activeTimetableSnapshot]);

  const shareArchive = useCallback(
    (archiveId: string) => {
      void share(() => readArchivedSnapshot(archiveId));
    },
    [share, readArchivedSnapshot],
  );

  return { sharing, error, shareActive, shareArchive };
}

/* ------------------------------------------------------------------ import */

export interface TimetableImporting {
  /** The chosen file, validated, awaiting confirmation. Null when there is none. */
  pending: ImportCandidate | null;
  /** True while the picker is open, or while the import is being written. */
  busy: boolean;
  /** Why the last attempt did not happen; cleared by the next one. */
  error: DomainError | null;
  /** Opens the picker. Writes nothing; may produce a `pending` or an error. */
  choose: () => void;
  /** Writes the pending import. Resolves to where it landed, or null if none. */
  confirm: () => Promise<ImportActionResult | null>;
  /** Throws the pending import away. Nothing was written, so nothing is undone. */
  cancel: () => void;
}

/**
 * Choosing a `.temelo`, checking it, and — only then — importing it.
 *
 * The two halves are deliberately separate calls. `choose` reads and validates
 * and produces a preview; `confirm` is the only thing that touches the
 * database. Between them the user can read what they are about to accept, and
 * a file that is not a Temelo timetable never gets past the first half.
 *
 * The preview also states *where* the timetable will land, and what it will be
 * *called*, because both depend on something the user may not be thinking about
 * — whether they currently have an active timetable, and whether they already
 * have one of that name — and finding out afterwards is how an import feels
 * like it went wrong even when it went right.
 *
 * Both answers are `previewTimetableFile`'s, not this hook's. That is the one
 * structural thing worth noticing here: the file another app shares into Temelo
 * goes through the same function, so there is no second idea of what a valid
 * file is or of what the copy will be named.
 */
export function useImportTimetable(): TimetableImporting {
  const { state, importTimetable, timetableNames } = useAppState();
  const [pending, setPending] = useState<ImportCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DomainError | null>(null);

  /**
   * Whether an operation is already running, as a ref rather than as the
   * `busy` state.
   *
   * `busy` is what the UI draws, and it cannot be what the guard reads: it
   * becomes true in the same batch as the tap that started the work, so the
   * button is only disabled from the *next* render. Two taps inside one frame
   * both see `busy === false`, and for import that is not a wasted call — it is
   * two transactions and two timetables, which is exactly what importing the
   * same file twice is defined to mean.
   *
   * A ref is written and read synchronously, so the second tap sees the first.
   */
  const inFlight = useRef(false);

  const hasActive = state.timetable !== null;

  const choose = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const picked = await pickTimetableFile();
        // Backing out of the picker is not an event. No error, no preview, and
        // deliberately no "cancelled" message.
        if (picked.cancelled) return;

        if (!picked.file.ok) {
          logDetail("a file could not be read", picked.file.detail);
          setError(domainError(picked.file.kind === "tooLarge" ? "errors.fileTooLarge" : "errors.fileUnreadable"));
          return;
        }

        const preview = previewTimetableFile({
          text: picked.file.text,
          hasActive,
          existingNames: await timetableNames(),
        });
        if (!preview.ok) {
          setError(fileError(preview.failure));
          return;
        }

        setPending(preview.candidate);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    })();
  }, [hasActive, timetableNames]);

  const confirm = useCallback(async () => {
    if (!pending || inFlight.current) return null;
    inFlight.current = true;
    setError(null);
    setBusy(true);
    try {
      const result = await importTimetable(pending.snapshot);
      if (!result.ok) {
        setError(result.error);
        return result;
      }
      // Only cleared on success: a failed write leaves the preview up with the
      // reason beside it, so the user can try again without picking the file a
      // second time.
      setPending(null);
      return result;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [pending, importTimetable]);

  const cancel = useCallback(() => {
    setPending(null);
    setError(null);
  }, []);

  return { pending, busy, error, choose, confirm, cancel };
}
