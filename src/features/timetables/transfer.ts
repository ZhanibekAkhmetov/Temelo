/**
 * Sharing a timetable out, importing one in, and exporting one to a calendar,
 * as three hooks.
 *
 * This is the one place the layers meet: `state/AppStateContext` owns the
 * database, `storage/timetableFile` owns what a `.temelo` is,
 * `storage/calendarFile` owns what an `.ics` is, `domain/calendarExport` owns
 * which meetings fall inside a date range,
 * `features/timetables/importPipeline` owns what a valid file *means*, and
 * `util/timetableFiles` owns the share sheet and the picker. None of them knows
 * about the others, and none of them knows how to say "this file isn't a valid
 * Temelo timetable" — that is this module's job, and it is why the
 * failure-to-copy mapping below is written out in full rather than hidden
 * behind a default.
 *
 * Two rules the hooks enforce, both of which are the whole point of the
 * feature:
 *
 *  - **Export never mutates.** Every export path — both share paths and the
 *    calendar one — reads a snapshot and writes a file. Nothing is saved, no
 *    timestamp moves, and the timetable the user is looking at is the same
 *    object afterwards. An archive is read, never restored.
 *  - **Import writes nothing until it is confirmed.** Choosing a file parses
 *    and validates it into a *preview*, and only `confirm` reaches the
 *    database. A file that fails any check never gets as far as a transaction,
 *    so "a malformed file causes zero database changes" is true by
 *    construction rather than by rollback.
 */

import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";

import {
  calendarOccurrencesIn,
  validateCalendarExportRange,
  type CalendarExportRange,
} from "@/domain/calendarExport";
import { domainError, type DomainError } from "@/domain/errors";
import { previewTimetableFile, type ImportCandidate } from "@/features/timetables/importPipeline";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState, type ImportActionResult, type SnapshotResult } from "@/state/AppStateContext";
import {
  buildIcsCalendar,
  calendarFileName,
  CALENDAR_FILE_MIME_TYPE,
  CALENDAR_FILE_UTI,
} from "@/storage/calendarFile";
import {
  buildValidatedTemeloFile,
  temeloFileName,
  TEMELO_FILE_MIME_TYPE,
  type TemeloFileFailure,
} from "@/storage/timetableFile";
import { openFileWithApp, pickTimetableFile, shareTimetableFile } from "@/util/timetableFiles";

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

/* --------------------------------------------------------- calendar export */

/**
 * What one attempt to export a calendar came to.
 *
 * `empty` is a first-class outcome rather than an error, because it is not one:
 * the user asked a reasonable question about a range that happens to hold no
 * classes — a summer, a gap between terms — and the answer is information, not
 * a failure. It is also the one outcome that must not reach the share sheet. An
 * `.ics` with no `VEVENT` in it is a valid file that silently imports nothing,
 * so handing it over would look exactly like a successful export right up until
 * the user went looking for their classes.
 */
export type CalendarExportOutcome =
  /** The file was written and the share sheet opened. */
  | { kind: "shared" }
  /** The file was written and handed to a calendar app. */
  | { kind: "opened" }
  /**
   * Nothing on this device offered to open a calendar file.
   *
   * Its own outcome rather than a `failed`, because it is the one failure the
   * user can do something about — the file is fine and sharing it still works
   * — and the sheet answers it by pointing at the other button rather than by
   * reporting an error.
   */
  | { kind: "noCalendarApp" }
  /** No classes in the chosen range; nothing was written or shared. */
  | { kind: "empty" }
  /** An export is already running — a second tap in the same frame. */
  | { kind: "busy" }
  | { kind: "failed"; error: DomainError };

/**
 * Which way out an export takes.
 *
 * `open` hands the file to a calendar app (`ACTION_VIEW`); `share` hands a copy
 * to whatever the user picks from the share sheet (`ACTION_SEND`). They are two
 * different Android verbs answering two different questions, not two styles of
 * the same one — see `openFileWithApp`. Everything before the hand-off is
 * identical, which is why this is a parameter rather than a second function.
 */
export type CalendarDelivery = "open" | "share";

export interface CalendarExporting {
  /** True while the file is being built and the sheet opened. */
  exporting: boolean;
  /** Exports the active timetable over a range. Defaults to sharing. */
  exportActive: (range: CalendarExportRange, how?: CalendarDelivery) => Promise<CalendarExportOutcome>;
  /** Exports one archived timetable over a range, reading it without restoring it. */
  exportArchive: (
    archiveId: string,
    range: CalendarExportRange,
    how?: CalendarDelivery,
  ) => Promise<CalendarExportOutcome>;
}

/**
 * Whether this platform can hand a file to another app to *open*.
 *
 * Android only, and the reason is not a limitation so much as a difference in
 * kind: iOS has no `ACTION_VIEW`, and its share sheet already offers Calendar
 * for a `.ics` because the file declares a system UTI. So the one button iOS
 * shows is the sharing one, and it reaches a calendar by the route iOS has.
 */
export const CAN_OPEN_IN_APP = Platform.OS === "android";

/**
 * Writing a bounded stretch of a timetable to an `.ics` and handing it to the
 * share sheet.
 *
 * The shape is the same as `useShareTimetable`'s, and for the same reason: the
 * active timetable and an archived one both arrive as a `TimetableSnapshot`, so
 * one function does both and the archive is only ever read. Nothing on this
 * path writes to the database.
 *
 * What differs is that the outcome is *returned* rather than kept in state. The
 * range sheet stays open across an attempt — a range holding no classes is
 * something the user answers by changing the dates, right there — so it needs
 * the result of the attempt it just made, not a piece of shared state it would
 * have to remember to clear.
 */
export function useExportCalendar(): CalendarExporting {
  const { t } = useI18n();
  const { activeTimetableSnapshot, readArchivedSnapshot } = useAppState();
  const [exporting, setExporting] = useState(false);
  /** See the note on `inFlight` in `useImportTimetable`; same reason. */
  const inFlight = useRef(false);

  const run = useCallback(
    async (
      load: () => SnapshotResult | Promise<SnapshotResult>,
      range: CalendarExportRange,
      how: CalendarDelivery,
    ): Promise<CalendarExportOutcome> => {
      // Before anything is loaded or written: an impossible range is a question
      // about the form, not about the timetable.
      const invalid = validateCalendarExportRange(range);
      if (invalid) return { kind: "failed", error: invalid };

      if (inFlight.current) return { kind: "busy" };
      inFlight.current = true;
      setExporting(true);
      try {
        const loaded = await load();
        if (!loaded.ok) return { kind: "failed", error: loaded.error };

        /*
         * The whole of the recurrence question, asked once, of the resolver the
         * grid draws from. Everything that makes this feature hard — parity,
         * splits, moved and deleted occurrences, the timetable's start — is
         * already decided by the time these come back. See
         * `domain/calendarExport`.
         */
        const occurrences = calendarOccurrencesIn(loaded.snapshot, range, {
          teacher: (name) => t("calendarExport.teacherLine", { name }),
        });
        if (occurrences.length === 0) return { kind: "empty" };

        /*
         * One file, built once, whichever way it leaves. The serializer, the
         * name and the resolved occurrences are identical for both deliveries —
         * only the Android verb differs — so a calendar opened directly and a
         * calendar reached through a chat app receive byte-identical files.
         */
        const fileName = calendarFileName(loaded.snapshot.timetable.name, range.from, range.to);
        const contents = buildIcsCalendar({
          calendarName: loaded.snapshot.timetable.name,
          occurrences,
          exportedAt: new Date().toISOString(),
        });

        if (how === "open") {
          const opened = await openFileWithApp({ fileName, contents, mimeType: CALENDAR_FILE_MIME_TYPE });
          if (opened.ok) return { kind: "opened" };
          if (opened.kind === "failed") logDetail("opening the calendar failed", opened.detail);
          if (opened.kind === "noHandler") logDetail("no calendar app", opened.detail);
          /*
           * Every way this can fail leaves the user in the same place — the
           * file exists and the other button still works — so all of them are
           * answered with the same outcome. `unsupported` is unreachable from
           * a sheet that only offers this button on Android, and is folded in
           * here rather than given a branch that could never run.
           */
          return { kind: "noCalendarApp" };
        }

        const shared = await shareTimetableFile({
          fileName,
          contents,
          mimeType: CALENDAR_FILE_MIME_TYPE,
          dialogTitle: t("calendarExport.dialogTitle"),
          uti: CALENDAR_FILE_UTI,
        });

        if (!shared.ok) {
          if (shared.kind === "failed") logDetail("the calendar export failed", shared.detail);
          return {
            kind: "failed",
            error: domainError(
              shared.kind === "unavailable" ? "errors.shareUnavailable" : "errors.calendarExportFailed",
            ),
          };
        }
        return { kind: "shared" };
      } finally {
        inFlight.current = false;
        setExporting(false);
      }
    },
    [t],
  );

  const exportActive = useCallback(
    (range: CalendarExportRange, how: CalendarDelivery = "share") =>
      run(() => activeTimetableSnapshot(), range, how),
    [run, activeTimetableSnapshot],
  );

  const exportArchive = useCallback(
    (archiveId: string, range: CalendarExportRange, how: CalendarDelivery = "share") =>
      run(() => readArchivedSnapshot(archiveId), range, how),
    [run, readArchivedSnapshot],
  );

  return { exporting, exportActive, exportArchive };
}
