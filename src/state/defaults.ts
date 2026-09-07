import { addDaysIso, todayIsoDate } from "@/domain/date";
import { generateTimeSlots } from "@/domain/time";
import { createId } from "@/domain/id";
import { DEFAULT_REMINDER_MINUTES } from "@/domain/reminder";
import { DEFAULT_LANGUAGE_PREFERENCE } from "@/i18n/language";
import { DEFAULT_APPEARANCE_PREFERENCE } from "@/theme/appearance";
import type { AcademicTerm, Settings, TimeSlot } from "@/types/models";

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

const DEFAULT_TERM_LENGTH_DAYS = 16 * 7;

/**
 * The seed term.
 *
 * The name is left empty rather than seeded with "Current term". A term name
 * is the user's own data, and seeding it in English would put an English
 * string into a Russian or German user's database before they had typed
 * anything. Onboarding prefills the field with a translated suggestion
 * instead, which they confirm or replace — so the data is theirs and the
 * suggestion is in their language.
 */
export function createDefaultTerm(): AcademicTerm {
  const startDate = todayIsoDate();
  return {
    id: createId(),
    name: "",
    startDate,
    estimatedEndDate: addDaysIso(startDate, DEFAULT_TERM_LENGTH_DAYS),
  };
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
