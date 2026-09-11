import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";

import { ChoiceRow } from "@/components/ChoiceRow";
import { FormSection } from "@/components/FormSection";
import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import { TextField } from "@/components/TextField";
import { ALL_WEEKEND_MODES, type WeekendMode } from "@/domain/week";
import { useI18n } from "@/i18n/I18nProvider";
import { WEEKEND_MODE_LABEL_KEY } from "@/i18n/weekendMode";
import { useAppState } from "@/state/AppStateContext";
import { MAX_TIMETABLE_NAME_LENGTH } from "@/storage/timetableLifecycle";
import { useTheme } from "@/theme/useTheme";

/**
 * Step one of two: what the timetable is called, and which days it has.
 *
 * No dates. The step this replaces asked for a term name, a start date and an
 * estimated end date, and of those three only the name was ever a decision —
 * the dates were a guess the user had to make before they had seen the app,
 * and the guess then quietly decided when their classes stopped.
 *
 * Nothing is written by this screen. The two answers travel to step two as
 * route parameters and the timetable is created there, in one go, which is
 * what makes backing out of either step leave the current timetable
 * completely untouched.
 */
export default function NewTimetableScreen() {
  const { colors, spacing, typography } = useTheme();
  const { t } = useI18n();
  const { state } = useAppState();

  const [name, setName] = useState("");
  const [weekendMode, setWeekendMode] = useState<WeekendMode>(state.settings.weekendMode);

  const current = state.timetable;
  const trimmedName = name.trim();

  function handleContinue() {
    router.push({
      pathname: "/timetables/new-academic-day",
      params: { name: trimmedName, weekendMode },
    });
  }

  return (
    <ScreenContainer>
      <Text style={[typography.title, { color: colors.textPrimary }]}>{t("timetables.createTitle")}</Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {t("timetables.createSubtitle")}
      </Text>

      {/*
       * Said once, at the start, in plain terms: the timetable they are using
       * is archived *when the new one is created*, and not a moment sooner.
       * The promise is worth stating up front because the alternative is a
       * user who abandons the flow halfway and then has to go and check.
       */}
      {current ? (
        <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.md }]}>
          {t("timetables.createReplaceNotice", { name: current.name })}
        </Text>
      ) : null}

      <FormSection>
        <TextField
          label={t("onboarding.timetableName")}
          value={name}
          onChangeText={setName}
          placeholder={t("onboarding.timetableNamePlaceholder")}
          autoFocus
          maxLength={MAX_TIMETABLE_NAME_LENGTH}
        />
      </FormSection>

      {/*
       * Listed rather than folded into a row that opens a sheet: this and the
       * name are the whole content of the screen, so there is nothing to be
       * compact for, and a list is one tap deep instead of two.
       */}
      <FormSection title={t("settings.daysWithoutClasses")}>
        {ALL_WEEKEND_MODES.map((mode) => (
          <ChoiceRow
            key={mode}
            label={t(WEEKEND_MODE_LABEL_KEY[mode])}
            selected={mode === weekendMode}
            onPress={() => setWeekendMode(mode)}
          />
        ))}
      </FormSection>

      <OnboardingNav
        onBack={router.canGoBack() ? () => router.back() : undefined}
        onContinue={handleContinue}
        continueDisabled={trimmedName.length === 0}
      />
    </ScreenContainer>
  );
}
