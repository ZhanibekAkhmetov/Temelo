/**
 * What a refused action says, without saying it in any particular language.
 *
 * The domain and the store used to return finished English sentences, which
 * meant every validation rule quietly owned a piece of UI copy. They now
 * return a *key* and the values that go into it, and the screen that shows
 * the message is the thing that turns it into words — so the same refusal
 * reads correctly in all three languages and the domain stays free of the
 * translation layer at runtime.
 *
 * `TranslationKey` is imported as a type only, so nothing here reaches i18n
 * once compiled: this stays a plain data description of a failure.
 */

import type { TranslateParams, TranslationKey } from "@/i18n/translate";

export interface DomainError {
  key: TranslationKey;
  /** Values the message interpolates — a course name, a limit, a period. */
  params?: TranslateParams;
}

export function domainError(key: TranslationKey, params?: TranslateParams): DomainError {
  return params ? { key, params } : { key };
}
