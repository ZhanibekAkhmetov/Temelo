/**
 * Editing a class that repeats.
 *
 * Every edit — from the editor, from a drag, from a resize — is first turned
 * into a draft that changes nothing. The draft records which occurrence the
 * edit was made on, where it would land, and which fields the user actually
 * touched; only once a scope has been chosen is it turned into a change to
 * the stored series. That ordering is what makes "only this occurrence"
 * possible at all: by the time the question is asked, the answer can still
 * be any of the three.
 *
 * Which fields were *touched* is recorded rather than re-derived at apply
 * time, because an occurrence can already carry one-off overrides. A room
 * showing "B12" because a previous single-occurrence edit put it there must
 * not be pushed onto the whole series just because the user changed the
 * class name in the same sitting.
 */

import { diffInDaysIso } from "@/domain/calendar";
import { addDaysIso, isIsoDateBeforeOrEqual, isValidIsoDate } from "@/domain/date";
import { createId } from "@/domain/id";
import { occurrenceIdFor, type Occurrence, type OccurrencePreview } from "@/domain/occurrence";
import { findOccurrenceConflict, findPlacementConflict } from "@/domain/conflict";
import { hasOccurrenceBetween } from "@/domain/recurrence";
import type { Weekday } from "@/domain/week";
import type { Course, OccurrenceException, Placement, RecurrenceType, TimeSlot } from "@/types/models";

export type EditScope = "onlyThis" | "thisAndFuture" | "all";

/** Which gesture or screen the edit came from. */
export type EditSource = "editor" | "move" | "resize";

/** The user-facing wording, defined once so every surface agrees. */
export const EDIT_SCOPE_LABEL: Record<EditScope, string> = {
  onlyThis: "Only this occurrence",
  thisAndFuture: "This and future occurrences",
  all: "All occurrences",
};

export const EDIT_SCOPE_ORDER: EditScope[] = ["onlyThis", "thisAndFuture", "all"];

/** Which parts of the class the user actually changed. */
export interface EditedFields {
  /** Weekday, period, span or the date the occurrence lands on. */
  schedule: boolean;
  name: boolean;
  room: boolean;
  teacher: boolean;
  notes: boolean;
  /** Repetition rule or the series' own date range. */
  recurrence: boolean;
}

export interface ClassEditDraft {
  /** The series the edited occurrence belongs to. */
  placementId: string;
  /** The one-off record it already had, if it had one. */
  exceptionId: string | null;
  /** Date the edited occurrence has in the base series. */
  occurrenceDate: string;
  /** Date the edit would land on. */
  effectiveDate: string;
  weekday: Weekday;
  timeSlotId: string;
  slotSpan: number;
  name: string;
  room: string;
  teacher: string;
  notes: string;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
  changed: EditedFields;
  source: EditSource;
}

/** A draft together with the block the grid should draw while it is pending. */
export interface PendingClassEdit {
  draft: ClassEditDraft;
  preview: OccurrencePreview;
}

export interface ClassEditInput {
  occurrence: Occurrence;
  source: EditSource;
  /** Date in the displayed week the edit lands on. */
  effectiveDate: string;
  weekday: Weekday;
  timeSlotId: string;
  slotSpan: number;
  /** Course fields; omitted means "as this occurrence already reads". */
  name?: string;
  room?: string;
  teacher?: string;
  notes?: string;
  /** Series fields; omitted means "as the series already repeats". */
  recurrenceType?: RecurrenceType;
  startsOn?: string;
  endsOn?: string;
}

function courseFieldsChanged(changed: EditedFields): boolean {
  return changed.name || changed.room || changed.teacher || changed.notes;
}

export function draftHasChanges(draft: ClassEditDraft): boolean {
  return draft.changed.schedule || draft.changed.recurrence || courseFieldsChanged(draft.changed);
}

/**
 * Builds the draft and the block that stands in for the edited occurrence
 * while the scope question is open. Nothing here touches stored state.
 */
export function createPendingClassEdit(input: ClassEditInput): PendingClassEdit {
  const { occurrence } = input;
  const base = occurrence.basePlacement;

  const name = input.name ?? occurrence.course.name;
  const room = input.room ?? occurrence.course.room;
  const teacher = input.teacher ?? occurrence.course.teacher;
  const notes = input.notes ?? occurrence.course.notes;
  const recurrenceType = input.recurrenceType ?? base.recurrenceType;
  const startsOn = input.startsOn ?? base.startsOn;
  const endsOn = input.endsOn ?? base.endsOn;

  const changed: EditedFields = {
    schedule:
      input.weekday !== occurrence.weekday ||
      input.timeSlotId !== occurrence.placement.timeSlotId ||
      input.slotSpan !== occurrence.placement.slotSpan ||
      input.effectiveDate !== occurrence.date,
    name: name !== occurrence.course.name,
    room: room !== occurrence.course.room,
    teacher: teacher !== occurrence.course.teacher,
    notes: notes !== occurrence.course.notes,
    recurrence: recurrenceType !== base.recurrenceType || startsOn !== base.startsOn || endsOn !== base.endsOn,
  };

  const draft: ClassEditDraft = {
    placementId: base.id,
    exceptionId: occurrence.exception?.id ?? null,
    occurrenceDate: occurrence.occurrenceDate,
    effectiveDate: input.effectiveDate,
    weekday: input.weekday,
    timeSlotId: input.timeSlotId,
    slotSpan: Math.max(1, input.slotSpan),
    name,
    room,
    teacher,
    notes,
    recurrenceType,
    startsOn,
    endsOn,
    changed,
    source: input.source,
  };

  const preview: OccurrencePreview = {
    occurrenceId: occurrence.occurrenceId,
    occurrenceDate: draft.occurrenceDate,
    date: draft.effectiveDate,
    placement: {
      ...occurrence.placement,
      weekday: draft.weekday,
      timeSlotId: draft.timeSlotId,
      slotSpan: draft.slotSpan,
    },
    course: { ...occurrence.course, name: draft.name, room: draft.room, teacher: draft.teacher, notes: draft.notes },
  };

  return { draft, preview };
}

export type EditCheck = { ok: true } | { ok: false; error: string };

/** Field-level validity, checked before the scope question is ever asked. */
export function validateClassEditDraft(draft: ClassEditDraft): EditCheck {
  if (!draft.name.trim()) return { ok: false, error: "Class name is required." };
  if (!isValidIsoDate(draft.startsOn)) return { ok: false, error: "Start date must be a valid date (DD.MM.YYYY)." };
  if (!isValidIsoDate(draft.endsOn)) return { ok: false, error: "End date must be a valid date (DD.MM.YYYY)." };
  if (!isIsoDateBeforeOrEqual(draft.startsOn, draft.endsOn)) {
    return { ok: false, error: "End date cannot be before the start date." };
  }
  return { ok: true };
}

/**
 * Why "Only this occurrence" cannot be offered, or null when it can.
 *
 * A repetition rule or a series date range is not a property of one meeting,
 * so quietly writing it onto a single occurrence would silently mean
 * something other than what the user asked for.
 */
export function onlyThisBlockedReason(draft: ClassEditDraft): string | null {
  return draft.changed.recurrence ? "Recurrence changes apply to the whole series." : null;
}

export interface EditableTimetable {
  timeSlots: TimeSlot[];
  courses: Course[];
  placements: Placement[];
  exceptions: OccurrenceException[];
}

export type EditResult = { ok: true; next: EditableTimetable } | { ok: false; error: string };

function conflictMessage(courses: Course[], placement: Placement | undefined, courseName?: string): string {
  const name = courseName ?? courses.find((course) => course.id === placement?.courseId)?.name ?? "another class";
  return `This slot is already used by ${name}.`;
}

/**
 * How far the occurrence moved across the week, in days, and zero when the
 * edit did not move it at all.
 *
 * A series that follows its occurrence onto another weekday is shifted by
 * exactly this — start date included. Re-anchoring the whole range rather
 * than only the weekday is what keeps an every-two-week class on the weeks
 * it already met on: parity is counted from a series' own first occurrence,
 * so a start date that moves with the weekday cannot fall out of step.
 */
function dayShiftOf(draft: ClassEditDraft): number {
  return draft.changed.schedule ? diffInDaysIso(draft.occurrenceDate, draft.effectiveDate) : 0;
}

/** Only fields the user touched are pushed onto the series' own course. */
function courseWithEdits(course: Course, draft: ClassEditDraft, now: string): Course {
  return {
    ...course,
    name: draft.changed.name ? draft.name.trim() : course.name,
    room: draft.changed.room ? draft.room.trim() : course.room,
    teacher: draft.changed.teacher ? draft.teacher.trim() : course.teacher,
    notes: draft.changed.notes ? draft.notes.trim() : course.notes,
    updatedAt: now,
  };
}

/**
 * A single occurrence steps out of line with an exception — a delta against
 * the series, not a copy of it. Anything the draft agrees with the series
 * about is stored as null, so a later series-wide edit still reaches it.
 */
function applyOnlyThis(current: EditableTimetable, draft: ClassEditDraft, base: Placement, baseCourse: Course, now: string): EditResult {
  const blocked = onlyThisBlockedReason(draft);
  if (blocked) return { ok: false, error: blocked };

  const conflict = findOccurrenceConflict(current, current.timeSlots, {
    occurrenceId: occurrenceIdFor(base.id, draft.occurrenceDate),
    date: draft.effectiveDate,
    timeSlotId: draft.timeSlotId,
    slotSpan: draft.slotSpan,
  });
  if (conflict) return { ok: false, error: conflictMessage(current.courses, undefined, conflict.course.name) };

  const overrideOf = <T,>(value: T, seriesValue: T): T | null => (value === seriesValue ? null : value);
  const overrides = {
    effectiveDate: draft.effectiveDate,
    state: "modified" as const,
    timeSlotId: overrideOf(draft.timeSlotId, base.timeSlotId),
    slotSpan: overrideOf(draft.slotSpan, base.slotSpan),
    name: overrideOf(draft.name.trim(), baseCourse.name),
    room: overrideOf(draft.room.trim(), baseCourse.room),
    teacher: overrideOf(draft.teacher.trim(), baseCourse.teacher),
    notes: overrideOf(draft.notes.trim(), baseCourse.notes),
    updatedAt: now,
  };

  const existing = draft.exceptionId
    ? current.exceptions.find((exception) => exception.id === draft.exceptionId && !exception.deletedAt)
    : undefined;

  const exceptions = existing
    ? current.exceptions.map((exception) => (exception.id === existing.id ? { ...exception, ...overrides } : exception))
    : [
        ...current.exceptions,
        {
          id: createId(),
          placementId: base.id,
          originalDate: draft.occurrenceDate,
          ...overrides,
          createdAt: now,
          deletedAt: null,
        },
      ];

  return { ok: true, next: { ...current, exceptions } };
}

/**
 * The series is cut in two at the edited occurrence: the part before it
 * keeps its placement and its course untouched, and everything from the
 * edited occurrence onwards becomes a new series that starts exactly there.
 *
 * Starting the new placement *on the edited destination* is also what keeps
 * an every-two-week class in step: parity is measured from a placement's own
 * first occurrence, so a series whose first occurrence is the edited one
 * repeats on precisely the weeks the old one would have.
 */
function applyThisAndFuture(current: EditableTimetable, draft: ClassEditDraft, base: Placement, baseCourse: Course, now: string): EditResult {
  const splitDate = draft.occurrenceDate;
  const previousEnd = addDaysIso(splitDate, -1);
  const isOneOff = draft.recurrenceType === "once";
  const endsOn = isOneOff
    ? draft.effectiveDate
    : draft.changed.recurrence
      ? draft.endsOn
      : addDaysIso(base.endsOn, dayShiftOf(draft));

  if (!isIsoDateBeforeOrEqual(draft.effectiveDate, endsOn)) {
    return { ok: false, error: "End date cannot be before this occurrence." };
  }

  const truncated: Placement = { ...base, endsOn: previousEnd, updatedAt: now };
  const pastSurvives = hasOccurrenceBetween(truncated, truncated.startsOn, previousEnd);

  // Past occurrences must keep reading the way they always did, so a changed
  // course is cloned rather than edited under them.
  const courseChanged = courseFieldsChanged(draft.changed);
  const clonedCourse: Course | null = courseChanged
    ? { ...courseWithEdits(baseCourse, draft, now), id: createId(), createdAt: now }
    : null;

  const nextPlacement: Placement = {
    id: createId(),
    courseId: clonedCourse ? clonedCourse.id : base.courseId,
    weekday: draft.weekday,
    timeSlotId: draft.timeSlotId,
    slotSpan: draft.slotSpan,
    recurrenceType: draft.recurrenceType,
    startsOn: draft.effectiveDate,
    endsOn,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  const placements = current.placements.map((placement) => {
    if (placement.id !== base.id) return placement;
    return pastSurvives ? truncated : { ...placement, deletedAt: now, updatedAt: now };
  });

  // The old series is already truncated in `placements`, so the two halves
  // are checked against each other as the two separate series they now are.
  const conflict = findPlacementConflict(current.timeSlots, placements, { ...nextPlacement, placementId: nextPlacement.id });
  if (conflict) return { ok: false, error: conflictMessage(current.courses, conflict) };

  /*
   * One-off exceptions from the split point onwards belonged to the old
   * series. They follow it to the new one where the new series still meets
   * on the same date, and are dropped where it does not — the occurrence
   * they described no longer exists. The exception at the split point itself
   * is always dropped: its edit has just become the new series.
   */
  const exceptions = current.exceptions.map((exception) => {
    if (exception.deletedAt || exception.placementId !== base.id) return exception;
    if (exception.originalDate < splitDate) return exception;
    if (exception.originalDate === splitDate) return { ...exception, deletedAt: now, updatedAt: now };
    return hasOccurrenceBetween(nextPlacement, exception.originalDate, exception.originalDate)
      ? { ...exception, placementId: nextPlacement.id, updatedAt: now }
      : { ...exception, deletedAt: now, updatedAt: now };
  });

  return {
    ok: true,
    next: {
      ...current,
      courses: clonedCourse ? [...current.courses, clonedCourse] : current.courses,
      placements: [...placements, nextPlacement],
      exceptions,
    },
  };
}

/**
 * The series itself changes. One-off exceptions are left exactly as they
 * are: they record deliberate departures from the series, and a series-wide
 * edit is not a reason to undo them.
 */
function applyAll(current: EditableTimetable, draft: ClassEditDraft, base: Placement, baseCourse: Course, now: string): EditResult {
  const { changed } = draft;
  const shift = dayShiftOf(draft);
  const nextPlacement: Placement = {
    ...base,
    weekday: changed.schedule ? draft.weekday : base.weekday,
    timeSlotId: changed.schedule ? draft.timeSlotId : base.timeSlotId,
    slotSpan: changed.schedule ? draft.slotSpan : base.slotSpan,
    recurrenceType: changed.recurrence ? draft.recurrenceType : base.recurrenceType,
    startsOn: changed.recurrence ? draft.startsOn : addDaysIso(base.startsOn, shift),
    endsOn: changed.recurrence ? draft.endsOn : addDaysIso(base.endsOn, shift),
    updatedAt: now,
  };

  if (!isIsoDateBeforeOrEqual(nextPlacement.startsOn, nextPlacement.endsOn)) {
    return { ok: false, error: "End date cannot be before the start date." };
  }

  // Against everything except itself: the stored copy of this very series
  // is still the unedited one, and it would otherwise clash with its own
  // replacement whenever the schedule did not move at all.
  const conflict = findPlacementConflict(current.timeSlots, current.placements, { ...nextPlacement, placementId: base.id });
  if (conflict) return { ok: false, error: conflictMessage(current.courses, conflict) };

  return {
    ok: true,
    next: {
      ...current,
      courses: current.courses.map((course) => (course.id === baseCourse.id ? courseWithEdits(course, draft, now) : course)),
      placements: current.placements.map((placement) => (placement.id === base.id ? nextPlacement : placement)),
    },
  };
}

/**
 * Applies a drafted edit at the chosen scope, returning the whole edited
 * timetable rather than mutating anything — the caller decides when, and
 * whether, that becomes app state.
 */
export function applyClassEditScope(
  current: EditableTimetable,
  draft: ClassEditDraft,
  scope: EditScope,
  now: string,
): EditResult {
  const base = current.placements.find((placement) => placement.id === draft.placementId && !placement.deletedAt);
  if (!base) return { ok: false, error: "This class no longer exists." };

  const baseCourse = current.courses.find((course) => course.id === base.courseId && !course.deletedAt);
  if (!baseCourse) return { ok: false, error: "This class no longer exists." };

  const invalid = validateClassEditDraft(draft);
  if (!invalid.ok) return invalid;

  // A class that meets once has no series to scope against; whichever
  // option got here means the same thing.
  const effectiveScope = base.recurrenceType === "once" ? "all" : scope;

  if (effectiveScope === "onlyThis") return applyOnlyThis(current, draft, base, baseCourse, now);
  if (effectiveScope === "thisAndFuture") return applyThisAndFuture(current, draft, base, baseCourse, now);
  return applyAll(current, draft, base, baseCourse, now);
}
