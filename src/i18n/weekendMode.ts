/**
 * Which translation names each weekend mode.
 *
 * One table rather than one per screen. Three screens ask the question now —
 * Settings used to be the only one — and three copies of a
 * `Record<WeekendMode, TranslationKey>` is three places to forget a mode when
 * a fourth is added, which the type would catch here once instead of nowhere.
 */

import type { WeekendMode } from "@/domain/week";
import type { TranslationKey } from "@/i18n/translate";

export const WEEKEND_MODE_LABEL_KEY: Record<WeekendMode, TranslationKey> = {
  saturdaySunday: "week.weekendSaturdaySunday",
  sundayOnly: "week.weekendSundayOnly",
  none: "week.weekendNone",
};
