/**
 * What a share link looks like, and how to find the id in one.
 *
 * A share link is an address of the *web app*, `<web app>/shared/<id>`, not of
 * the server: it opens in any browser, so somebody without Temelo installed can
 * still import the timetable, and Temelo itself reaches the same route (see
 * `app/shared/[id].tsx`). The id is the server's — 22 URL-safe characters, 128
 * random bits — and it is the only thing that grants access, since there are
 * no accounts.
 *
 * Pure string work, so the Node tests cover it: no React, no fetch.
 */

/** The route a share link opens, without the id. */
export const SHARE_LINK_PATH = "/shared/";

/** A share id as the server issues it (`ShareIds` on the server). */
const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;

export function isShareId(value: string): boolean {
  return SHARE_ID.test(value);
}

/**
 * The link for a share, on the web app at `webUrl`.
 *
 * `webUrl` may carry a path (a web app hosted below the domain root) and may
 * end in a slash; either way there is exactly one slash before `shared`.
 */
export function shareLinkUrl(webUrl: string, id: string): string {
  return `${webUrl.replace(/\/+$/, "")}${SHARE_LINK_PATH}${id}`;
}

/**
 * The share id in whatever the user pasted, or null when there is none.
 *
 * Accepts a whole link from any host — the link may have been made on a
 * different deployment, or copied with surrounding text from a chat — or the
 * bare id. Anything after the id (a query, a fragment, a trailing slash) is
 * ignored. Nothing is fetched here; a well-formed id that does not exist is the
 * server's to report.
 */
export function shareIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (isShareId(trimmed)) return trimmed;

  const at = trimmed.indexOf(SHARE_LINK_PATH);
  if (at === -1) return null;
  const candidate = trimmed.slice(at + SHARE_LINK_PATH.length).match(/^[A-Za-z0-9_-]+/)?.[0] ?? "";
  return isShareId(candidate) ? candidate : null;
}
