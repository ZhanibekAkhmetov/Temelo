/**
 * The two places a timetable crosses the edge of the app: out through the
 * share sheet, in through the document picker.
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
 * Both functions are total: they return a reason rather than throwing, because
 * both are reachable from a button and every way they fail is something to say
 * to the user rather than something to crash on. A cancelled picker is not a
 * failure and is reported as its own outcome — the user changed their mind,
 * which is not an error and must not produce an error message.
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
import * as Sharing from "expo-sharing";

/**
 * The largest file the picker will hand on to be read, in bytes.
 *
 * Checked against the picked file's reported size *before* a single byte is
 * read into memory, which is the only point at which a very large file can
 * still be refused cheaply. `storage/timetableFile` applies a second, tighter
 * bound to the text itself; this one exists so that a two-gigabyte video
 * renamed to `.temelo` never becomes a two-gigabyte string first.
 *
 * Deliberately generous relative to a real timetable (tens of kilobytes) and
 * tiny relative to the media files that share a Downloads folder with it.
 */
const MAX_PICKED_FILE_BYTES = 8 * 1024 * 1024;

/** The cache subdirectory an export is staged in. Cleared before each write. */
const EXPORT_DIRECTORY = "timetable-export";

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
    const directory = resetExportDirectory();
    const file = new File(directory, input.fileName);
    file.create({ overwrite: true });
    file.write(input.contents);
    uri = file.uri;
  } catch (error: unknown) {
    return { ok: false, kind: "failed", detail: `writing the export: ${messageOf(error)}` };
  }

  try {
    await Sharing.shareAsync(uri, {
      mimeType: input.mimeType,
      dialogTitle: input.dialogTitle,
      // iOS only, and there is no registered UTI for `.temelo`; the generic
      // data type is what a file of an unknown kind is supposed to declare.
      UTI: "public.data",
    });
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, kind: "failed", detail: `opening the share sheet: ${messageOf(error)}` };
  }
}

/* -------------------------------------------------------------------- pick */

export type PickTimetableFileResult =
  /** The user backed out of the picker. Not an error. */
  | { ok: true; cancelled: true }
  | { ok: true; cancelled: false; text: string; fileName: string }
  /** The file is far too large to be a timetable; nothing was read. */
  | { ok: false; kind: "tooLarge"; detail: string }
  /** The file could not be read. */
  | { ok: false; kind: "unreadable"; detail: string };

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
  if (picked.canceled) return { ok: true, cancelled: true };

  const file = picked.result;

  try {
    /*
     * The size before the read, which is the only point at which a very large
     * file can still be refused cheaply — after `text()` it is already a string
     * in memory, and refusing it then would have cost exactly what the check is
     * there to avoid. `storage/timetableFile` applies a second, tighter bound
     * to the text itself.
     */
    const size = file.size;
    if (typeof size === "number" && size > MAX_PICKED_FILE_BYTES) {
      return { ok: false, kind: "tooLarge", detail: `${size} bytes exceeds ${MAX_PICKED_FILE_BYTES}` };
    }
    return { ok: true, cancelled: false, text: await file.text(), fileName: file.name };
  } catch (error: unknown) {
    return { ok: false, kind: "unreadable", detail: `reading the file: ${messageOf(error)}` };
  }
}
