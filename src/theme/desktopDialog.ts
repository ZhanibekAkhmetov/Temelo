import { useIsDesktop } from "@/theme/useIsDesktop";

/**
 * Stack options that let a screen open as a desktop dialog over the one
 * beneath it.
 *
 * `transparentModal` is what keeps the screen underneath drawn on web — the
 * week stays in view behind Settings or a timetable's details — and the
 * transparent content style is what lets it show through. The dialog itself,
 * its backdrop and its card, is drawn by the screen (`ScreenContainer` with
 * `desktopDialog`), so the router decides only *that* it is a dialog.
 *
 * Expo Router also has a dedicated web modal, but in SDK 57 it is behind an
 * unstable CLI flag; this uses only the stable stack.
 *
 * Off the desktop layout this is an empty object, so the screen keeps the
 * ordinary push it has on a phone.
 */
export function useDesktopDialogOptions() {
  const isDesktop = useIsDesktop();
  if (!isDesktop) return {};
  return {
    presentation: "transparentModal" as const,
    animation: "fade" as const,
    contentStyle: { backgroundColor: "transparent" },
  };
}
