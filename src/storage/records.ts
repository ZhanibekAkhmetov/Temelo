/**
 * Row shapes and the mapping between them and the domain models.
 *
 * Kept apart from the repository so the SQL and the column-by-column
 * translation can be read separately, and so nothing above `src/storage`
 * ever sees a snake_cased row.
 */

import { normalizeClassColorId } from "@/domain/classColor";
import type { ReminderMinutes, ReminderOverride } from "@/domain/reminder";
import type { Weekday, WeekendMode } from "@/domain/week";
import { normalizeLanguagePreference } from "@/i18n/language";
import { normalizeAppearancePreference } from "@/theme/appearance";
import type {
  Course,
  GridOrientation,
  OccurrenceException,
  OccurrenceExceptionState,
  Placement,
  RecurrenceType,
  Settings,
  TimeSlot,
  Timetable,
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
  /** Nullable: NULL is the real value "None", not a missing setting. */
  default_reminder_minutes: number | null;
  /** Nullable only for the instant between the v4 ALTER and its backfill. */
  appearance_preference: string | null;
  language_preference: string | null;
  onboarding_completed: number;
}

/**
 * The single row that says which timetable is active.
 *
 * `singleton` is a constant, `CHECK`ed by the schema, so "at most one active
 * timetable" is a property of the table rather than a rule the code has to
 * keep. No row at all is the legitimate state of a user who archived their
 * only timetable and has not made another.
 */
export const ACTIVE_TIMETABLE_ROW_ID = "active";

export interface ActiveTimetableRow {
  singleton: string;
  id: string;
  name: string;
  anchor_date: string;
  created_at: string;
  updated_at: string;
}

/**
 * One archived timetable: its identity and list metadata as columns, the
 * timetable itself as a versioned JSON snapshot.
 *
 * The columns are the ones the Timetables list has to render without parsing
 * anything, and the ones a malformed snapshot must not be able to hide: a
 * broken archive still shows its name and the day it was archived, and can
 * still be renamed or deleted. Everything else is inside `snapshot`.
 */
export interface ArchivedTimetableRow {
  id: string;
  name: string;
  archived_at: string;
  created_at: string;
  format_version: number;
  snapshot: string;
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
  /** 1 when the series reaches back to the timetable's start; since v7. */
  starts_with_timetable: number;
  /** Minutes of lead time; NULL is "no reminder". */
  reminder_minutes: number | null;
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
  /** Colour override; NULL means "follow the course". */
  appearance_id: string | null;
  /** Three-state; see `reminderOverrideToColumn`. TEXT, never INTEGER. */
  reminder_minutes: string | null;
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

/** The stored spelling of a deliberately silenced occurrence. */
const REMINDER_NONE = "none";

/*
 * An occurrence's reminder override is the one field on the table with three
 * states rather than two, and the only one where SQL NULL cannot carry the
 * whole meaning:
 *
 *   null     follow the series          ->  SQL NULL
 *   "none"   silenced, deliberately     ->  the text 'none'
 *   number   an explicit lead time      ->  that number as text, e.g. '45'
 *
 * Every other override on this table can say "untouched" with NULL because
 * its own values are never null. A reminder's value *can* be null — that is
 * what "None" means — so storing it in an INTEGER column would make "the
 * user turned this occurrence's reminder off" and "the user never touched
 * this occurrence's reminder" the same row, and a reminder the user
 * deliberately silenced would come back switched on. Hence TEXT, and hence
 * a sentinel that a number can never collide with.
 */
export function reminderOverrideToColumn(value: ReminderOverride): string | null {
  if (value === null) return null;
  return value === REMINDER_NONE ? REMINDER_NONE : String(value);
}

export function reminderOverrideFromColumn(value: string | null): ReminderOverride {
  if (value === null) return null;

  // SQLite hands back whatever is in the cell; a TEXT-affinity column has
  // always converted a bound number to text, but reading defensively costs
  // one comparison and keeps a hand-edited row from throwing.
  const text = String(value).trim();
  if (text === "") return null;
  if (text === REMINDER_NONE) return REMINDER_NONE;

  const minutes = Number(text);
  // An unreadable value falls back to "follow the series" — the same
  // untouched default a v1 row upgrades with, and never a silent silencing.
  return Number.isFinite(minutes) ? minutes : null;
}

/**
 * A series-level lead time is plain `number | null`, so the INTEGER column
 * carries it directly. Only the guard against a non-numeric cell is worth
 * writing down.
 */
function reminderMinutesFromColumn(value: number | null): ReminderMinutes {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function settingsToRow(settings: Settings): SettingsRow {
  return {
    id: SETTINGS_ROW_ID,
    weekend_mode: settings.weekendMode,
    grid_orientation: settings.gridOrientation,
    academic_day_start: settings.academicDayStart,
    default_lesson_duration_minutes: settings.defaultLessonDurationMinutes,
    default_break_duration_minutes: settings.defaultBreakDurationMinutes,
    slot_count: settings.slotCount,
    default_reminder_minutes: settings.defaultReminderMinutes,
    appearance_preference: settings.appearancePreference,
    language_preference: settings.languagePreference,
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
    defaultReminderMinutes: reminderMinutesFromColumn(row.default_reminder_minutes),
    // Both normalise a NULL or unrecognised cell to "system", which is what a
    // fresh install starts at — so a row written before v4, or by a newer
    // build offering a scheme this one has never heard of, opens safely.
    appearancePreference: normalizeAppearancePreference(row.appearance_preference),
    languagePreference: normalizeLanguagePreference(row.language_preference),
    onboardingCompleted: row.onboarding_completed !== 0,
  };
}

export function activeTimetableToRow(timetable: Timetable): ActiveTimetableRow {
  return {
    singleton: ACTIVE_TIMETABLE_ROW_ID,
    id: timetable.id,
    name: timetable.name,
    anchor_date: timetable.anchorDate,
    created_at: timetable.createdAt,
    updated_at: timetable.updatedAt,
  };
}

export function activeTimetableFromRow(row: ActiveTimetableRow): Timetable {
  return {
    id: row.id,
    name: row.name,
    anchorDate: row.anchor_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    // v4 rewrote the two retired palette ids in place, so this only has to
    // catch what a rewrite cannot reach: a row from a newer build, or one
    // edited by hand during development.
    appearanceId: normalizeClassColorId(row.appearance_id),
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
    starts_with_timetable: placement.startsWithTimetable ? 1 : 0,
    reminder_minutes: placement.reminderMinutes,
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
    // Only an explicit 0 bounds a series by its own start; the column's own
    // default is 1, so anything else is the ordinary case.
    startsWithTimetable: row.starts_with_timetable !== 0,
    reminderMinutes: reminderMinutesFromColumn(row.reminder_minutes),
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
    appearance_id: exception.appearanceId,
    reminder_minutes: reminderOverrideToColumn(exception.reminderMinutes),
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
    // NULL stays NULL — "follow the course" — and only a real override is
    // narrowed, so an unknown id becomes a drawable colour rather than
    // silently turning into "no override at all".
    appearanceId: row.appearance_id === null ? null : normalizeClassColorId(row.appearance_id),
    reminderMinutes: reminderOverrideFromColumn(row.reminder_minutes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
