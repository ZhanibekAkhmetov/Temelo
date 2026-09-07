/**
 * Which language the app speaks, and how the device's own setting is read.
 *
 * As with the appearance preference, only the *preference* is stored. "System"
 * is a standing instruction to follow the device, not a snapshot of what the
 * device said when the user last opened Settings.
 */

/** The languages Temelo is translated into. English is the source language. */
export const APP_LANGUAGES = ["en", "ru", "de"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** The stored value. Stable: it is written to SQLite and read back. */
export type LanguagePreference = "system" | AppLanguage;

export const LANGUAGE_PREFERENCES: LanguagePreference[] = ["system", "en", "ru", "de"];

export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = "system";
export const FALLBACK_LANGUAGE: AppLanguage = "en";

const APP_LANGUAGE_SET: ReadonlySet<string> = new Set(APP_LANGUAGES);

/** Any stored string, narrowed. An unreadable value falls back to "system". */
export function normalizeLanguagePreference(value: string | null | undefined): LanguagePreference {
  if (value === "system") return "system";
  return typeof value === "string" && APP_LANGUAGE_SET.has(value) ? (value as AppLanguage) : DEFAULT_LANGUAGE_PREFERENCE;
}

/**
 * The first of the device's preferred languages that Temelo can actually
 * speak, or English.
 *
 * The whole ordered list is consulted rather than only the first entry: a
 * phone set to Kazakh with Russian second should get Russian, not English.
 * Matching is on the language subtag alone — `de-AT` and `de-CH` are both
 * German as far as the UI is concerned.
 */
export function languageFromDeviceLocales(languageTags: readonly (string | null | undefined)[]): AppLanguage {
  for (const tag of languageTags) {
    if (!tag) continue;
    const subtag = tag.split("-")[0].toLowerCase();
    if (APP_LANGUAGE_SET.has(subtag)) return subtag as AppLanguage;
  }
  return FALLBACK_LANGUAGE;
}

/** The one resolution rule: an explicit choice wins, "system" asks the device. */
export function resolveLanguage(
  preference: LanguagePreference,
  deviceLanguageTags: readonly (string | null | undefined)[],
): AppLanguage {
  return preference === "system" ? languageFromDeviceLocales(deviceLanguageTags) : preference;
}

/**
 * The BCP 47 tag handed to `Intl` for a given app language.
 *
 * English is deliberately `en-GB`, not `en`. Temelo writes dates day-first
 * throughout — the date fields, the term summary, the picker — and `en-US`
 * would silently turn "Mon, 21 Dec 2026" into "Mon, Dec 21, 2026" in half the
 * app while the input format stayed DD.MM.YYYY.
 */
const INTL_LOCALES: Record<AppLanguage, string> = {
  en: "en-GB",
  ru: "ru-RU",
  de: "de-DE",
};

export function intlLocaleFor(language: AppLanguage): string {
  return INTL_LOCALES[language];
}
