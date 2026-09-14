/**
 * The places a timetable crosses the edge of the app: out through the share
 * sheet, and in through the document picker or another app's share sheet.
 *
 * Everything that knows about `expo-file-system` and `expo-sharing` is in this
 * file, and nothing in it knows what a timetable is. What crosses the boundary
 * in either direction is a filename and a string — the format lives in
 * `storage/timetableFile`, the meaning in
 * `storage/timetableLifecycle`, and neither can be reached from here. That is
 * the same line `util/notifications` and `util/haptics` already draw, and it is
 * what lets the whole of the file *format* be exercised by the Node harness,
 * which has no native modules at all.
 *
 * Every function here is total: each returns a reason rather than throwing,
 * because each is reachable from a button or from a launch and every way they
 * fail is something to say to the user rather than something to crash on. A
 * cancelled picker is not a failure and is reported as its own outcome — the
 * user changed their mind, which is not an error and must not produce an error
 * message.
 *
 * ## The two ways in are one way in
 *
 * The picker and an `ACTION_SEND` differ only in how the app learns the
 * location of some bytes. Both end at `readTimetableFileAt`, which applies the
 * same size bound and returns the same shape, so there is one read path and —
 * above this file — one parser, one preview and one import. A file that arrives
 * through a share sheet is trusted exactly as much as one the user browsed to,
 * which is to say not at all.
 *
 * ## Where an export is written
 *
 * Into one directory inside the *cache*, which is emptied before each export
 * so at most one temporary file exists at a time. Three consequences, all
 * intended:
 *
 *  - Sharing a timetable does not quietly accumulate copies of it on the
 *    device. Tapping Share ten times leaves one file, not ten.
 *  - The cache is storage the OS may reclaim whenever it likes, which is
 *    exactly right for a file whose entire purpose is to be handed to another
 *    app in the next second. A `.temelo` the user wants to *keep* is the one
 *    the share sheet put in their Drive or their Downloads, not this one.
 *  - It is never a backup. Nothing in Temelo reads this directory back.
 */

import { Directory, File, Paths } from "expo-file-system";
import { requireOptionalNativeModule } from "expo-modules-core";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

/**
 * The largest file this module will read into memory, in bytes.
 *
 * Checked against the file's reported size *before* a single byte is read,
 * which is the only point at which a very large file can still be refused
 * cheaply. `storage/timetableFile` applies a second, tighter bound to the text
 * itself; this one exists so that a two-gigabyte video renamed to `.temelo`
 * never becomes a two-gigabyte string first.
 *
 * It applies to both ways in, because a file that arrives through a share sheet
 * is a file somebody *else* chose — which is the case this bound was written
 * for, and which is now reachable without the user having browsed to anything.
 *
 * Deliberately generous relative to a real timetable (tens of kilobytes) and
 * tiny relative to the media files that share a Downloads folder with it.
 */
const MAX_INCOMING_FILE_BYTES = 8 * 1024 * 1024;

/** The cache subdirectory an export is staged in. Cleared before each write. */
const EXPORT_DIRECTORY = "timetable-export";

/**
 * `Intent.FLAG_GRANT_READ_URI_PERMISSION`.
 *
 * The whole reason a direct open needs an intent launcher rather than
 * `Linking.openURL`. The staged file lives in Temelo's private cache and is
 * handed over as a `content://` URI from a provider declared `exported="false"`
 * — so the receiving app can read it only for as long as the intent that
 * carried this flag is alive. Without it the calendar resolves the intent,
 * starts, and then fails reading the file, which is worse than not offering
 * the button at all.
 *
 * Written as a literal because it is one: a platform constant Android has never
 * changed, and the alternative is a native module imported for one integer.
 */
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;

/**
 * How long to wait for a launch to fail before calling it a success.
 *
 * `startActivityAsync` resolves when the user comes *back* — which may be
 * minutes, or never, if they leave through Recents — and rejects when the
 * activity could not be started at all. Only the rejection is an answer this
 * code can use, and it arrives on the next bridge turn: Android throws
 * `ActivityNotFoundException` synchronously inside `startActivityForResult`.
 *
 * So the wait is for the rejection, not for the resolution, and this is the
 * grace it is given. Generous by two orders of magnitude on purpose, and free
 * when the launch works: by then the calendar is on screen and the sheet
 * underneath it is something nobody is looking at.
 */
const LAUNCH_GRACE_MS = 1200;

/**
 * The intent launcher, or null on a build whose native side does not have it.
 *
 * Two separate hazards, and the shape of this function is one answer to both.
 *
 * `expo-intent-launcher`'s entry point is `requireNativeModule('ExpoIntentLauncher')`
 * evaluated at *module scope*, so a plain top-level import on a build without
 * the native module throws while the bundle is being evaluated — not a failed
 * export but an app that does not start. Every development build made before
 * this module was installed is such a build, and so is any client a user has
 * not updated. Requiring it lazily, on the one code path that uses it, is what
 * keeps that from being a launch crash.
 *
 * Asking `requireOptionalNativeModule` first is what keeps it from being a
 * *reported* error either. A `try` around the require does catch the throw, and
 * the export goes on to fall back correctly — but the module factory has failed
 * by then, and in development that is surfaced as a red screen the user has to
 * dismiss, describing a condition the code has already handled. The optional
 * form answers the same question without anything throwing, so the missing
 * module becomes what it should be: this one button unavailable, with the share
 * button beside it still doing its job.
 *
 * The guard is only a guard. What is called afterwards is the package's own
 * supported API, not the native module it points at.
 */
function intentLauncher(): typeof import("expo-intent-launcher") | null {
  if (requireOptionalNativeModule("ExpoIntentLauncher") === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-intent-launcher");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------- share */

export type ShareTimetableResult =
  | { ok: true }
  /** No share sheet on this device or platform — web, or a stripped build. */
  | { ok: false; kind: "unavailable" }
  /** Writing the temporary file or opening the sheet failed. */
  | { ok: false; kind: "failed"; detail: string };

/**
 * Empties the staging directory, and makes sure it exists.
 *
 * Deleting the whole directory rather than the one file we are about to
 * overwrite: a previous export under a *different* name would otherwise stay
 * behind, and the point of a staging directory is that its contents are never
 * anyone's business but the current share.
 *
 * Failure here is not fatal and is not reported. If the directory cannot be
 * cleared, the write below either succeeds anyway or fails with a message
 * about the thing that actually matters.
 */
function resetExportDirectory(): Directory {
  const directory = new Directory(Paths.cache, EXPORT_DIRECTORY);
  try {
    if (directory.exists) directory.delete();
  } catch (error: unknown) {
    if (__DEV__) console.warn("[temelo/files] could not clear the export directory:", messageOf(error));
  }
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/**
 * Writes `contents` into the staging directory and hands back the file.
 *
 * Shared by both ways out, so there is one answer to "where does an export
 * live" and one moment at which the previous one stops existing: the start of
 * the next export, never the end of the current one. That ordering is the
 * whole of the lifetime guarantee. A file handed to another app stays on disk
 * until Temelo is asked to produce a different one, which is long after the
 * receiving activity has read it — and if the OS reclaims the cache first, it
 * reclaims a file whose only purpose was already served.
 */
function stageExportFile(fileName: string, contents: string): File {
  const file = new File(resetExportDirectory(), fileName);
  file.create({ overwrite: true });
  file.write(contents);
  return file;
}

/**
 * Writes `contents` to a temporary file called `fileName` and hands it to the
 * platform share sheet.
 *
 * Availability is checked before anything is written, so a device that cannot
 * share does not leave a file behind for nothing.
 *
 * What the user does next — Gmail, WhatsApp, Drive, Quick Share, or dismissing
 * the sheet — is not knowable from here and is not treated as a result.
 * `shareAsync` resolves when the sheet has been presented and handed off;
 * Android does not tell the app which target was chosen or whether the send
 * completed. So `{ ok: true }` means "the sheet opened", and the UI is worded
 * to promise no more than that.
 */
export async function shareTimetableFile(input: {
  fileName: string;
  contents: string;
  mimeType: string;
  dialogTitle: string;
  /**
   * The iOS uniform type identifier, when the file has a registered one.
   *
   * Android ignores it entirely and routes on `mimeType`, so this is only ever
   * about iOS. It defaults to the generic data type below, which is what a file
   * of an unknown kind is supposed to declare and what `.temelo` — registered
   * with nothing, anywhere — has to use.
   */
  uti?: string;
}): Promise<ShareTimetableResult> {
  try {
    if (!(await Sharing.isAvailableAsync())) return { ok: false, kind: "unavailable" };
  } catch (error: unknown) {
    // A missing native module throws rather than resolving false — most likely
    // a development build made before expo-sharing was installed.
    return { ok: false, kind: "failed", detail: messageOf(error) };
  }

  let uri: string;
  try {
    uri = stageExportFile(input.fileName, input.contents).uri;
  } catch (error: unknown) {
    return { ok: false, kind: "failed", detail: `writing the export: ${messageOf(error)}` };
  }

  try {
    await Sharing.shareAsync(uri, {
      mimeType: input.mimeType,
      dialogTitle: input.dialogTitle,
      // iOS only. There is no registered UTI for `.temelo`, so the generic data
      // type is what a file of an unknown kind is supposed to declare; a caller
      // whose format *does* have one — a calendar file does — names it instead.
      UTI: input.uti ?? "public.data",
    });
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, kind: "failed", detail: `opening the share sheet: ${messageOf(error)}` };
  }
}

/* -------------------------------------------------------------------- open */

export type OpenFileResult =
  | { ok: true }
  /** Not Android. Nothing was written; the caller shares instead. */
  | { ok: false; kind: "unsupported" }
  /** Nothing on the device offered to open a file of this type. */
  | { ok: false; kind: "noHandler"; detail: string }
  /** Staging the file or reaching the launcher failed. */
  | { ok: false; kind: "failed"; detail: string };

/**
 * Hands a temporary file to whichever app Android thinks should *open* it.
 *
 * ## Why this is not the share sheet
 *
 * `shareAsync` sends `ACTION_SEND`, which asks "who wants to receive a copy of
 * this" — mail, chat, Drive. Opening asks "who understands this kind of file",
 * which is `ACTION_VIEW`, and for a calendar file the two sets barely overlap:
 * Google Calendar registers `ACTION_VIEW` filters for `text/calendar` and for
 * `*.ics`, and no `ACTION_SEND` filter at all. That is why a `.ics` sent to a
 * chat app and then tapped reaches a calendar, while the same file offered
 * straight from the share sheet does not — the file was always fine and the
 * verb was always wrong.
 *
 * ## Why a `content://` URI and a grant flag
 *
 * The staged file is in Temelo's private cache, so a `file://` URI would be
 * both unreadable by the receiver and an exposure Android has refused since
 * API 24. `File.contentUri` returns a URI from the `FileSystemFileProvider`
 * that `expo-file-system` already declares, and because that provider is not
 * exported, the receiver can read it only under the read grant this intent
 * carries. Nothing is made world-readable and no permission is requested.
 *
 * ## What the result means
 *
 * `{ ok: true }` means the activity started — the same promise
 * `shareTimetableFile` makes, and the same reason: what the user does in the
 * calendar afterwards is not knowable from here. `noHandler` is the one failure
 * worth a different sentence, because it is the only one the user can act on,
 * by sharing the file somewhere instead.
 */
export async function openFileWithApp(input: {
  fileName: string;
  contents: string;
  mimeType: string;
}): Promise<OpenFileResult> {
  // iOS has no intent system and `expo-intent-launcher` ships nothing for it.
  // Answered before anything is written, so a platform that cannot open a file
  // never leaves one behind for nothing.
  if (Platform.OS !== "android") return { ok: false, kind: "unsupported" };

  let contentUri: string;
  try {
    contentUri = stageExportFile(input.fileName, input.contents).contentUri;
  } catch (error: unknown) {
    return { ok: false, kind: "failed", detail: `staging the file: ${messageOf(error)}` };
  }

  const launcher = intentLauncher();
  if (!launcher) return { ok: false, kind: "noHandler", detail: "the intent launcher is not in this build" };

  try {
    /*
     * Deliberately not awaited to completion. The promise settles either by
     * rejecting — no activity could be started — or by resolving when the user
     * returns from the calendar, which is not an event this function is about
     * and may never arrive. So the race waits only for the failure, and treats
     * its absence as the launch having worked; see `LAUNCH_GRACE_MS`.
     *
     * The rejection handler is attached immediately rather than inside the
     * race, so a refusal that arrives *after* the grace has elapsed is still
     * handled and never surfaces as an unhandled rejection.
     */
    const launch = launcher.startActivityAsync("android.intent.action.VIEW", {
      data: contentUri,
      type: input.mimeType,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });

    const settled = launch.then(
      () => null,
      (error: unknown) => messageOf(error),
    );
    const failure = await Promise.race([
      settled,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LAUNCH_GRACE_MS)),
    ]);

    if (failure !== null) return { ok: false, kind: "noHandler", detail: failure };
    return { ok: true };
  } catch (error: unknown) {
    // Not the missing-module case — `intentLauncher` has already answered that
    // one. This is the launcher itself refusing synchronously: no activity to
    // attach to, or a second launch while one is still pending.
    return { ok: false, kind: "failed", detail: `opening the file: ${messageOf(error)}` };
  }
}

/* -------------------------------------------------------------------- read */

export type ReadTimetableFileResult =
  | { ok: true; text: string; fileName: string }
  /** The file is far too large to be a timetable; nothing was read. */
  | { ok: false; kind: "tooLarge"; detail: string }
  /** The file could not be reached, opened, or read. */
  | { ok: false; kind: "unreadable"; detail: string };

/**
 * The text of a file at a URI, whatever kind of URI it is.
 *
 * The one place bytes enter the app, and the reason the two ways in are not two
 * code paths. `expo-file-system`'s `File` resolves a `content://` URI through
 * the content resolver, a document-provider URI through the Storage Access
 * Framework, and a `file://` one directly — so a `.temelo` in Downloads and a
 * `.temelo` WhatsApp shared in are both just a URI here, and neither is trusted
 * any further than the next function that reads it.
 *
 * ## Why the text is read now, and carried rather than the URI
 *
 * A `content://` handed over by an `ACTION_SEND` comes with a *temporary* read
 * grant, and the grant belongs to the activity's task. Reading happens while
 * that is unambiguously still true. By the time the user has looked at a
 * preview and tapped Import the grant may be gone — and on a development build
 * it demonstrably can be, because `expo-dev-launcher` clears and rebuilds the
 * task around the launch. An import that had to go back to the provider would
 * be an import that fails *after* it was confirmed, which is the one moment it
 * must not.
 *
 * Constructing the `File` can throw on a string that is not a URI at all, so
 * even that is inside the `try`: this is handed values that came from another
 * application.
 */
export async function readTimetableFileAt(uri: string): Promise<ReadTimetableFileResult> {
  try {
    const file = new File(uri);
    /*
     * The size before the read, which is the only point at which a very large
     * file can still be refused cheaply — after `text()` it is already a string
     * in memory, and refusing it then would have cost exactly what the check is
     * there to avoid. `storage/timetableFile` applies a second, tighter bound
     * to the text itself.
     */
    const size = file.size;
    if (typeof size === "number" && size > MAX_INCOMING_FILE_BYTES) {
      return { ok: false, kind: "tooLarge", detail: `${size} bytes exceeds ${MAX_INCOMING_FILE_BYTES}` };
    }
    return { ok: true, text: await file.text(), fileName: file.name };
  } catch (error: unknown) {
    return { ok: false, kind: "unreadable", detail: `reading the file: ${messageOf(error)}` };
  }
}

/* -------------------------------------------------------------------- pick */

export type PickTimetableFileResult =
  /** The user backed out of the picker. Not an error, and not an outcome. */
  | { cancelled: true }
  /** They chose something, and `file` says how reading it went. */
  | { cancelled: false; file: ReadTimetableFileResult };

/**
 * Asks the platform for a file and returns its text.
 *
 * ## Why not `expo-document-picker`
 *
 * Because `expo-file-system` already has the picker, natively, in SDK 57:
 * `File.pickFileAsync` opens the same system document UI, takes a persistable
 * read permission on what the user chose, and hands back a `File` that
 * `text()` and `size` work on — including for the `content://` URIs a SAF
 * provider returns. Adding a second native module to open the same dialog
 * would be a package for convenience, which this project's dependency policy
 * declines, and one more thing a development build has to be rebuilt for.
 *
 * ## Why no type filter
 *
 * `.temelo` is registered with no MIME type, so Android reports it as whatever
 * the providing app guesses — `application/octet-stream` from one file manager,
 * `text/plain` or nothing at all from another, and a different answer again
 * from Drive. A filter would therefore hide the user's own file from them, with
 * no explanation, somewhere between often and always depending on where they
 * keep it. What a file *is* is decided by reading it, which is what
 * `parseTemeloFile` does and what makes this safe: the extension is a hint for
 * humans, never a credential.
 *
 * ## On cancellation
 *
 * `pickFileAsync` resolves to `{ canceled: true }` both when the user backs out
 * and when the picker itself fails — it catches its own errors and reports them
 * as a cancellation. There is no way to tell the two apart from here, so both
 * are reported as a cancellation and the UI says nothing, which is the right
 * behaviour for by far the more common of the two.
 */
export async function pickTimetableFile(): Promise<PickTimetableFileResult> {
  const picked = await File.pickFileAsync({ mimeTypes: ["*/*"] });
  if (picked.canceled) return { cancelled: true };
  // Nested rather than spread, so that "the user cancelled" and "the file could
  // not be read" stay two separate questions with no shape in which both look
  // like the same answer.
  return { cancelled: false, file: await readTimetableFileAt(picked.result.uri) };
}

/* ------------------------------------------------------------------ shared */

/**
 * The file another app shared into Temelo, or null.
 *
 * `expo-sharing` parks the whole `ACTION_SEND` intent in a native singleton and
 * parses it on demand; this reduces the result to the one thing above this
 * module can use. Only a payload whose value is a URI is a candidate — a
 * plain-text share is a message, not a timetable, and has no bytes to read.
 *
 * Synchronous, and cheap enough to call on every resume: it reads a field off
 * an intent that is already in memory. That is what lets the receiver poll it
 * rather than having to be told when a share happened.
 *
 * The first file payload wins. Temelo registers for single-file sends only, so
 * there is never legitimately more than one; taking the first rather than
 * refusing a list of several means an app that sends a `SEND_MULTIPLE` anyway
 * gets a sensible answer instead of nothing.
 *
 * Reading does not consume — `clearSharedTimetableFile` is a separate call.
 */
export function readSharedTimetableFile(): { uri: string } | null {
  let payloads: { value: string }[];
  try {
    payloads = Sharing.getSharedPayloads();
  } catch (error: unknown) {
    // Most likely a development build made before the share plugin was
    // configured. Nothing was shared, as far as anything above here can tell.
    if (__DEV__) console.warn("[temelo/files] could not read the shared payload:", messageOf(error));
    return null;
  }

  const file = payloads.find((payload) => isFileUri(payload.value));
  return file ? { uri: file.value } : null;
}

/**
 * Throws away whatever was shared with the app.
 *
 * The payload lives in a native singleton that outlives the screen, the React
 * tree and — in a development build — the JavaScript context itself. Leaving it
 * there means the *next* visit to an app that was never actually closed starts
 * on a preview of a file the user already answered about, so this is called as
 * soon as the bytes have been read and are safely a string in memory. From that
 * moment the receiver owns the file and the intent no longer matters.
 *
 * Never throws: a payload that cannot be cleared is a duplicate preview at
 * worst, and `domain/incomingShare`'s answered-URI memory catches that too.
 */
export function clearSharedTimetableFile(): void {
  try {
    Sharing.clearSharedPayloads();
  } catch (error: unknown) {
    if (__DEV__) console.warn("[temelo/files] could not clear the shared payload:", messageOf(error));
  }
}

/** Whether a shared payload's value is somewhere bytes can be read from. */
function isFileUri(value: string): boolean {
  return value.startsWith("content://") || value.startsWith("file://");
}
