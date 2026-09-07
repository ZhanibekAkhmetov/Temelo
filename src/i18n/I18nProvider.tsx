/**
 * Resolving the language preference, once, for the whole app.
 *
 * The same shape as `ThemeProvider`, and for the same reasons: one resolution
 * path, one memoised value, and no screen anywhere containing a
 * `language === "ru" ? … : …`.
 *
 *     preference === "system" ? deviceLanguage : preference   ->   dictionary
 *
 * `useLocales` is expo-localization's live hook: on Android the user can
 * change the phone's language list without restarting apps, and this
 * re-renders when they do — so "System" keeps following the device for as
 * long as it is selected, and stops the moment it is not.
 *
 * Like the theme, this hands out strings and nothing else. The timetable's
 * geometry is not a consumer of this context, so a language change cannot
 * reach zoom, scroll, the week pager or the horizontal offset.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useDeviceLanguageTags } from "@/i18n/deviceLocales";
import { createFormat, type AppFormat } from "@/i18n/format";
import { resolveLanguage, type AppLanguage } from "@/i18n/language";
import { createTranslate, type Translate } from "@/i18n/translate";
import { useAppState } from "@/state/AppStateContext";

export interface I18n {
  t: Translate;
  format: AppFormat;
  /** The language actually in force, never the preference. */
  language: AppLanguage;
}

function buildI18n(language: AppLanguage): I18n {
  const t = createTranslate(language);
  return { t, format: createFormat(language, t), language };
}

/** English, for a component that somehow renders outside the provider. */
const FALLBACK_I18N = buildI18n("en");

const I18nContext = createContext<I18n>(FALLBACK_I18N);

export function I18nProvider({ children }: { children: ReactNode }) {
  // The whole ordered preference list, not just the first entry: a phone set
  // to a language Temelo does not speak, with German second, should get
  // German rather than English.
  const deviceLanguageTags = useDeviceLanguageTags();
  const { state } = useAppState();

  const language = resolveLanguage(state.settings.languagePreference, deviceLanguageTags);

  // Memoised on the resolved language alone. This provider re-renders on
  // every app-state change, and rebuilding the value would re-render every
  // consumer — the grid included — on each one.
  const value = useMemo(() => buildI18n(language), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
