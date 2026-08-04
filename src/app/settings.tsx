import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/Button";
import { DateInput } from "@/components/DateInput";
import { ScreenContainer } from "@/components/ScreenContainer";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TextField } from "@/components/TextField";
import { ALL_WEEKEND_MODES, WEEKEND_MODE_LABEL, type WeekendMode } from "@/domain/week";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

const WEEKEND_MODE_OPTIONS: { label: string; value: WeekendMode }[] = ALL_WEEKEND_MODES.map((mode) => ({
  label: WEEKEND_MODE_LABEL[mode],
  value: mode,
}));

export default function SettingsScreen() {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { state, setWeekendMode, updateTermInfo, resetPrototype } = useAppState();

  const [weekendMode, setWeekendModeLocal] = useState<WeekendMode>(state.settings.weekendMode);
  const [termName, setTermName] = useState(state.term.name);
  const [estimatedEndDate, setEstimatedEndDate] = useState(state.term.estimatedEndDate);
  const [termNameError, setTermNameError] = useState<string | undefined>();
  const [endDateError, setEndDateError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setTermNameError(undefined);
    setEndDateError(undefined);
    setSaved(false);
    setWeekendMode({ weekendMode });
    const result = updateTermInfo({ name: termName, estimatedEndDate });
    if (!result.ok) {
      if (result.error.toLowerCase().includes("name")) {
        setTermNameError(result.error);
      } else {
        setEndDateError(result.error);
      }
      return;
    }
    setSaved(true);
  }

  function handleReset() {
    Alert.alert(
      "Reset prototype?",
      "This clears all settings, the term, and every class, then returns to the start of onboarding. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            resetPrototype();
            // Settings sits on top of timetable in the stack; drop back to
            // timetable first, then replace it, so no stale screen is left
            // underneath the fresh onboarding flow.
            router.dismissAll();
            router.replace("/onboarding/week");
          },
        },
      ],
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.headerRow}>
        <Text style={[typography.title, { color: colors.textPrimary }]}>Settings</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close settings">
          <Text style={[typography.label, { color: colors.accent }]}>Close</Text>
        </Pressable>
      </View>

      <Text style={[typography.label, { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.xs }]}>Weekend</Text>
      <SegmentedControl options={WEEKEND_MODE_OPTIONS} value={weekendMode} onChange={setWeekendModeLocal} accessibilityLabel="Weekend" />

      <Text style={[typography.label, { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.xs }]}>Term</Text>
      <TextField label="Term name" value={termName} onChangeText={setTermName} error={termNameError} />
      <DateInput label="Estimated end date" value={estimatedEndDate} onChangeText={setEstimatedEndDate} error={endDateError} />

      <Button label="Save changes" variant="primary" onPress={handleSave} />
      {saved ? (
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>Saved.</Text>
      ) : null}

      <View style={[styles.divider, { borderTopColor: colors.border, borderTopWidth: borderWidth.thin, marginVertical: spacing.xl }]} />

      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Academic day</Text>
      <Button label="Edit academic-day setup" variant="secondary" onPress={() => router.push("/onboarding/academic-day")} />

      <View style={{ marginTop: spacing.xl }}>
        <Button label="Reset prototype" variant="destructive" onPress={handleReset} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  divider: {
    width: "100%",
  },
});
