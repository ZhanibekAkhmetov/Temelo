/**
 * The browser's version of `util/linkSharing`.
 *
 * Copying is what a desktop user wants — the link goes into a chat or an email
 * they already have open — so it is always offered where the page can write to
 * the clipboard. The Web Share API is offered as well where the browser has one
 * (phones, and some desktops), because there it opens the same sheet a native
 * app would.
 *
 * Typed against the native file through `typeof Native.*`, and
 * `tests/architecture.test.mjs` checks the two export the same names.
 */

import type * as Native from "@/util/linkSharing";

export type { LinkHandOffResult } from "@/util/linkSharing";

interface ShareCapableNavigator {
  share?: (data: { title?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

function browserNavigator(): ShareCapableNavigator | undefined {
  return (globalThis as { navigator?: ShareCapableNavigator }).navigator;
}

export const CAN_SHARE_LINKS: typeof Native.CAN_SHARE_LINKS = typeof browserNavigator()?.share === "function";

export const CAN_COPY_LINKS: typeof Native.CAN_COPY_LINKS = typeof browserNavigator()?.clipboard?.writeText === "function";

function errorName(error: unknown): string | null {
  return typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : null;
}

export const shareLink: typeof Native.shareLink = async (input) => {
  const share = browserNavigator()?.share;
  if (typeof share !== "function") return { ok: false, kind: "unavailable" };
  try {
    await share.call(browserNavigator(), { title: input.dialogTitle, url: input.url });
    return { ok: true };
  } catch (error: unknown) {
    // Closing the sheet rejects with AbortError; that is a choice, not a failure.
    if (errorName(error) === "AbortError") return { ok: false, kind: "dismissed" };
    return { ok: false, kind: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
};

export const copyLink: typeof Native.copyLink = async (url) => {
  const clipboard = browserNavigator()?.clipboard;
  if (typeof clipboard?.writeText !== "function") return { ok: false, kind: "unavailable" };
  try {
    await clipboard.writeText(url);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, kind: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
};
