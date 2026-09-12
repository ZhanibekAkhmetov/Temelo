import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { ChoiceRow } from "@/components/ChoiceRow";
import { DateField } from "@/components/DateField";
import { DatePickerSheet } from "@/components/DatePickerSheet";
import { FormSection } from "@/components/FormSection";
import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextField } from "@/components/TextField";
import { nextDefaultTimetableName } from "@/domain/timetableName";
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
  const { state, readArchivedTimetables } = useAppState();

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(defaultTimetableAnchorDate);
  const [startSheetOpen, setStartSheetOpen] = useState(false);
  const [weekendMode, setWeekendMode] = useState<WeekendMode>(state.settings.weekendMode);
  /** Every archived name, so the placeholder can say which number is free. */
  const [archivedNames, setArchivedNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void readArchivedTimetables().then((list) => {
      if (!cancelled) setArchivedNames(list.map((entry) => entry.name));
    });
    return () => {
      cancelled = true;
    };
  }, [readArchivedTimetables]);

  const current = state.timetable;

  /*
   * The name a blank field would actually produce — "Timetable1",
   * "Расписание1" — rather than the bare word, which was a number out from
   * what the user then saw on the next screen.
   *
   * A preview only: the real name is chosen inside the transaction that
   * creates the timetable, against the names that exist at that moment. The
   * current timetable is archived rather than removed by this flow, so its
   * name is taken too.
   */
  const namePlaceholder = nextDefaultTimetableName(t("timetables.defaultName"), [
    ...(current ? [current.name] : []),
    ...archivedNames,
  ]);

  function handleContinue() {
    // Blank travels as blank. The name is only generated when the timetable
    // is actually created, so walking back out of the flow reserves nothing.
    router.push({
      pathname: "/timetables/new-academic-day",
      params: { name: name.trim(), startDate, weekendMode },
    });
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Back at the top-left like every pushed screen. On first launch there
          is nothing to go back to, and the header keeps the slot empty. */}
      <ScreenContainer
        header={
          <ScreenHeader
            title={t("timetables.createTitle")}
            onBack={router.canGoBack() ? () => router.back() : undefined}
            accessibilityBackLabel={t("common.back")}
          />
        }
      >
        <Text style={[typography.body, { color: colors.textSecondary }]}>
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
          {/* Optional. The placeholder is the name a blank field becomes, so
              leaving it empty is visibly a choice rather than an omission. */}
          <TextField
            label={t("onboarding.timetableName")}
            value={name}
            onChangeText={setName}
            placeholder={namePlaceholder}
            helperText={t("timetables.nameOptionalHint")}
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

        <OnboardingNav onContinue={handleContinue} />
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
