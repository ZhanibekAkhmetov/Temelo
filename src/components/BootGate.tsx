/**
 * Holds the app back until the stored timetable has been read.
 *
 * Two things depend on this. The obvious one is that the grid would
 * otherwise render an empty week for a frame before the real timetable
 * arrived. The dangerous one is the redirect in `app/index.tsx`, which
 * reads `onboardingCompleted`: rendered against the pre-hydration state it
 * would send an existing user into onboarding, and finishing that would
 * overwrite their real term.
 *
 * The native splash screen stays up for the whole wait, so the delay reads
 * as ordinary launch time rather than as a blank screen.
 */

import { useEffect, type ReactNode } from "react";
import * as SplashScreen from "expo-splash-screen";

import { useAppState } from "@/state/AppStateContext";

// Safe to call at module scope: it only stops the splash from hiding on its
// own, and the effect below is what eventually hides it.
void SplashScreen.preventAutoHideAsync();

export function BootGate({ children }: { children: ReactNode }) {
  const { hydrated } = useAppState();

  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync();
  }, [hydrated]);

  return hydrated ? <>{children}</> : null;
}
