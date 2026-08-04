import type { Weekday, WeekendMode } from "@/domain/week";

export type RecurrenceType = "weekly" | "biweekly" | "once";

export interface Settings {
  weekendMode: WeekendMode;
  academicDayStart: string;
  defaultLessonDurationMinutes: number;
  defaultBreakDurationMinutes: number;
  slotCount: number;
  onboardingCompleted: boolean;
}

export interface AcademicTerm {
  id: string;
  name: string;
  startDate: string;
  estimatedEndDate: string;
}

export interface TimeSlot {
  id: string;
  position: number;
  startTime: string;
  endTime: string;
}

export interface Course {
  id: string;
  name: string;
  room: string;
  teacher: string;
  notes: string;
  appearanceId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Placement {
  id: string;
  courseId: string;
  weekday: Weekday;
  timeSlotId: string;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
