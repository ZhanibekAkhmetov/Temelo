/**
 * Claiming the device's storage before the database is opened.
 *
 * On a phone there is nothing to claim: the app is one process and the
 * database file is its own. The question only exists in a browser, where the
 * same app can be open in several tabs at once — see `storageClaim.web.ts`,
 * which Metro picks for the web build. This file is what native builds and the
 * Node tests get.
 */

export type StorageClaim =
  | { ok: true }
  /** Another tab or window of this app already holds the database. */
  | { ok: false; kind: "inUse" };

/** Always succeeds: a native app is the only thing that opens its database. */
export async function claimStorageAsync(): Promise<StorageClaim> {
  return { ok: true };
}

/**
 * Starts the app again from scratch. Only meaningful in a browser, where a
 * reload is how a tab retries the claim after the other tab has closed; never
 * offered on a phone.
 */
export function reloadApp(): void {}
