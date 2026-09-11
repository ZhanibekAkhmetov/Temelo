import { useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import type { DomainError } from "@/domain/errors";
import { ALL_WEEKEND_MODES, type WeekendMode } from "@/domain/week";
import { AcademicDayFields, isUsableAcademicDay } from "@/features/timetables/AcademicDayFields";
import { useI18n } from "@/i18n/I18nProvider";
import { DEFAULT_SETTINGS, timetableStartDateFrom } from "@/state/defaults";
import { useAppState, type AcademicDayConfigInput } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

function weekendModeFrom(value: unknown): WeekendMode {
  return ALL_WEEKEND_MODES.find((mode) => mode === value) ?? DEFAULT_SETTINGS.weekendMode;
}

/**
 * Step two of two: the academic day, and the press that actually creates the
 * timetable.
 *
 * This is the only screen in the flow that writes anything, and it writes
 * everything at once — the new timetable, and the archiving of the old one, in
 * a single storage transaction. Up to the moment Create is pressed the user's
 * current timetable has not been touched, so backing out of here, or out of
 * step one, costs them nothing.
 *
 * The answers from step one arrive as route parameters rather than through
 * a draft held in app state. A draft would be a fifth thing the store had to
 * own, would survive being abandoned, and would need clearing on every exit
 * path; parameters are gone the moment the screen is.
 */
export default function NewAcademicDayScreen() {
  const { colors, spacing, typography } = useTheme();
  const { t } = useI18n();
  const { state, createNewTimetable } = useAppState();
  const params = useLocalSearchParams<{ name?: string; startDate?: string; weekendMode?: string }>();

  const name = typeof params.name === "string" ? params.name : "";
  // Checked, because a route parameter is input: anything that is not a real
  // date becomes this week's Monday rather than a timetable that never starts.
  const startDate = timetableStartDateFrom(params.startDate);
  const weekendMode = weekendModeFrom(params.weekendMode);

  const [academicDay, setAcademicDay] = useState<AcademicDayConfigInput>({
    academicDayStart: DEFAULT_SETTINGS.academicDayStart,
    defaultLessonDurationMinutes: DEFAULT_SETTINGS.defaultLessonDurationMinutes,
    defaultBreakDurationMinutes: DEFAULT_SETTINGS.defaultBreakDurationMinutes,
    slotCount: DEFAULT_SETTINGS.slotCount,
  });
  const [formError, setFormError] = useState<DomainError | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const current = state.timetable;

  /*
   * Creating while another timetable is active archives that one, so the press
   * that does it is confirmed — the same dialog Restore uses, for the same
   * swap. Step one said so up front; this is the moment it actually happens.
   * With nothing active there is nothing to replace, and nothing to ask.
   */
  function handleCreatePress() {
    if (current) setConfirmOpen(true);
    else handleCreate();
  }

  function handleCreate() {
    setConfirmOpen(false);
    setFormError(undefined);
    setBusy(true);
    const defaultName = t("timetables.defaultName");
    void createNewTimetable({ name, defaultName, startDate, weekendMode, academicDay }).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      /*
       * Clear the whole flow off the stack before replacing it, so none of the
       * setup screens is left underneath the timetable — a back gesture used
       * to walk through them one by one and never reach the end.
       */
      router.dismissAll();
      router.replace("/timetable");
    });
  }

  return (
    <View style={{ flex: 1 }}>
    <ScreenContainer>
      <Text style={[typography.title, { color: colors.textPrimary }]}>{t("onboarding.academicDayTitle")}</Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {t("onboarding.academicDaySubtitle")}
      </Text>

      <AcademicDayFields value={academicDay} onChange={setAcademicDay} />

      {formError ? (
        <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
          {t(formError.key, formError.params)}
        </Text>
      ) : null}

      <OnboardingNav
        onBack={() => router.back()}
        onContinue={handleCreatePress}
        continueLabel={t("timetables.createFinish")}
        continueDisabled={busy || !isUsableAcademicDay(academicDay)}
      />
    </ScreenContainer>

      {confirmOpen && current ? (
        <ConfirmDialog
          title={t("timetables.createConfirmTitle")}
          message={t("timetables.createConfirmMessage", { current: current.name })}
          confirmLabel={t("timetables.createConfirm")}
          onConfirm={handleCreate}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </View>
  );
}
