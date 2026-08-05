import type { Weekday, WeekendMode } from "@/domain/week";

export type RecurrenceType = "weekly" | "biweekly" | "once";

/**
 * How the week grid is laid out: "vertical" puts days across the top and
 * periods down the side (the default), "horizontal" is the transposed
 * layout, kept as a setting.
 */
export type GridOrientation = "vertical" | "horizontal";

export interface Settings {
  weekendMode: WeekendMode;
  gridOrientation: GridOrientation;
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
  /** The period the class starts in. */
  timeSlotId: string;
  /**
   * How many consecutive configured periods the class occupies, starting at
   * `timeSlotId`. 1 is a single period; resizing in the grid changes this.
   * Deliberately expressed in periods, not minutes — placements stay
   * aligned to the academic day rather than becoming free-form events.
   */
  slotSpan: number;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
