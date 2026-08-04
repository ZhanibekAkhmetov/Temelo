import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";

import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";
import { ALL_WEEKEND_MODES, WEEKEND_MODE_LABEL, type WeekendMode } from "@/domain/week";

const WEEKEND_MODE_OPTIONS: { label: string; value: WeekendMode }[] = ALL_WEEKEND_MODES.map((mode) => ({
  label: WEEKEND_MODE_LABEL[mode],
  value: mode,
}));

export default function WeekConfigScreen() {
  const { colors, spacing, typography } = useTheme();
  const { state, setWeekendMode } = useAppState();

  const [weekendMode, setWeekendModeLocal] = useState<WeekendMode>(state.settings.weekendMode);

  function handleContinue() {
    setWeekendMode({ weekendMode });
    router.push("/onboarding/academic-day");
  }

  return (
    <ScreenContainer>
      <Text style={[typography.title, { color: colors.textPrimary }]}>Week layout</Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.xl }]}>
        Choose which days have no classes.
      </Text>

      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Weekend</Text>
      <SegmentedControl options={WEEKEND_MODE_OPTIONS} value={weekendMode} onChange={setWeekendModeLocal} accessibilityLabel="Weekend" />

      <OnboardingNav onContinue={handleContinue} />
    </ScreenContainer>
  );
}
