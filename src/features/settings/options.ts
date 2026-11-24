/**
 * The choices the app-wide settings offer, labelled for the current language.
 *
 * Shared by the Settings screen and the desktop sidebar, which draw the same
 * settings two ways and must never disagree about what the options are called
 * or which hint goes under the reminder default.
 */

import type { ReminderPermission } from "@/util/notifications";
import { useI18n } from "@/i18n/I18nProvider";
import { LANGUAGE_PREFERENCES, type LanguagePreference } from "@/i18n/language";
import type { TranslationKey } from "@/i18n/translate";
import { APPEARANCE_PREFERENCES, type AppearancePreference } from "@/theme/appearance";
import type { GridOrientation } from "@/types/models";

export interface SettingOption<T extends string> {
  value: T;
  label: string;
}

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

export function useSettingOptions() {
  const { t } = useI18n();

  const appearance: SettingOption<AppearancePreference>[] = APPEARANCE_PREFERENCES.map((preference) => ({
    value: preference,
    label: t(APPEARANCE_LABEL_KEY[preference]),
  }));

  const language: SettingOption<LanguagePreference>[] = LANGUAGE_PREFERENCES.map((preference) => ({
    value: preference,
    label: preference === "system" ? t("settings.languageSystem") : LANGUAGE_ENDONYM[preference],
  }));

  const layout: SettingOption<GridOrientation>[] = LAYOUT_ORDER.map((orientation) => ({
    value: orientation,
    label: t(LAYOUT_LABEL_KEY[orientation]),
  }));

  return { appearance, language, layout };
}

/**
 * The line under the default-reminder setting.
 *
 * Four answers, not two. "Denied" is the only one that is a problem;
 * "undetermined" is the ordinary first-run state, and saying when the prompt
 * will come is the whole of the rationale the user is owed — the OS asks at
 * the moment a reminder is first due, not here. "Unavailable" is the web build,
 * which cannot deliver one at all and says where reminders do work.
 */
export function reminderHelperKey(permission: ReminderPermission): TranslationKey {
  switch (permission) {
    case "unavailable":
      return "reminders.unavailable";
    case "denied":
      return "reminders.permissionDenied";
    case "undetermined":
      return "reminders.permissionExplainer";
    case "granted":
      return "reminders.existingKeepTheirOwn";
  }
}
