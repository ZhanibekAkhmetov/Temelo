import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/Button";
import { ChoiceRowField } from "@/components/ChoiceRowField";
import { FormSection, NavigationRow } from "@/components/FormSection";
import { ReminderField } from "@/components/ReminderField";
import { ScreenContainer } from "@/components/ScreenContainer";
import { HapticsDiagnostics } from "@/features/diagnostics/HapticsDiagnostics";
import { RemindersDiagnostics } from "@/features/diagnostics/RemindersDiagnostics";
import { StorageDiagnostics } from "@/features/diagnostics/StorageDiagnostics";
import { useReminderStatus } from "@/features/reminders/useReminderStatus";
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
  const { t } = useI18n();
  const {
    state,
    persistence,
    setGridOrientation,
    setAppearancePreference,
    setLanguagePreference,
    setDefaultReminder,
    loadSampleTimetable,
    resetPrototype,
  } = useAppState();
  const reminderStatus = useReminderStatus();

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

  function handleLoadSample() {
    Alert.alert(t("settings.loadSampleTitle"), t("settings.loadSampleMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.loadSampleConfirm"),
        onPress: () => {
          loadSampleTimetable();
          router.dismissAll();
        },
      },
    ]);
  }

  function handleReset() {
    Alert.alert(t("settings.resetTitle"), t("settings.resetMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.resetConfirm"),
        style: "destructive",
        onPress: () => {
          resetPrototype();
          // Settings sits on top of timetable in the stack; drop back to
          // timetable first, then replace it, so no stale screen is left
          // underneath the fresh onboarding flow.
          router.dismissAll();
          router.replace("/timetables/new-timetable");
        },
      },
    ]);
  }

  return (
    <ScreenContainer>
      <View style={styles.headerRow}>
        <Text style={[typography.title, styles.title, { color: colors.textPrimary }]}>{t("settings.title")}</Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          hitSlop={8}
          pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
          style={({ pressed }) => [styles.closeTarget, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Text style={[typography.label, { color: colors.accentStrong }]}>{t("common.close")}</Text>
        </Pressable>
      </View>

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

      <FormSection title={t("settings.sectionTimetable")}>
        <ChoiceRowField
          label={t("settings.layout")}
          value={state.settings.gridOrientation}
          options={layoutOptions}
          onChange={(gridOrientation) => setGridOrientation({ gridOrientation })}
          sheetTitle={t("settings.layout")}
        />
        {/* One door to everything about timetables — the current one's name,
            days and academic day, the archived ones, and creating another. The
            three rows that used to be here were all reachable through it, and
            keeping them here as well would have made this page the second
            place to change a timetable's shape. */}
        <NavigationRow
          label={t("settings.currentTimetable")}
          value={state.timetable?.name ?? t("settings.noTimetable")}
          onPress={() => router.push("/timetables")}
        />
      </FormSection>

      <FormSection title={t("reminders.title")}>
        <ReminderField
          label={t("reminders.defaultForNewClasses")}
          value={state.settings.defaultReminderMinutes}
          onChange={(reminderMinutes) => setDefaultReminder({ reminderMinutes })}
          helperText={
            reminderStatus.permission === "denied"
              ? t("reminders.permissionDenied")
              : t("reminders.existingKeepTheirOwn")
          }
        />
      </FormSection>

      <View style={{ marginTop: spacing.xl }}>
        <Button label={t("settings.reset")} variant="destructive" onPress={handleReset} />
      </View>

      {/* Development tools. The sample timetable is invented placeholder
          data for exercising gestures; it is not offered to real users, and
          `__DEV__` is compiled out of a release build entirely — so nothing
          below this line can reach one. */}
      {__DEV__ ? (
        <FormSection title={t("settings.developer")}>
          <View style={{ gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.lg }}>
            <Button label={t("settings.loadSample")} variant="secondary" onPress={handleLoadSample} />
            <StorageDiagnostics />
            <HapticsDiagnostics />
            <RemindersDiagnostics />
          </View>
        </FormSection>
      ) : (
        <View style={{ height: spacing.lg }} />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    flexShrink: 1,
  },
  closeTarget: {
    minWidth: 44,
    height: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  notice: {
    width: "100%",
  },
});
