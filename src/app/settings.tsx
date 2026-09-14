import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/Button";
import { ChoiceRowField } from "@/components/ChoiceRowField";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormSection } from "@/components/FormSection";
import { ReminderField } from "@/components/ReminderField";
import { ScreenContainer } from "@/components/ScreenContainer";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HapticsDiagnostics } from "@/features/diagnostics/HapticsDiagnostics";
import { RemindersDiagnostics } from "@/features/diagnostics/RemindersDiagnostics";
import { StorageDiagnostics } from "@/features/diagnostics/StorageDiagnostics";
import { useReminderStatus } from "@/features/reminders/useReminderStatus";
import { AboutSection } from "@/features/settings/AboutSection";
import { shapeOfActive, timetableSummary } from "@/features/timetables/summary";
import { TimetableSummaryRow } from "@/features/timetables/TimetableSummaryRow";
import { useI18n } from "@/i18n/I18nProvider";
import { LANGUAGE_PREFERENCES, type LanguagePreference } from "@/i18n/language";
import type { TranslationKey } from "@/i18n/translate";
import { useAppState } from "@/state/AppStateContext";
import { APPEARANCE_PREFERENCES, type AppearancePreference } from "@/theme/appearance";
import { useTheme } from "@/theme/useTheme";
import type { GridOrientation } from "@/types/models";

const APPEARANCE_LABEL_KEY: Record<AppearancePreference, TranslationKey> = {
  system: "settings.appearanceSystem",
  light: "settings.appearanceLight",
  dark: "settings.appearanceDark",
};

const LAYOUT_LABEL_KEY: Record<GridOrientation, TranslationKey> = {
  vertical: "settings.layoutVertical",
  horizontal: "settings.layoutHorizontal",
};

const LAYOUT_ORDER: GridOrientation[] = ["vertical", "horizontal"];

/**
 * The languages are named *in themselves*, not translated.
 *
 * "Русский" is what a Russian speaker looks for in a language list, whatever
 * language the app currently happens to be in — which is exactly the list
 * they need when the app is in a language they cannot read. Only "System" is
 * translated, because it names a behaviour rather than a language.
 */
const LANGUAGE_ENDONYM: Record<Exclude<LanguagePreference, "system">, string> = {
  en: "English",
  ru: "Русский",
  de: "Deutsch",
};

/**
 * Settings.
 *
 * One rule, and now the screen actually keeps it:
 *
 *   A setting that is a single choice applies and persists the moment it is
 *   made. A setting that is several fields at once is a screen of its own.
 *
 * So there is no Save button here at all. Every row on this page commits on
 * tap; the one thing that cannot is a row that leaves for a screen of its own.
 *
 * What this page is *about* narrowed with the timetable lifecycle, and that is
 * the more important change. It used to hold the term, the academic day and
 * the days without classes alongside appearance and language — five rows about
 * the app and three about one particular timetable, in one undifferentiated
 * list. Now the timetable's own properties live on the timetable's own screen,
 * and Settings keeps one row pointing at it. What is left here is true of
 * Temelo however many timetables the user has.
 *
 * The layout is the deliberate exception: it is how the user prefers to read a
 * week grid, not a fact about any particular week in it, so it stays a
 * preference and stays here.
 */
export default function SettingsScreen() {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();
  const {
    state,
    persistence,
    setGridOrientation,
    setAppearancePreference,
    setLanguagePreference,
    setDefaultReminder,
    loadSampleTimetable,
    deleteAllData,
  } = useAppState();
  const reminderStatus = useReminderStatus();
  /** Which of this screen's two whole-app confirmations is open, if either. */
  const [confirming, setConfirming] = useState<"reset" | "sample" | null>(null);

  const appearanceOptions = APPEARANCE_PREFERENCES.map((preference) => ({
    value: preference,
    label: t(APPEARANCE_LABEL_KEY[preference]),
  }));

  const languageOptions = LANGUAGE_PREFERENCES.map((preference) => ({
    value: preference,
    label: preference === "system" ? t("settings.languageSystem") : LANGUAGE_ENDONYM[preference],
  }));

  const layoutOptions = LAYOUT_ORDER.map((orientation) => ({
    value: orientation,
    label: t(LAYOUT_LABEL_KEY[orientation]),
  }));

  /*
   * The one line under the timetable's name: the days it covers and the hours
   * its day runs. The same summary the Timetables screen shows, so the row the
   * user taps and the screen it opens agree about what they are describing.
   */
  const timetableRowTitle = state.timetable?.name ?? t("timetables.noCurrent");
  const timetableRowSubtitle = state.timetable
    ? timetableSummary(t, format, shapeOfActive(state.settings.weekendMode, state.timeSlots))
    : t("timetables.noCurrentHint");

  function confirmLoadSample() {
    setConfirming(null);
    loadSampleTimetable();
    router.dismissAll();
  }

  function confirmReset() {
    setConfirming(null);
    deleteAllData();
    // Settings sits on top of timetable in the stack; drop back to timetable
    // first, then replace it, so no stale screen is left underneath the fresh
    // onboarding flow.
    router.dismissAll();
    router.replace("/timetables/new-timetable");
  }

  return (
    // A pushed screen, so the same header every other pushed screen has: Back
    // at the leading edge. It used to be a Close at the trailing edge, which
    // put the way out on the opposite side from the Timetables screen one tap
    // further in.
    <ScreenContainer
      header={
        <ScreenHeader
          title={t("settings.title")}
          onBack={() => router.back()}
          accessibilityBackLabel={t("common.back")}
        />
      }
    >

      {/* A failed write is the one thing on this screen that has to be said out
          loud, and it belongs at the top rather than beside whichever control
          happened to trigger it: every row here writes immediately, so if
          storage is refusing, none of them are being kept. */}
      {persistence.lastWriteOk === false ? (
        <Text
          style={[
            typography.caption,
            styles.notice,
            {
              color: colors.danger,
              backgroundColor: colors.dangerSurface,
              borderColor: colors.danger,
              borderWidth: borderWidth.thin,
              marginTop: spacing.md,
              padding: spacing.sm,
            },
          ]}
        >
          {t("errors.storageWriteFailed")}
        </Text>
      ) : null}

      {/*
        Timetable first, and the timetable itself first inside it.
        It was below the layout preference, in the value column of a row whose
        label said "Current timetable" — which put the single most important
        thing on this screen in the place the eye uses for "what is this set
        to". Switching, archiving and restoring a timetable is a Beta feature;
        a layout preference is not.
      */}
      <FormSection title={t("settings.sectionTimetable")}>
        {/* One door to everything about timetables — the current one's name,
            days and academic day, the archived ones, and creating another. The
            three rows that used to be here were all reachable through it, and
            keeping them here as well would have made this page the second
            place to change a timetable's shape. */}
        {/* The same row the Timetables screen draws the timetable with, so the
            thing tapped here and the thing on the next screen look like one
            object. Here it stands alone in the form, so it says what it is —
            "Current timetable" — above the name; there, a section heading
            does that job. */}
        <TimetableSummaryRow
          context={t("settings.currentTimetable")}
          name={timetableRowTitle}
          summary={timetableRowSubtitle}
          onPress={() => router.push("/timetables")}
        />
        <ChoiceRowField
          label={t("settings.layout")}
          value={state.settings.gridOrientation}
          options={layoutOptions}
          onChange={(gridOrientation) => setGridOrientation({ gridOrientation })}
          sheetTitle={t("settings.layout")}
          helperText={t("settings.layoutHint")}
        />
      </FormSection>

      <FormSection title={t("settings.sectionGeneral")}>
        <ChoiceRowField
          label={t("settings.appearance")}
          value={state.settings.appearancePreference}
          options={appearanceOptions}
          onChange={(appearancePreference) => setAppearancePreference({ appearancePreference })}
          sheetTitle={t("settings.appearance")}
        />
        {/* A list rather than a fourth segment: "System", "English", "Русский"
            and "Deutsch" do not fit four ways across a phone. */}
        <ChoiceRowField
          label={t("settings.language")}
          value={state.settings.languagePreference}
          options={languageOptions}
          onChange={(languagePreference) => setLanguagePreference({ languagePreference })}
          sheetTitle={t("settings.chooseLanguage")}
        />
      </FormSection>

      <FormSection title={t("reminders.title")}>
        <ReminderField
          label={t("reminders.defaultForNewClasses")}
          value={state.settings.defaultReminderMinutes}
          onChange={(reminderMinutes) => setDefaultReminder({ reminderMinutes })}
          /* Three answers, not two. "Denied" is the only one that is a
             problem; "undetermined" is the ordinary first-run state, and
             saying when the prompt will come is the whole of the rationale
             this screen owes the user — the OS asks at the moment a reminder
             is first due, not here. */
          helperText={
            reminderStatus.permission === "denied"
              ? t("reminders.permissionDenied")
              : reminderStatus.permission === "undetermined"
                ? t("reminders.permissionExplainer")
                : t("reminders.existingKeepTheirOwn")
          }
        />
      </FormSection>

      <AboutSection />

      {/* Last on the page, and the only thing on it that cannot be taken
          back. It keeps its distance from the rows above precisely because
          every one of those commits on tap. */}
      <View style={{ marginTop: spacing.xl }}>
        <Button label={t("settings.reset")} variant="destructive" onPress={() => setConfirming("reset")} />
      </View>

      {/* Development tools. The sample timetable is invented placeholder
          data for exercising gestures; it is not offered to real users, and
          `__DEV__` is compiled out of a release build entirely — so nothing
          below this line can reach one. */}
      {__DEV__ ? (
        <FormSection title={t("settings.developer")}>
          <View style={{ gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.lg }}>
            <Button label={t("settings.loadSample")} variant="secondary" onPress={() => setConfirming("sample")} />
            <StorageDiagnostics />
            <HapticsDiagnostics />
            <RemindersDiagnostics />
          </View>
        </FormSection>
      ) : (
        <View style={{ height: spacing.lg }} />
      )}

      {confirming === "reset" ? (
        <ConfirmDialog
          destructive
          title={t("settings.resetTitle")}
          message={t("settings.resetMessage")}
          confirmLabel={t("settings.resetConfirm")}
          onConfirm={confirmReset}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {confirming === "sample" ? (
        <ConfirmDialog
          title={t("settings.loadSampleTitle")}
          message={t("settings.loadSampleMessage")}
          confirmLabel={t("settings.loadSampleConfirm")}
          onConfirm={confirmLoadSample}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  notice: {
    width: "100%",
  },
});
