import { Platform, useWindowDimensions } from "react-native";

/**
 * The narrowest browser window that gets the desktop layout: a sidebar beside
 * the week, dialogs instead of full-screen pages, and form screens drawn as a
 * column instead of edge to edge.
 *
 * Wide enough that a 272-point sidebar still leaves five readable day columns;
 * below it the web build is laid out exactly like the phone app, which is the
 * right answer for a phone or a narrow window.
 */
export const DESKTOP_MIN_WIDTH = 1024;

/**
 * Whether the app is being drawn as a desktop app.
 *
 * Only ever true on web. A phone or tablet build never takes the desktop
 * layout, whatever its screen width, so nothing the phone app draws depends on
 * this being false by accident — and the native code paths are the ones the
 * device checklists cover.
 */
export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && width >= DESKTOP_MIN_WIDTH;
}
