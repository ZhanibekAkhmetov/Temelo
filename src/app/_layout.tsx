import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppStateProvider } from "@/state/AppStateContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
