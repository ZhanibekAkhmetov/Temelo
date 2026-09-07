/**
 * Resolving the appearance preference, once, for the whole app.
 *
 * There is exactly one path from a stored preference to a colour:
 *
 *     preference === "system" ? deviceScheme : preference   ->   tokens
 *
 * and it runs here. `useColorScheme` is read in this one place — nowhere else
 * in the app calls it — so "follow the device" and "override the device" are
 * the same code path with a different input, and a component can never
 * accidentally follow the device while the rest of the app is overriding it.
 *
 * The context value is memoised on the resolved scheme alone. That matters
 * more than it looks: this provider re-renders on every app-state change, and
 * an unmemoised value would re-render all twenty-odd theme consumers — the
 * grid's blocks and gutter among them — on every drag.
 *
 * What this provider must *not* do, and does not do: touch the timetable's
 * geometry. It hands out colours. Zoom, scroll, the horizontal offset, the
 * page position and the shared values behind them belong to
 * `TimetableSurface`, which is not a consumer of this context at all — so a
 * theme change cannot reach them even by accident.
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import * as SystemUI from "expo-system-ui";

import { useAppState } from "@/state/AppStateContext";
import { resolveColorScheme, type ColorSchemeName } from "@/theme/appearance";
import {
  borderWidth,
  darkColors,
  lightColors,
  radii,
  spacing,
  typography,
  type ColorTokens,
} from "@/theme/tokens";

export interface Theme {
  colors: ColorTokens;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  borderWidth: typeof borderWidth;
  /** The scheme actually in force, never the preference. */
  scheme: ColorSchemeName;
}

/**
 * The pre-provider value. Only reachable if a component renders outside the
 * provider; a sensible theme is a better failure than a thrown error on a
 * screen the user is looking at.
 */
const FALLBACK_THEME: Theme = {
  colors: lightColors,
  spacing,
  radii,
  typography,
  borderWidth,
  scheme: "light",
};

const ThemeContext = createContext<Theme>(FALLBACK_THEME);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Live: RN re-renders this on a device appearance change, which is what
  // makes "System" follow Android without any listener of our own.
  const deviceScheme = useColorScheme();
  const { state } = useAppState();
  const scheme = resolveColorScheme(state.settings.appearancePreference, deviceScheme);

  const theme = useMemo<Theme>(
    () => ({
      colors: scheme === "dark" ? darkColors : lightColors,
      spacing,
      radii,
      typography,
      borderWidth,
      scheme,
    }),
    [scheme],
  );

  /*
   * The native root view underneath React.
   *
   * React only paints where a view actually is; the ground it is composited
   * onto is the window's, and during a navigation transition or a keyboard
   * resize that ground is briefly visible. Left at the platform default it
   * flashes white in dark mode — so it follows the resolved scheme too.
   *
   * Fire-and-forget on purpose: a device that cannot set it is not a reason
   * to fail a render, and the app is fully legible either way.
   */
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.background).catch((error: unknown) => {
      console.warn("[temelo/theme] could not set the root background colour", error);
    });
  }, [theme.colors.background]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
