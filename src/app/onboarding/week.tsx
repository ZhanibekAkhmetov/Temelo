import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";

import { ChoiceRow } from "@/components/ChoiceRow";
import { FormSection } from "@/components/FormSection";
import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import { useAppState } from "@/state/AppStateContext";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/translate";
import { useTheme } from "@/theme/useTheme";
import { ALL_WEEKEND_MODES, type WeekendMode } from "@/domain/week";

const WEEKEND_MODE_LABEL_KEY: Record<WeekendMode, TranslationKey> = {
  saturdaySunday: "week.weekendSaturdaySunday",
  sundayOnly: "week.weekendSundayOnly",
  none: "week.weekendNone",
};

/**
 * The first step: which days have no classes.
 *
 * The options are listed rather than squeezed into a segmented control or
 * hidden behind a row that opens one. This is the whole content of the screen,
 * so there is nothing to be compact for — and a list is the same shape the
 * pickers everywhere else in the app use, one tap deep instead of two.
 */
export default function WeekConfigScreen() {
  const { colors, spacing, typography } = useTheme();
  const { t } = useI18n();
  const { state, setWeekendMode } = useAppState();

  const [weekendMode, setWeekendModeLocal] = useState<WeekendMode>(state.settings.weekendMode);

  function handleContinue() {
    setWeekendMode({ weekendMode });
    router.push("/onboarding/academic-day");
  }

  return (
    <ScreenContainer>
      <Text style={[typography.title, { color: colors.textPrimary }]}>{t("onboarding.weekTitle")}</Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {t("onboarding.weekSubtitle")}
      </Text>

      <FormSection title={t("settings.daysWithoutClasses")}>
        {ALL_WEEKEND_MODES.map((mode) => (
          <ChoiceRow
            key={mode}
            label={t(WEEKEND_MODE_LABEL_KEY[mode])}
            selected={mode === weekendMode}
            onPress={() => setWeekendModeLocal(mode)}
          />
        ))}
      </FormSection>

      <OnboardingNav onContinue={handleContinue} />
    </ScreenContainer>
  );
}
