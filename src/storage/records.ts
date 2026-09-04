/**
 * Row shapes and the mapping between them and the domain models.
 *
 * Kept apart from the repository so the SQL and the column-by-column
 * translation can be read separately, and so nothing above `src/storage`
 * ever sees a snake_cased row.
 */

import type { Weekday, WeekendMode } from "@/domain/week";
import type {
  AcademicTerm,
  Course,
  GridOrientation,
  OccurrenceException,
  OccurrenceExceptionState,
  Placement,
  RecurrenceType,
  Settings,
  TimeSlot,
} from "@/types/models";

export const SETTINGS_ROW_ID = "app";

export interface SettingsRow {
  id: string;
  weekend_mode: string;
  grid_orientation: string;
  academic_day_start: string;
  default_lesson_duration_minutes: number;
  default_break_duration_minutes: number;
  slot_count: number;
  onboarding_completed: number;
}

export interface TermRow {
  id: string;
  name: string;
  start_date: string;
  estimated_end_date: string;
}

export interface TimeSlotRow {
  id: string;
  position: number;
  start_time: string;
  end_time: string;
}

export interface CourseRow {
  id: string;
  name: string;
  room: string;
  teacher: string;
  notes: string;
  appearance_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PlacementRow {
  id: string;
  course_id: string;
  weekday: string;
  time_slot_id: string;
  slot_span: number;
  recurrence_type: string;
  starts_on: string;
  ends_on: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface OccurrenceExceptionRow {
  id: string;
  placement_id: string;
  original_date: string;
  effective_date: string;
  state: string;
  time_slot_id: string | null;
  slot_span: number | null;
  name: string | null;
  room: string | null;
  teacher: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/*
 * The enum-ish columns are plain TEXT, so reading them back is the one place
 * a value could arrive that the domain has no case for — a row written by a
 * newer build, or one hand-edited during development. Each is narrowed
 * against the domain's own list and falls back to the safe default rather
 * than being asserted into the type, so a single odd value cannot put the
 * whole timetable into a state the UI has no branch for.
 */
function narrow<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const WEEKDAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const WEEKEND_MODES: WeekendMode[] = ["saturdaySunday", "sundayOnly", "none"];
const GRID_ORIENTATIONS: GridOrientation[] = ["vertical", "horizontal"];
const RECURRENCE_TYPES: RecurrenceType[] = ["weekly", "biweekly", "once"];
const EXCEPTION_STATES: OccurrenceExceptionState[] = ["modified", "cancelled"];

export function settingsToRow(settings: Settings): SettingsRow {
  return {
    id: SETTINGS_ROW_ID,
    weekend_mode: settings.weekendMode,
    grid_orientation: settings.gridOrientation,
    academic_day_start: settings.academicDayStart,
    default_lesson_duration_minutes: settings.defaultLessonDurationMinutes,
    default_break_duration_minutes: settings.defaultBreakDurationMinutes,
    slot_count: settings.slotCount,
    onboarding_completed: settings.onboardingCompleted ? 1 : 0,
  };
}

export function settingsFromRow(row: SettingsRow): Settings {
  return {
    weekendMode: narrow(row.weekend_mode, WEEKEND_MODES, "saturdaySunday"),
    gridOrientation: narrow(row.grid_orientation, GRID_ORIENTATIONS, "vertical"),
    academicDayStart: row.academic_day_start,
    defaultLessonDurationMinutes: row.default_lesson_duration_minutes,
    defaultBreakDurationMinutes: row.default_break_duration_minutes,
    slotCount: row.slot_count,
    onboardingCompleted: row.onboarding_completed !== 0,
  };
}

export function termToRow(term: AcademicTerm): TermRow {
  return {
    id: term.id,
    name: term.name,
    start_date: term.startDate,
    estimated_end_date: term.estimatedEndDate,
  };
}

export function termFromRow(row: TermRow): AcademicTerm {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    estimatedEndDate: row.estimated_end_date,
  };
}

export function timeSlotToRow(slot: TimeSlot): TimeSlotRow {
  return { id: slot.id, position: slot.position, start_time: slot.startTime, end_time: slot.endTime };
}

export function timeSlotFromRow(row: TimeSlotRow): TimeSlot {
  return { id: row.id, position: row.position, startTime: row.start_time, endTime: row.end_time };
}

export function courseToRow(course: Course): CourseRow {
  return {
    id: course.id,
    name: course.name,
    room: course.room,
    teacher: course.teacher,
    notes: course.notes,
    appearance_id: course.appearanceId,
    created_at: course.createdAt,
    updated_at: course.updatedAt,
    deleted_at: course.deletedAt,
  };
}

export function courseFromRow(row: CourseRow): Course {
  return {
    id: row.id,
    name: row.name,
    room: row.room,
    teacher: row.teacher,
    notes: row.notes,
    appearanceId: row.appearance_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function placementToRow(placement: Placement): PlacementRow {
  return {
    id: placement.id,
    course_id: placement.courseId,
    weekday: placement.weekday,
    time_slot_id: placement.timeSlotId,
    slot_span: placement.slotSpan,
    recurrence_type: placement.recurrenceType,
    starts_on: placement.startsOn,
    ends_on: placement.endsOn,
    created_at: placement.createdAt,
    updated_at: placement.updatedAt,
    deleted_at: placement.deletedAt,
  };
}

export function placementFromRow(row: PlacementRow): Placement {
  return {
    id: row.id,
    courseId: row.course_id,
    weekday: narrow(row.weekday, WEEKDAYS, "monday"),
    timeSlotId: row.time_slot_id,
    slotSpan: row.slot_span,
    recurrenceType: narrow(row.recurrence_type, RECURRENCE_TYPES, "weekly"),
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function exceptionToRow(exception: OccurrenceException): OccurrenceExceptionRow {
  return {
    id: exception.id,
    placement_id: exception.placementId,
    original_date: exception.originalDate,
    effective_date: exception.effectiveDate,
    state: exception.state,
    time_slot_id: exception.timeSlotId,
    slot_span: exception.slotSpan,
    name: exception.name,
    room: exception.room,
    teacher: exception.teacher,
    notes: exception.notes,
    created_at: exception.createdAt,
    updated_at: exception.updatedAt,
    deleted_at: exception.deletedAt,
  };
}

export function exceptionFromRow(row: OccurrenceExceptionRow): OccurrenceException {
  return {
    id: row.id,
    placementId: row.placement_id,
    originalDate: row.original_date,
    effectiveDate: row.effective_date,
    state: narrow(row.state, EXCEPTION_STATES, "modified"),
    timeSlotId: row.time_slot_id,
    slotSpan: row.slot_span,
    name: row.name,
    room: row.room,
    teacher: row.teacher,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
