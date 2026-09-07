/**
 * What a class reminder *is*, apart from how it is delivered.
 *
 * A reminder is stored as a lead time — how many minutes before the class
 * starts it should fire — rather than as an instant, for the same reason
 * lesson times are a weekday plus HH:mm: the class is a rule, and the rule
 * has to survive being moved to another period, another day, or another
 * week without the reminder having to be recomputed and re-stored.
 *
 * Nothing here knows about the notification system. Turning a lead time into
 * an actual moment is `domain/reminderSchedule`; delivering it is
 * `util/notifications`; and putting one into words is `i18n/format`, which is
 * where it has to live now that the words depend on the chosen language.
 */

/** Minutes before a class starts, or null when the class has no reminder. */
export type ReminderMinutes = number | null;

/**
 * A single occurrence's reminder, as an exception records it.
 *
 * The other override fields can say "follow the series" with null, because
 * their own values are never null. A reminder's value *can* be null — that
 * is what "None" means — so the two would be indistinguishable. `"none"` is
 * the deliberate no-reminder override; null still means untouched.
 */
export type ReminderOverride = number | "none" | null;

/** The initial global default, before the user has expressed a preference. */
export const DEFAULT_REMINDER_MINUTES = 30;

/** The lead times offered as one-tap choices, in order. */
export const REMINDER_PRESETS: number[] = [10, 30, 60];

/** Widest custom lead time the picker offers — a full day is plenty. */
export const MAX_REMINDER_HOURS = 24;

/** The reminder an occurrence actually has, once its override is folded in. */
export function resolveReminder(seriesValue: ReminderMinutes, override: ReminderOverride): ReminderMinutes {
  if (override === null) return seriesValue;
  return override === "none" ? null : override;
}

/**
 * How an occurrence's chosen reminder is stored against its series: null
 * when it agrees with the series, so a later series-wide edit still reaches
 * it, and an explicit override when it does not.
 */
export function reminderOverrideFor(value: ReminderMinutes, seriesValue: ReminderMinutes): ReminderOverride {
  if (value === seriesValue) return null;
  return value === null ? "none" : value;
}

/** Whether a lead time is one of the preset choices rather than a custom one. */
export function isPresetReminder(minutes: ReminderMinutes): boolean {
  return minutes !== null && REMINDER_PRESETS.includes(minutes);
}
