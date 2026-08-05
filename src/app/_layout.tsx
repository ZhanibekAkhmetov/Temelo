import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppStateProvider } from "@/state/AppStateContext";

export default function RootLayout() {
  return (
    // Gesture Handler needs its root view above everything that uses a
    // gesture — the timetable surface and both pickers do.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppStateProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
