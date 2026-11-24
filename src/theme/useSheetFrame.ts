import type { ViewStyle } from "react-native";

import { useIsDesktop } from "@/theme/useIsDesktop";
import { useTheme } from "@/theme/useTheme";

/** Wide enough for a row's title and its one-line description. */
const DESKTOP_SHEET_WIDTH = 480;

/**
 * Where a bottom sheet sits, as two style overrides: one for the full-screen
 * root that holds the scrim, one for the sheet itself.
 *
 * On a phone a sheet rises from the bottom edge, where the thumb already is,
 * and both overrides are empty — every sheet keeps exactly the frame it had.
 * On a desktop the bottom edge of a 2,000-pixel window is nowhere near the
 * pointer, and a sheet the width of the screen is a phone layout stretched; so
 * there the same sheet is a dialog: centred, a fixed width, rounded on every
 * corner and outlined all the way round.
 *
 * Applied after the sheet's own styles, so it only ever replaces placement.
 */
export function useSheetFrame(): { root: ViewStyle | null; sheet: ViewStyle | null } {
  const isDesktop = useIsDesktop();
  const { colors, radii, borderWidth, spacing } = useTheme();
  if (!isDesktop) return { root: null, sheet: null };
  return {
    root: { justifyContent: "center", alignItems: "center", padding: spacing.xl },
    sheet: {
      width: "100%",
      maxWidth: DESKTOP_SHEET_WIDTH,
      alignSelf: "center",
      overflow: "hidden",
      borderRadius: radii.lg * 1.4,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      paddingBottom: spacing.md,
      shadowColor: colors.shadow,
      shadowOpacity: 0.3,
      shadowRadius: 32,
      shadowOffset: { width: 0, height: 12 },
    },
  };
}
