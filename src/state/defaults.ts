import { startOfWeekIso } from "@/domain/calendar";
import { isValidIsoDate, todayIsoDate } from "@/domain/date";
import { generateTimeSlots } from "@/domain/time";
import { createId } from "@/domain/id";
import { DEFAULT_REMINDER_MINUTES } from "@/domain/reminder";
import { DEFAULT_LANGUAGE_PREFERENCE } from "@/i18n/language";
import { DEFAULT_APPEARANCE_PREFERENCE } from "@/theme/appearance";
import type { Settings, TimeSlot } from "@/types/models";

export const DEFAULT_SETTINGS: Settings = {
  weekendMode: "saturdaySunday",
  gridOrientation: "vertical",
  academicDayStart: "07:30",
  defaultLessonDurationMinutes: 90,
  defaultBreakDurationMinutes: 20,
  slotCount: 8,
  defaultReminderMinutes: DEFAULT_REMINDER_MINUTES,
  // Both default to following the device, which is also what an upgrading
  // user's v4 migration backfills — so a fresh install and an upgrade start
  // in exactly the same place.
  appearancePreference: DEFAULT_APPEARANCE_PREFERENCE,
  languagePreference: DEFAULT_LANGUAGE_PREFERENCE,
  onboardingCompleted: false,
};

/**
 * The start date a new timetable is offered.
 *
 * The Monday of the week it is created in, so a timetable made on a Wednesday
 * still covers the Monday and Tuesday the user can see on the grid. The user
 * can change it in the creation flow and later. It is a start and nothing
 * more: there is no end date, and nothing stops because of it. See
 * `Timetable.anchorDate`.
 */
export function defaultTimetableAnchorDate(): string {
  return startOfWeekIso(todayIsoDate());
}

/**
 * A timetable start date that arrived as untyped input — a route parameter —
 * or the default when it is not a real date. The creation flow carries the
 * date between its two steps this way, so this is where it is checked.
 */
export function timetableStartDateFrom(value: unknown): string {
  return typeof value === "string" && isValidIsoDate(value) ? value : defaultTimetableAnchorDate();
}

export function createDefaultTimeSlots(): TimeSlot[] {
  const result = generateTimeSlots({
    dayStart: DEFAULT_SETTINGS.academicDayStart,
    lessonDurationMinutes: DEFAULT_SETTINGS.defaultLessonDurationMinutes,
    breakDurationMinutes: DEFAULT_SETTINGS.defaultBreakDurationMinutes,
    slotCount: DEFAULT_SETTINGS.slotCount,
  });
  if (!result.ok) {
    throw new Error(`Default academic-day settings failed to generate time slots: ${result.error}`);
  }
  return result.slots.map((slot) => ({
    id: createId(),
    position: slot.position,
    startTime: slot.startTime,
    endTime: slot.endTime,
  }));
}
