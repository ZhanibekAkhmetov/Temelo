/**
 * The web build's storage claim: one tab at a time.
 *
 * `expo-sqlite` keeps the web database in the Origin Private File System,
 * through file handles a browser grants to one holder at a time. A second tab
 * that tried to open the database would therefore fail outright — and the app's
 * answer to a database that will not open is to carry on in memory, which in a
 * second tab would mean edits that look saved and vanish with the tab.
 *
 * So the tab claims a Web Lock before the database is opened, and keeps it for
 * as long as the tab lives; the browser releases it when the tab closes or
 * reloads. A tab that finds the lock taken is told so, and says so to the user
 * instead of opening anything.
 *
 * The same moment asks the browser to keep the storage
 * (`navigator.storage.persist()`), so that a timetable is not evicted to make
 * room for other sites' caches. The browser may decline; the app works either
 * way, which is why it is not awaited or reported.
 */

import type * as Native from "@/util/storageClaim";

export type { StorageClaim } from "@/util/storageClaim";

/** Shared by every tab of this origin; the name is all a Web Lock has. */
const LOCK_NAME = "temelo:database";

/**
 * Memoized, because a failed bootstrap may retry and must not find that it is
 * itself the tab holding the lock.
 */
let claim: Promise<Native.StorageClaim> | null = null;

function requestPersistence(): void {
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    // Not offered by this browser; nothing to do.
  }
}

function acquire(): Promise<Native.StorageClaim> {
  // Without Web Locks (very old browsers, or a page served over plain HTTP to
  // another machine) there is no way to ask, so the claim succeeds — and a
  // second tab would meet the database's own refusal instead.
  if (typeof navigator.locks?.request !== "function") return Promise.resolve({ ok: true });

  return new Promise((resolve) => {
    navigator.locks
      .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve({ ok: false, kind: "inUse" });
          return undefined;
        }
        resolve({ ok: true });
        // Held until the tab goes away: a lock is released when the promise its
        // callback returned settles, and this one never does.
        return new Promise<never>(() => {});
      })
      .catch(() => resolve({ ok: true }));
  });
}

export const claimStorageAsync: typeof Native.claimStorageAsync = () => {
  if (!claim) {
    requestPersistence();
    claim = acquire();
  }
  return claim;
};

export const reloadApp: typeof Native.reloadApp = () => {
  window.location.reload();
};
