/**
 * Dates, weekdays and durations, in the app's resolved language.
 *
 * Month and weekday names are never written out in the dictionaries. `Intl`
 * already knows them for every locale, knows that German wants "21. Dez." and
 * English "21 Dec", and knows the capitalisation each language uses — and a
 * hand-kept table of twelve months × three languages is a table that goes
 * wrong the first time a fourth language is added.
 *
 * What is *not* localised, on purpose:
 *
 *  - stored dates, which stay ISO `YYYY-MM-DD` everywhere in the domain and
 *    in SQLite. Nothing here parses or writes storage; it only renders.
 *  - times of day, which stay 24-hour `HH:mm`. The academic day is configured
 *    in 24-hour form, the grid gutter reads it, and period boundaries are
 *    compared as strings — turning them into locale time would change data
 *    semantics to gain nothing.
 */

import { ALL_WEEKDAYS_MONDAY_FIRST, type Weekday } from "@/domain/week";
import { intlLocaleFor, type AppLanguage } from "@/i18n/language";
import type { Translate } from "@/i18n/translate";

/**
 * A Monday, used as the reference date for weekday names.
 *
 * 1 January 2024 was a Monday, so index 0 of `ALL_WEEKDAYS_MONDAY_FIRST`
 * lands on it and each following weekday is one day later. Any Monday would
 * do; this one is written as local calendar parts so it cannot shift across a
 * time zone on the way in.
 */
const WEEKDAY_REFERENCE_MONDAY = new Date(2024, 0, 1);

function toLocalDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * `Intl.DateTimeFormat` construction is the expensive half of formatting, and
 * the grid asks for weekday names once per column per page. One cache per
 * locale-and-options, built lazily, keeps that to a single construction.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, options);
  formatterCache.set(key, created);
  return created;
}

/**
 * Formats, then drops any trailing literal the locale appended.
 *
 * Russian renders a numeric year as "2026 г."; the era marker is correct
 * prose and wrong for a compact date field, which is the one place the brief
 * asks for "пн, 21 дек. 2026". Trimming *trailing literals* is the general
 * form of that: it removes whatever a locale puts after the last real field
 * and leaves every locale that puts nothing there — English and German among
 * them — exactly as `format` produced it.
 */
function formatTrimmed(instance: Intl.DateTimeFormat, date: Date): string {
  const parts = instance.formatToParts(date);
  let end = parts.length;
  while (end > 0 && parts[end - 1].type === "literal") end -= 1;
  return parts
    .slice(0, end)
    .map((part) => part.value)
    .join("");
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toLocaleUpperCase() + value.slice(1);
}

export interface AppFormat {
  /** The timetable header: "SEP 2026", "СЕНТ. 2026", "SEP. 2026". */
  monthShortYear: (iso: string) => string;
  /** The month picker's heading: "September 2026", "Сентябрь 2026". */
  monthYear: (iso: string) => string;
  /** A date field's collapsed value: "Mon, 21 Dec 2026", "Mo., 21. Dez. 2026". */
  dateLong: (iso: string) => string;
  /** Day-header and calendar column letters: "MON", "ПН", "MO". */
  weekdayShort: (weekday: Weekday) => string;
  /** Two letters, for the month picker's narrow columns. */
  weekdayNarrow: (weekday: Weekday) => string;
  /** Spoken form, for accessibility labels: "Monday", "понедельник". */
  weekdayLong: (weekday: Weekday) => string;
  /** A length of time as a field value: "1 h 30 min", "1 Std. 30 Min.". */
  duration: (totalMinutes: number) => string;
  /** A reminder's lead time on its own: "30 min", "1 hour", "2 Std.". */
  leadTime: (minutes: number) => string;
  /** A reminder as a row's value: "30 min before", "за 30 мин", "Keine". */
  reminderValue: (minutes: number | null) => string;
}

/**
 * Every formatter the UI needs, bound to one language.
 *
 * Takes `t` rather than reaching for a global one, so this stays a pure
 * function of its inputs and the same call works inside a component and
 * inside the notification scheduler.
 */
export function createFormat(language: AppLanguage, t: Translate): AppFormat {
  const locale = intlLocaleFor(language);

  const weekdayNameCache = new Map<string, string>();
  const weekdayName = (weekday: Weekday, options: Intl.DateTimeFormatOptions, cacheKey: string): string => {
    const key = `${cacheKey}|${weekday}`;
    const cached = weekdayNameCache.get(key);
    if (cached !== undefined) return cached;

    const index = ALL_WEEKDAYS_MONDAY_FIRST.indexOf(weekday);
    const date = new Date(WEEKDAY_REFERENCE_MONDAY);
    date.setDate(date.getDate() + Math.max(0, index));
    const value = formatter(locale, options).format(date);
    weekdayNameCache.set(key, value);
    return value;
  };

  return {
    monthShortYear: (iso) => {
      const date = toLocalDate(iso);
      if (Number.isNaN(date.getTime())) return iso;
      // Month and year are composed rather than formatted together, so no
      // locale can slip an era marker between them in a header this narrow.
      const month = formatter(locale, { month: "short" }).format(date);
      return `${month.toLocaleUpperCase(locale)} ${date.getFullYear()}`;
    },

    monthYear: (iso) => {
      const date = toLocalDate(iso);
      if (Number.isNaN(date.getTime())) return iso;
      // Russian month names are lower-case in isolation; as a heading they
      // read as a title, so the first letter is raised.
      const month = capitalize(formatter(locale, { month: "long" }).format(date));
      return `${month} ${date.getFullYear()}`;
    },

    dateLong: (iso) => {
      const date = toLocalDate(iso);
      if (Number.isNaN(date.getTime())) return iso;
      return formatTrimmed(
        formatter(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
        date,
      );
    },

    weekdayShort: (weekday) => weekdayName(weekday, { weekday: "short" }, "short"),
    weekdayNarrow: (weekday) => weekdayName(weekday, { weekday: "short" }, "short").slice(0, 2),
    weekdayLong: (weekday) => weekdayName(weekday, { weekday: "long" }, "long"),

    duration: (totalMinutes) => {
      if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return t("duration.minutes", { minutes: 0 });
      const hours = Math.floor(totalMinutes / 60);
      const minutes = Math.round(totalMinutes % 60);
      if (hours === 0) return t("duration.minutes", { minutes });
      if (minutes === 0) return t("duration.hours", { hours });
      return t("duration.hoursMinutes", { hours, minutes });
    },

    leadTime: (minutes) => {
      const whole = Math.max(0, Math.round(minutes));
      if (whole < 60) return t("reminders.leadMinutes", { minutes: whole });

      const hours = Math.floor(whole / 60);
      const rest = whole % 60;
      /*
       * Two plural forms, not `Intl.PluralRules`.
       *
       * English and German need exactly this distinction. Russian would need
       * four — час/часа/часов — which is precisely why its dictionary uses the
       * abbreviation "ч" that Russian app UI uses anyway: both its forms are
       * the same string, so a two-way choice is not an approximation there,
       * it is the right answer.
       */
      const hourPart = hours === 1 ? t("reminders.leadHoursOne") : t("reminders.leadHoursOther", { hours });
      return rest === 0 ? hourPart : t("reminders.leadHoursAndMinutes", { hours: hourPart, minutes: rest });
    },

    reminderValue(minutes) {
      return minutes === null ? t("common.none") : t("reminders.before", { lead: this.leadTime(minutes) });
    },
  };
}
