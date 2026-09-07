/**
 * Looking a key up, and filling its placeholders.
 *
 * Deliberately about forty lines rather than a library. Three languages, no
 * gender agreement, no runtime-loaded catalogues and no lazy namespaces —
 * i18next would add a dependency, a plugin chain and an initialisation step
 * to do exactly this, and would give up the one thing that matters most here:
 * `TranslationKey` is a literal union, so `t("settings.appearence")` does not
 * compile.
 *
 * No React in this module. It is a pure function of a language, which is what
 * lets the notification text — built well outside the render tree — be
 * translated by the same code the screens use.
 */

import { FALLBACK_LANGUAGE, type AppLanguage } from "@/i18n/language";
import { de } from "@/i18n/translations/de";
import { en, type TranslationKey, type Translations } from "@/i18n/translations/en";
import { ru } from "@/i18n/translations/ru";

export type { TranslationKey };

export type TranslateParams = Record<string, string | number>;

export type Translate = (key: TranslationKey, params?: TranslateParams) => string;

const DICTIONARIES: Record<AppLanguage, Translations> = { en, ru, de };

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Substitutes `{name}` from `params`.
 *
 * A placeholder with no matching parameter is left standing rather than
 * replaced with `undefined`: the brief's rule is that the user never sees
 * "undefined", and a visible `{name}` is at least self-describing while a
 * silent empty string would read as a finished sentence with a hole in it.
 */
function fill(template: string, params: TranslateParams | undefined): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * The translator for one language.
 *
 * The English fallback is belt and braces: `Translations` is a complete
 * record, so a missing key cannot get past the type checker. It survives for
 * the cases types do not cover — a key read from stored data, a dictionary
 * edited by hand — and it warns in development rather than in production,
 * where a console line helps nobody and the fallback already did the work.
 */
export function createTranslate(language: AppLanguage): Translate {
  const dictionary = DICTIONARIES[language] ?? DICTIONARIES[FALLBACK_LANGUAGE];

  return (key, params) => {
    const template = dictionary[key];
    if (template !== undefined) return fill(template, params);

    if (__DEV__) {
      console.warn(`[temelo/i18n] missing "${language}" translation for "${key}"; falling back to English`);
    }
    return fill(en[key] ?? key, params);
  };
}
