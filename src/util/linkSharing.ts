/**
 * Handing a link to the user: the share sheet, or the clipboard.
 *
 * On a phone the system share sheet is both — Android's offers "Copy" beside
 * every app — so this file shares and never copies. React Native's own `Share`
 * does it, which is part of React Native rather than a dependency of ours. The
 * browser's version is `linkSharing.web.ts`.
 *
 * Like the other platform edges, nothing here throws and nothing here knows
 * what it is carrying: a URL and a title, never a timetable.
 */

import { Share } from "react-native";

export type LinkHandOffResult =
  | { ok: true }
  /** The user closed the sheet. Not an error, and not reported as one. */
  | { ok: false; kind: "dismissed" }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "failed"; detail: string };

/** Whether `shareLink` can open a share sheet here. */
export const CAN_SHARE_LINKS: boolean = true;

/** Whether `copyLink` can write to a clipboard here. */
export const CAN_COPY_LINKS: boolean = false;

export async function shareLink(input: { url: string; dialogTitle: string }): Promise<LinkHandOffResult> {
  try {
    // `message`, not `url`: Android ignores `url`, and the link *is* the message.
    const result = await Share.share({ message: input.url }, { dialogTitle: input.dialogTitle });
    return result.action === Share.dismissedAction ? { ok: false, kind: "dismissed" } : { ok: true };
  } catch (error: unknown) {
    return { ok: false, kind: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

/** There is no clipboard module in the app; the share sheet's Copy is the way. */
export async function copyLink(_url: string): Promise<LinkHandOffResult> {
  return { ok: false, kind: "unavailable" };
}
