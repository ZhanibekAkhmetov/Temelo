/**
 * The app's edge to the optional share-link server (`server/`, milestone 14.5).
 *
 * Two calls — upload a file's text, download one by id — over plain `fetch`,
 * which React Native and every browser provide, so there is no native module
 * and no web twin. Like `util/timetableFiles`, this knows nothing about what a
 * timetable is: text crosses it, never a format. Deciding whether downloaded
 * text is a timetable is `previewTimetableFile`'s job, with the same validator
 * a file from disk goes through — the server is never trusted.
 *
 * Nothing here throws. Every outcome is a value, and the failures are the few
 * kinds a person can act on: the server cannot be reached, it is not working,
 * the file is too large, or the link does not exist (any more).
 *
 * ## Configuration
 *
 * The feature exists only where a server is configured, at build time:
 *
 *  - `EXPO_PUBLIC_TEMELO_SERVER_URL` — where the API is, e.g.
 *    `http://localhost:8080` while developing.
 *  - `EXPO_PUBLIC_TEMELO_WEB_URL` — where the web app is, which is what a link
 *    points at. In a browser it defaults to the page's own origin.
 *
 * Without them `shareLinkConfig()` is null, and the app offers nothing that
 * needs a network — it stays the local-first app it is without a server.
 */

import { isShareId } from "@/domain/shareLink";

/** Where the server and the web app are, or null when share links are off. */
export interface ShareLinkConfig {
  serverUrl: string;
  webUrl: string;
}

/**
 * Long enough for a free host to wake a sleeping server — about a minute on
 * the hosts this is meant for — and short enough that a server that is truly
 * gone is reported rather than waited on indefinitely.
 */
const REQUEST_TIMEOUT_MS = 90_000;

function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+/.test(trimmed) ? trimmed : null;
}

/** The page's own origin in a browser; undefined on a phone and in Node. */
function pageOrigin(): string | undefined {
  return (globalThis as { location?: { origin?: string } }).location?.origin;
}

export function shareLinkConfig(): ShareLinkConfig | null {
  // Written out in full: Expo inlines `process.env.EXPO_PUBLIC_*` at build
  // time only where it appears as exactly this expression.
  const serverUrl = httpUrl(process.env.EXPO_PUBLIC_TEMELO_SERVER_URL);
  const webUrl = httpUrl(process.env.EXPO_PUBLIC_TEMELO_WEB_URL) ?? httpUrl(pageOrigin());
  return serverUrl && webUrl ? { serverUrl, webUrl } : null;
}

/** Why a request did not come back with what was asked for. */
export type ShareLinkFailure =
  /** No answer: offline, the server is down, or it took longer than the timeout. */
  | { kind: "unreachable"; detail: string }
  /** An answer that is an error the user cannot fix, or not the answer promised. */
  | { kind: "server"; detail: string }
  /** The upload was larger than the server accepts. */
  | { kind: "tooLarge"; detail: string }
  /** The server refused the upload as not a Temelo file — a defect if it was ours. */
  | { kind: "refused"; detail: string }
  /** No share with this id, or it has expired. */
  | { kind: "notFound"; detail: string };

export type UploadSharedTimetableResult =
  | { ok: true; id: string; expiresAt: string }
  | { ok: false; failure: ShareLinkFailure };

export type DownloadSharedTimetableResult = { ok: true; text: string } | { ok: false; failure: ShareLinkFailure };

type Answered = { ok: true; response: Response } | { ok: false; failure: ShareLinkFailure };

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Answered> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return { ok: true, response: await fetch(url, { ...init, signal: controller.signal }) };
  } catch (error: unknown) {
    return { ok: false, failure: { kind: "unreachable", detail: messageOf(error) } };
  } finally {
    clearTimeout(timer);
  }
}

/** The `reason` of an RFC 9457 problem the server sent, or null. */
async function problemReason(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "reason" in body && typeof body.reason === "string") {
      return body.reason;
    }
  } catch {
    // Not JSON — a proxy's error page, say. The status is all there is.
  }
  return null;
}

/**
 * Uploads a `.temelo` file's text and returns the share's id and expiry.
 *
 * The answer is checked as strictly as a file would be: an id that is not
 * what the server issues, or an expiry that is not a date, is a broken server,
 * not a link to hand to the user.
 */
export async function uploadSharedTimetable(
  serverUrl: string,
  text: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<UploadSharedTimetableResult> {
  const answered = await request(
    `${serverUrl}/api/shares`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: text },
    timeoutMs,
  );
  if (!answered.ok) return answered;
  const { response } = answered;

  if (response.status === 201) {
    let body: unknown;
    try {
      body = await response.json();
    } catch (error: unknown) {
      return { ok: false, failure: { kind: "server", detail: `unreadable answer: ${messageOf(error)}` } };
    }
    const id = typeof body === "object" && body !== null && "id" in body ? body.id : undefined;
    const expiresAt = typeof body === "object" && body !== null && "expiresAt" in body ? body.expiresAt : undefined;
    if (
      typeof id !== "string" ||
      !isShareId(id) ||
      typeof expiresAt !== "string" ||
      Number.isNaN(Date.parse(expiresAt))
    ) {
      return { ok: false, failure: { kind: "server", detail: "the answer has no valid id and expiry" } };
    }
    return { ok: true, id, expiresAt };
  }

  const reason = await problemReason(response);
  const detail = `HTTP ${response.status}${reason ? ` (${reason})` : ""}`;
  if (response.status === 413 || reason === "too-large") return { ok: false, failure: { kind: "tooLarge", detail } };
  if (response.status === 422) return { ok: false, failure: { kind: "refused", detail } };
  return { ok: false, failure: { kind: "server", detail } };
}

/**
 * Downloads the file shared under `id`, as text, exactly as the server sent it.
 *
 * The id is checked before anything is sent, so a malformed one never becomes
 * a request — and is answered as `notFound`, which is what the server would
 * say about it too.
 */
export async function downloadSharedTimetable(
  serverUrl: string,
  id: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<DownloadSharedTimetableResult> {
  if (!isShareId(id)) {
    return { ok: false, failure: { kind: "notFound", detail: "not a share id" } };
  }
  const answered = await request(`${serverUrl}/api/shares/${id}`, { method: "GET" }, timeoutMs);
  if (!answered.ok) return answered;
  const { response } = answered;

  if (response.status === 200) {
    try {
      return { ok: true, text: await response.text() };
    } catch (error: unknown) {
      return { ok: false, failure: { kind: "unreachable", detail: `the download broke off: ${messageOf(error)}` } };
    }
  }
  if (response.status === 404) return { ok: false, failure: { kind: "notFound", detail: "HTTP 404" } };
  return { ok: false, failure: { kind: "server", detail: `HTTP ${response.status}` } };
}
