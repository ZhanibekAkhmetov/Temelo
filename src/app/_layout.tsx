import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BootGate } from "@/components/BootGate";
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
            <Stack screenOptions={{ headerShown: false }} />
          </BootGate>
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
