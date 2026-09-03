import type { ReminderMinutes, ReminderOverride } from "@/domain/reminder";
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
  /**
   * Lead time a newly created class starts out with. Existing classes carry
   * their own reminder, so changing this never reaches back into them.
   */
  defaultReminderMinutes: ReminderMinutes;
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

/**
 * Whether an exception replaces its occurrence with an altered one, or
 * removes it from the series altogether.
 */
export type OccurrenceExceptionState = "modified" | "cancelled";

/**
 * One occurrence of a recurring placement that does not follow the rest of
 * its series — the "only this occurrence" edit.
 *
 * It is a delta, never a second copy of the placement: `originalDate` names
 * which occurrence of the base series it replaces, and every override is
 * nullable so an untouched field keeps following the series. That is what
 * lets a later series-wide edit reach this occurrence too, for everything
 * the user did not deliberately change here.
 */
export interface OccurrenceException {
  id: string;
  /** The series this occurrence belongs to. */
  placementId: string;
  /** Date the occurrence has in the base series — its identity, date-only. */
  originalDate: string;
  /** Date it actually happens on; equal to `originalDate` unless it moved. */
  effectiveDate: string;
  state: OccurrenceExceptionState;
  /** Schedule overrides. null means "whatever the series says". */
  timeSlotId: string | null;
  slotSpan: number | null;
  /** Course-field overrides. null means "whatever the course says". */
  name: string | null;
  room: string | null;
  teacher: string | null;
  notes: string | null;
  /** Reminder override; null follows the series, "none" silences this one. */
  reminderMinutes: ReminderOverride;
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
  /**
   * Minutes before the class starts that its reminder fires, or null for no
   * reminder. A lead time rather than a moment, so moving the class carries
   * its reminder with it.
   */
  reminderMinutes: ReminderMinutes;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
