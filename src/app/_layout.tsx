import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BootGate } from "@/components/BootGate";
import { ClassReminderScheduler } from "@/features/reminders/ClassReminderScheduler";
import { AppStateProvider } from "@/state/AppStateContext";

export default function RootLayout() {
  return (
    // Gesture Handler needs its root view above everything that uses a
    // gesture — the timetable surface and both pickers do.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppStateProvider>
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
            <Stack screenOptions={{ headerShown: false }} />
          </BootGate>
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
