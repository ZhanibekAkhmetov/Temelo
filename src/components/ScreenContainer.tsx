import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/theme/useTheme";

interface ScreenContainerProps {
  children: ReactNode;
  scroll?: boolean;
  /**
   * A top app bar, drawn above the content and outside its padding and its
   * scroll — so it keeps its own full-width background and stays put while the
   * page moves under it. See `ScreenHeader`.
   */
  header?: ReactNode;
}

export function ScreenContainer({ children, scroll = true, header }: ScreenContainerProps) {
  const { colors, spacing } = useTheme();

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: spacing.lg }}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top", "left", "right", "bottom"]}>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
