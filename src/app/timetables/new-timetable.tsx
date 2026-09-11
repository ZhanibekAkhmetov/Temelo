import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { ChoiceRow } from "@/components/ChoiceRow";
import { DateField } from "@/components/DateField";
import { DatePickerSheet } from "@/components/DatePickerSheet";
import { FormSection } from "@/components/FormSection";
import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import { TextField } from "@/components/TextField";
import { ALL_WEEKEND_MODES, type WeekendMode } from "@/domain/week";
import { useI18n } from "@/i18n/I18nProvider";
import { WEEKEND_MODE_LABEL_KEY } from "@/i18n/weekendMode";
import { useAppState } from "@/state/AppStateContext";
import { defaultTimetableAnchorDate } from "@/state/defaults";
import { MAX_TIMETABLE_NAME_LENGTH } from "@/storage/timetableLifecycle";
import { useTheme } from "@/theme/useTheme";

/**
 * Step one of two: what the timetable is called, when it starts, and which
 * days it has.
 *
 * One date, and no end. The step this replaces asked for a term name, a start
 * date and an *estimated end date*, and the end was a guess the user had to
 * make before they had seen the app — which then quietly decided when their
 * classes stopped. The start is a different kind of answer: it is when the
 * timetable begins, it defaults to this week's Monday so a timetable made on a
 * Wednesday still covers the whole week on screen, and it can be moved later.
 *
 * Nothing is written by this screen. The answers travel to step two as route
 * parameters and the timetable is created there, in one go, which is what
 * makes backing out of either step leave the current timetable completely
 * untouched.
 */
export default function NewTimetableScreen() {
  const { colors, spacing, typography } = useTheme();
  const { t } = useI18n();
  const { state } = useAppState();

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(defaultTimetableAnchorDate);
  const [startSheetOpen, setStartSheetOpen] = useState(false);
  const [weekendMode, setWeekendMode] = useState<WeekendMode>(state.settings.weekendMode);

  const current = state.timetable;
  const trimmedName = name.trim();

  function handleContinue() {
    router.push({
      pathname: "/timetables/new-academic-day",
      params: { name: trimmedName, startDate, weekendMode },
    });
  }

  return (
    <View style={{ flex: 1 }}>
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
          <DateField label={t("timetables.startsOn")} value={startDate} onPress={() => setStartSheetOpen(true)} />
        </FormSection>

        {/*
         * Listed rather than folded into a row that opens a sheet: this and the
         * name are most of the screen, so there is nothing to be compact for,
         * and a list is one tap deep instead of two.
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

      {startSheetOpen ? (
        <DatePickerSheet
          title={t("timetables.startDateTitle")}
          value={startDate}
          onCancel={() => setStartSheetOpen(false)}
          onConfirm={(value) => {
            setStartDate(value);
            setStartSheetOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}
