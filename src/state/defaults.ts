import { addDaysIso, todayIsoDate } from "@/domain/date";
import { generateTimeSlots } from "@/domain/time";
import { createId } from "@/domain/id";
import type { AcademicTerm, Settings, TimeSlot } from "@/types/models";

export const DEFAULT_SETTINGS: Settings = {
  weekendMode: "saturdaySunday",
  academicDayStart: "07:30",
  defaultLessonDurationMinutes: 90,
  defaultBreakDurationMinutes: 20,
  slotCount: 8,
  onboardingCompleted: false,
};

const DEFAULT_TERM_LENGTH_DAYS = 16 * 7;

export function createDefaultTerm(): AcademicTerm {
  const startDate = todayIsoDate();
  return {
    id: createId(),
    name: "Current term",
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
