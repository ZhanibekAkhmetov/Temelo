/**
 * The browser's edge of the app: the web build's version of
 * `util/timetableFiles`.
 *
 * Metro picks this file over `timetableFiles.ts` when it bundles for web, so
 * nothing above it changes: the same five functions, the same result shapes,
 * the same promise that none of them throws. TypeScript, which does not know
 * about platform extensions, checks every export here against the native file's
 * signature through `typeof Native.*` — the two cannot drift apart silently,
 * and `tests/architecture.test.mjs` checks they export the same names.
 *
 * Like the native file, this knows nothing about what a timetable is: a file
 * name, some text and a MIME type cross the boundary, never a format.
 *
 * ## What each way out becomes in a browser
 *
 *  - **Share** downloads the file. On a touch device that can share files the
 *    system share sheet is offered instead, which is what "Share" means on a
 *    phone; on a desktop a download is what the user can actually use — the
 *    file lands in Downloads, ready to attach or to keep.
 *  - **Open with an app** is unsupported, exactly as on iOS: a browser cannot
 *    hand a file to another application. The caller already falls back to
 *    sharing, so an `.ics` is downloaded and opened from there.
 *  - **Receiving a share** never happens: there is no share target, so there is
 *    never a payload to read or clear.
 */

import type * as Native from "@/util/timetableFiles";

export type {
  OpenFileResult,
  PickTimetableFileResult,
  ReadTimetableFileResult,
  ShareTimetableResult,
} from "@/util/timetableFiles";

/** The same bound as the native file, for the same reason; see there. */
const MAX_INCOMING_FILE_BYTES = 8 * 1024 * 1024;

/**
 * How long a download's object URL is kept alive.
 *
 * Revoking it synchronously after `click()` races the download in some
 * browsers, which then save an empty or failed file. A minute is far longer
 * than any browser takes to start a download of a few kilobytes.
 */
const OBJECT_URL_LIFETIME_MS = 60_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string | null {
  return typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : null;
}

/* ------------------------------------------------------------------- share */

/** Saves `contents` as a file through the browser's ordinary download. */
function download(fileName: string, contents: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
  }
}

/**
 * The file as something the Web Share API accepts, or null where sharing a
 * file would be the wrong answer.
 *
 * Only on a touch-first device. Desktop browsers increasingly implement
 * `navigator.share` too, but a share sheet on a desktop is a detour on the way
 * to the thing the user wanted — the file — so a desktop always downloads.
 */
function shareableFile(fileName: string, contents: string, mimeType: string): File | null {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return null;
  if (!window.matchMedia?.("(pointer: coarse)").matches) return null;
  const file = new File([contents], fileName, { type: mimeType });
  return navigator.canShare({ files: [file] }) ? file : null;
}

export const shareTimetableFile: typeof Native.shareTimetableFile = async (input) => {
  try {
    const file = shareableFile(input.fileName, input.contents, input.mimeType);
    if (file) {
      try {
        await navigator.share({ files: [file], title: input.dialogTitle });
        return { ok: true };
      } catch (error: unknown) {
        // The user closed the sheet: the same non-event the native sheet is.
        if (errorName(error) === "AbortError") return { ok: true };
        // `NotAllowedError` is a browser deciding the tap was too long ago to
        // count as the user's — the file is still wanted, so it is downloaded.
        if (errorName(error) !== "NotAllowedError") throw error;
      }
    }
    download(input.fileName, input.contents, input.mimeType);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, kind: "failed", detail: `saving the file: ${messageOf(error)}` };
  }
};

/* -------------------------------------------------------------------- open */

export const openFileWithApp: typeof Native.openFileWithApp = async () => ({ ok: false, kind: "unsupported" });

/* -------------------------------------------------------------------- read */

/** The text of a browser `File`, refused unread when it is far too large. */
async function readBrowserFile(file: Blob, fileName: string): Promise<Native.ReadTimetableFileResult> {
  if (file.size > MAX_INCOMING_FILE_BYTES) {
    return { ok: false, kind: "tooLarge", detail: `${file.size} bytes exceeds ${MAX_INCOMING_FILE_BYTES}` };
  }
  try {
    return { ok: true, text: await file.text(), fileName };
  } catch (error: unknown) {
    return { ok: false, kind: "unreadable", detail: `reading the file: ${messageOf(error)}` };
  }
}

/**
 * The text behind a URL — a `blob:` URL in practice, since nothing else in the
 * web build produces one. Kept so the boundary is the same shape everywhere.
 */
export const readTimetableFileAt: typeof Native.readTimetableFileAt = async (uri) => {
  try {
    const response = await fetch(uri);
    if (!response.ok) return { ok: false, kind: "unreadable", detail: `fetching the file: HTTP ${response.status}` };
    const name = decodeURIComponent(new URL(uri, window.location.href).pathname.split("/").pop() ?? "");
    return await readBrowserFile(await response.blob(), name);
  } catch (error: unknown) {
    return { ok: false, kind: "unreadable", detail: `reading the file: ${messageOf(error)}` };
  }
};

/* -------------------------------------------------------------------- pick */

/**
 * Opens the browser's file chooser and returns the chosen file's text.
 *
 * No `accept` filter, for the native file's reason: what a file *is* is
 * decided by reading it, and a filter would only hide a renamed or re-saved
 * timetable from the person who owns it.
 *
 * Must be called from inside a tap: browsers open a file chooser only on the
 * user's own gesture. The caller does — the click below runs before the
 * caller's first `await`.
 *
 * Cancellation is the input's `cancel` event, which every current browser
 * fires when the chooser is closed without a choice. Without it the promise
 * would wait forever, and the import button would stay busy.
 */
export const pickTimetableFile: typeof Native.pickTimetableFile = () =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";

    const finish = (result: Native.PickTimetableFileResult) => {
      input.remove();
      resolve(result);
    };

    input.addEventListener("cancel", () => finish({ cancelled: true }), { once: true });
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (!file) {
          finish({ cancelled: true });
          return;
        }
        void readBrowserFile(file, file.name).then((read) => finish({ cancelled: false, file: read }));
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });

/* ------------------------------------------------------------------ shared */

/** A browser tab has no share target, so nothing is ever shared in. */
export const readSharedTimetableFile: typeof Native.readSharedTimetableFile = () => null;

export const clearSharedTimetableFile: typeof Native.clearSharedTimetableFile = () => {};
