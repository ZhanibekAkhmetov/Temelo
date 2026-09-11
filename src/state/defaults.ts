import { startOfWeekIso } from "@/domain/calendar";
import { todayIsoDate } from "@/domain/date";
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
 * Where a new timetable's weekly classes start from.
 *
 * The Monday of the week it is created in, and nothing more. It is not a
 * semester start — nothing ends because of it and it is never shown — it is
 * simply the earliest week a class added to this timetable is visible in, so
 * that paging back through the weeks of a timetable shows the timetable rather
 * than a grid that empties out. See `defaultSeriesStartDate`.
 */
export function defaultTimetableAnchorDate(): string {
  return startOfWeekIso(todayIsoDate());
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
