import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BootGate } from "@/components/BootGate";
import { ClassReminderScheduler } from "@/features/reminders/ClassReminderScheduler";
import { ShareReceiver } from "@/features/timetables/ShareReceiver";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AppStateProvider } from "@/state/AppStateContext";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { useTheme } from "@/theme/useTheme";

export default function RootLayout() {
  return (
    // Gesture Handler needs its root view above everything that uses a
    // gesture — the timetable surface and both pickers do.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppStateProvider>
          {/* Both providers read the stored preferences, so they sit inside
              AppStateProvider — and outside BootGate, so that the very first
              frame after hydration is already drawn in the right scheme and
              the right language rather than repainting into them.

              Before hydration they resolve against DEFAULT_SETTINGS, which is
              "follow the device" for both. Nothing is rendered then anyway;
              what it buys is that the native root background is set to the
              device's own scheme while the splash is still up. */}
          <ThemeProvider>
            <I18nProvider>
              {/* Nothing that reads app state may render before storage has
                  been read back — the onboarding redirect least of all. */}
              <BootGate>
                {/* Draws nothing; keeps scheduled reminders in step with the
                    timetable, from one place rather than from every edit site.

                    Deliberately inside the gate. The scheduler reconciles on
                    mount, and mounting it before hydration would reconcile
                    against the empty pre-hydration state — cancelling every
                    stored class's reminder, then rescheduling once the real
                    timetable arrived. Gating it means its first run already
                    sees the persisted timetable. */}
                <ClassReminderScheduler />
                <AppStack />
                {/* A `.temelo` another app shared into Temelo. Draws nothing at
                    all until one arrives, and then draws the whole of what
                    happens to it over the top of whatever is on screen.

                    Beside the navigator rather than inside it, and with no
                    route of its own, because a shared file changes what is
                    *drawn* and never where the app *is*. That is not a
                    stylistic choice — it is the fix for this feature's one
                    recurring failure, which was always a navigation dispatched
                    into a stack that was not there to receive it. As an overlay
                    there is no stack to build, so nothing about launch order,
                    hydration timing or `BootGate` can make it unsafe, and none
                    of those had to change to accommodate it. See
                    `ShareReceiver` and `domain/incomingShare`. */}
                <ShareReceiver />
              </BootGate>
            </I18nProvider>
          </ThemeProvider>
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The navigator, plus the two chrome colours React cannot reach from inside a
 * screen.
 *
 * `contentStyle` paints the stack's own card, which is what shows through
 * during a push transition; the status bar icons have to be inverted against
 * the resolved scheme rather than the device's, or choosing Light on a dark
 * phone would leave white icons on a white header.
 */
function AppStack() {
  const { colors, scheme } = useTheme();

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}
