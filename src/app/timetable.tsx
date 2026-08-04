import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { ClassEditorModal } from "@/features/timetable/ClassEditorModal";
import { WeekGrid, type SelectedCell } from "@/features/timetable/WeekGrid";
import { getCurrentWeekday, getOrderedWeekdays } from "@/domain/week";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

export default function TimetableScreen() {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { state } = useAppState();
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  const weekdays = getOrderedWeekdays(state.settings.weekendMode);
  const todayWeekday = getCurrentWeekday();

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top", "left", "right"]}>
      <View
        style={[
          styles.header,
          { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: borderWidth.thin, borderColor: colors.border },
        ]}
      >
        <View>
          <Text style={[typography.subtitle, { color: colors.textPrimary }]}>Temelo</Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{state.term.name}</Text>
        </View>
        <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="Settings" hitSlop={8}>
          <Text style={[typography.label, { color: colors.accent }]}>Settings</Text>
        </Pressable>
      </View>

      <WeekGrid
        weekdays={weekdays}
        timeSlots={state.timeSlots}
        placements={state.placements}
        courses={state.courses}
        todayWeekday={todayWeekday}
        onCellPress={setSelected}
      />

      {selected ? (
        <ClassEditorModal
          visible
          onClose={() => setSelected(null)}
          weekday={selected.weekday}
          timeSlot={selected.timeSlot}
          term={state.term}
          existing={selected.existing}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
