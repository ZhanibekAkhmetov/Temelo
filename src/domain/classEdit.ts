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
import { hasOccurrenceBetween, seriesRangeMovedTo, type SeriesRange } from "@/domain/recurrence";
import { reminderOverrideFor, type ReminderMinutes } from "@/domain/reminder";
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
  /** Lead time before the class its reminder fires at, or no reminder. */
  reminder: boolean;
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
  reminderMinutes: ReminderMinutes;
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
  /** Omitted means "as this occurrence is already reminded about". */
  reminderMinutes?: ReminderMinutes;
}

/**
 * Whether the edit touched the course record itself. The reminder is
 * deliberately not one of these: it belongs to the placement, so changing it
 * never has to clone a course the way a renamed one does.
 */
function courseFieldsChanged(changed: EditedFields): boolean {
  return changed.name || changed.room || changed.teacher || changed.notes;
}

export function draftHasChanges(draft: ClassEditDraft): boolean {
  return draft.changed.schedule || draft.changed.recurrence || draft.changed.reminder || courseFieldsChanged(draft.changed);
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
  // `??` would read a deliberate "None" as "not supplied", so the presence
  // of the key is what decides whether the caller had an opinion.
  const reminderMinutes =
    input.reminderMinutes !== undefined ? input.reminderMinutes : occurrence.placement.reminderMinutes;

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
    reminder: reminderMinutes !== occurrence.placement.reminderMinutes,
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
    reminderMinutes,
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
      reminderMinutes: draft.reminderMinutes,
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

function conflictMessage(conflict: Occurrence): string {
  return `This slot is already used by ${conflict.course.name}.`;
}

/**
 * The series' date range after it follows its edited occurrence, and the
 * range untouched when the edit did not move the occurrence at all.
 *
 * The guard matters: an occurrence that already carries a one-off move is
 * drawn on a date its series does not name, so an edit that only changes,
 * say, the room would otherwise read as a move of the whole series.
 *
 * The shift itself is `seriesRangeMovedTo` — the same rule the move preview
 * and the store's own move ask, so a drop the grid offered cannot be refused
 * once it is committed.
 */
function movedRangeOf(draft: ClassEditDraft, base: Placement): SeriesRange {
  return draft.changed.schedule
    ? seriesRangeMovedTo(base, draft.occurrenceDate, draft.effectiveDate)
    : { startsOn: base.startsOn, endsOn: base.endsOn };
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
 * Whether an exception still says anything its series does not.
 *
 * A cancellation always does: removing an occurrence is not something any
 * set of null overrides could express. A modification only does while it
 * still moves its occurrence or overrides at least one field — once a
 * series-wide edit has absorbed the last of them, what is left is an empty
 * delta that would go on holding an occurrence outside its own series for
 * no reason at all.
 */
function exceptionStillDiffers(exception: OccurrenceException): boolean {
  if (exception.state === "cancelled") return true;
  return (
    exception.effectiveDate !== exception.originalDate ||
    exception.timeSlotId !== null ||
    exception.slotSpan !== null ||
    exception.name !== null ||
    exception.room !== null ||
    exception.teacher !== null ||
    exception.notes !== null ||
    exception.reminderMinutes !== null
  );
}

/**
 * The date the edited occurrence has in the series once a series-wide edit
 * has landed.
 *
 * A move carries the whole range with it by whole days — `movedRangeOf` —
 * so the occurrence the user dragged ends up in the series exactly where
 * they dropped it. An edit that left the schedule alone leaves it on the
 * date it already had.
 */
function seriesDateAfterAll(draft: ClassEditDraft): string {
  return draft.changed.schedule ? draft.effectiveDate : draft.occurrenceDate;
}

/**
 * Where a rebased exception ends up: which series now holds it, on which of
 * that series' dates, and whether that series has taken the occurrence's own
 * schedule as its own.
 *
 * `scheduleTaken` is what separates the two edits that rebase. A series-wide
 * move takes the occurrence's position only when the user actually moved it,
 * so an untouched one-off move stays a one-off move. A split *always* takes
 * it: the new series is built at the edited occurrence's destination, in its
 * period, which is exactly what keeps an every-two-week class in step across
 * the split — so there is nothing left for the occurrence to override.
 */
interface RebaseTarget {
  placementId: string;
  seriesDate: string;
  scheduleTaken: boolean;
}

/**
 * The edited occurrence's own exception, rebased onto the edit it initiated.
 *
 * An edit made from an occurrence has to reach that occurrence, and its own
 * overrides are exactly what would stop it: one moved to Wednesday by an
 * earlier "only this" would sit out its series' move, and a series renamed
 * from a one-off-renamed occurrence would keep reading the old name. So
 * every field this edit changed gives up its override here.
 *
 * Only those fields, though. The rest are departures the user has not
 * revisited and was not asked about, and they survive — a room set on this
 * one lesson is still set on it after the series around it is renamed, split
 * or moved. Losing them is not a smaller edit than the user asked for, it is
 * a different one.
 *
 * `originalDate` moves to the date the occurrence has in the series that now
 * holds it. It is what ties the exception to an occurrence of a base rule,
 * and a series that has shifted — or a new half that starts elsewhere — no
 * longer has the date it used to name. Left behind, the exception would stop
 * suppressing the occurrence it replaces and the class would be drawn twice.
 */
function rebaseEditedException(
  exception: OccurrenceException,
  draft: ClassEditDraft,
  target: RebaseTarget,
  now: string,
): OccurrenceException {
  const { changed } = draft;
  const { seriesDate, scheduleTaken } = target;
  const rebased: OccurrenceException = {
    ...exception,
    placementId: target.placementId,
    originalDate: seriesDate,
    effectiveDate: scheduleTaken ? seriesDate : exception.effectiveDate,
    timeSlotId: scheduleTaken ? null : exception.timeSlotId,
    slotSpan: scheduleTaken ? null : exception.slotSpan,
    name: changed.name ? null : exception.name,
    room: changed.room ? null : exception.room,
    teacher: changed.teacher ? null : exception.teacher,
    notes: changed.notes ? null : exception.notes,
    reminderMinutes: changed.reminder ? null : exception.reminderMinutes,
    updatedAt: now,
  };

  // An exception with nothing left to say is not a silent occurrence; it is
  // an occurrence that has rejoined its series, and the series draws it.
  return exceptionStillDiffers(rebased) ? rebased : { ...rebased, deletedAt: now };
}

/**
 * The two dates an exception holds, carried across a whole-day shift of the
 * series it is anchored to.
 *
 * They are not the same kind of date and do not travel the same way.
 *
 * `originalDate` is not a date anyone chose. It is the anchor that says
 * which occurrence of the base rule this exception stands in for, and it is
 * what `resolveOccurrences` matches on to stop the series drawing that
 * occurrence a second time. It always shifts. Move a series to another
 * weekday and leave the anchors behind, and every one of them stops
 * suppressing anything: the one-off is drawn where it was put, and the
 * lesson the series now meets appears next to it.
 *
 * `effectiveDate` shifts only where it has nothing of its own to say. Equal
 * to `originalDate`, it means "wherever the series puts this one" — a
 * rename, a room, a silenced reminder, and no opinion at all about the day —
 * so it has to travel, or that lesson would be left behind alone on the old
 * weekday. Different from `originalDate`, it is precisely the day the user
 * dragged that lesson to, and it stays: a Monday class whose 14th was moved
 * to Tuesday the 15th still meets on Tuesday the 15th once the series shifts
 * to Wednesdays. Only which Wednesday it stands in for changes.
 */
function shiftedExceptionDates(
  exception: OccurrenceException,
  shift: number,
): Pick<OccurrenceException, "originalDate" | "effectiveDate"> {
  const originalDate = addDaysIso(exception.originalDate, shift);
  const followsTheSeries = exception.effectiveDate === exception.originalDate;
  return { originalDate, effectiveDate: followsTheSeries ? originalDate : exception.effectiveDate };
}

/**
 * Whole days every occurrence of the series moves by, and 0 when the grid of
 * dates it meets on does not move at all.
 *
 * This is the same shift `movedRangeOf` applies to the series' own range —
 * asked once, so that the exceptions hanging off the series cannot drift out
 * of step with the dates they are anchored to.
 *
 * An edit that also rewrites the recurrence rule is deliberately not a shift:
 * there the range is whatever the user typed into the editor rather than the
 * old one carried along, so there is no single delta the occurrences moved
 * by and nothing an exception could honestly follow.
 */
function seriesShiftDays(draft: ClassEditDraft): number {
  if (!draft.changed.schedule || draft.changed.recurrence) return 0;
  return diffInDaysIso(draft.occurrenceDate, draft.effectiveDate);
}

/**
 * Every exception of the series, carried across a series-wide edit.
 *
 * Two different things happen here, and they are different on purpose.
 *
 * The occurrence the edit was *made on* is rebased: it gives up the
 * overrides for the fields this edit changed, because those are the fields
 * the user has just expressed a new opinion about — `rebaseEditedException`.
 *
 * Every other exception only follows the shift, on the terms
 * `shiftedExceptionDates` sets out. Nothing else about them is touched: the
 * departures they record are still departures, and an edit made from another
 * week is not the user revisiting them.
 */
function exceptionsAfterAll(
  current: EditableTimetable,
  draft: ClassEditDraft,
  base: Placement,
  now: string,
): OccurrenceException[] {
  const shift = seriesShiftDays(draft);
  if (shift === 0 && !draft.exceptionId) return current.exceptions;

  return current.exceptions.map((exception) => {
    // Another series' one-offs are none of this edit's business.
    if (exception.deletedAt || exception.placementId !== base.id) return exception;
    if (exception.id === draft.exceptionId) {
      const target = { placementId: base.id, seriesDate: seriesDateAfterAll(draft), scheduleTaken: draft.changed.schedule };
      return rebaseEditedException(exception, draft, target, now);
    }
    if (shift === 0) return exception;
    return { ...exception, ...shiftedExceptionDates(exception, shift), updatedAt: now };
  });
}

/**
 * A single occurrence steps out of line with an exception — a delta against
 * the series, not a copy of it. Anything the draft agrees with the series
 * about is stored as null, so a later series-wide edit still reaches it.
 */
function applyOnlyThis(current: EditableTimetable, draft: ClassEditDraft, base: Placement, baseCourse: Course, now: string): EditResult {
  const blocked = onlyThisBlockedReason(draft);
  if (blocked) return { ok: false, error: blocked };

  const conflict = findOccurrenceConflict(current, {
    occurrenceId: occurrenceIdFor(base.id, draft.occurrenceDate),
    date: draft.effectiveDate,
    timeSlotId: draft.timeSlotId,
    slotSpan: draft.slotSpan,
  });
  if (conflict) return { ok: false, error: conflictMessage(conflict) };

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
    // Not `overrideOf`: "no reminder" is a value here, not the absence of one.
    reminderMinutes: reminderOverrideFor(draft.reminderMinutes, base.reminderMinutes),
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
      : movedRangeOf(draft, base).endsOn;

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
    // The draft carries the edited occurrence's *effective* reminder, which
    // may be a one-off override. Promoting that to the whole new series would
    // silence every future lesson because one of them was silenced, so an
    // untouched reminder stays the series' own; the override stays a one-off.
    reminderMinutes: draft.changed.reminder ? draft.reminderMinutes : base.reminderMinutes,
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
  const conflict = findPlacementConflict({ ...current, placements }, { ...nextPlacement, placementId: nextPlacement.id });
  if (conflict) return { ok: false, error: conflictMessage(conflict) };

  /*
   * One-off exceptions from the split point onwards belonged to the old
   * series, and follow it into the new one.
   *
   * They cannot follow it by date, because the new series starts wherever
   * the edited occurrence was dropped and may meet on another weekday
   * entirely: an anchor left on the old Monday names a date the new series
   * has no occurrence for, so it would suppress nothing and be drawn as a
   * lesson of its own. They follow it by the same whole-day shift the split
   * itself applied — the distance from the occurrence the user split at to
   * where they put it — which is what carries a fortnight's parity across
   * the move as well, both dates moving by one delta.
   *
   * An exception is still dropped where the shifted anchor is not a date the
   * new series meets at all: a shortened range, or a rule that no longer
   * repeats, really has stopped holding that occurrence, and an exception
   * anchored to nothing is a lesson conjured out of a deletion.
   *
   * The exception at the split point is the occurrence the user was looking
   * at, and it is rebased rather than dropped. What it said about the fields
   * this edit changed has become the new series and is gone; what it said
   * about anything else — a room set on this one lesson, a reminder silenced
   * for it alone — was never part of the question that was asked, and is
   * still true of the first lesson of the new series. It is dropped only
   * when the rebase leaves it saying nothing at all.
   */
  const splitShift = diffInDaysIso(splitDate, draft.effectiveDate);
  // The new series is built at this occurrence's own position and period, so
  // its schedule is already said there and needs no override.
  const splitTarget = { placementId: nextPlacement.id, seriesDate: draft.effectiveDate, scheduleTaken: true };

  const exceptions = current.exceptions.map((exception) => {
    if (exception.deletedAt || exception.placementId !== base.id) return exception;
    if (exception.originalDate < splitDate) return exception;
    if (exception.originalDate === splitDate) return rebaseEditedException(exception, draft, splitTarget, now);

    const dates = shiftedExceptionDates(exception, splitShift);
    return hasOccurrenceBetween(nextPlacement, dates.originalDate, dates.originalDate)
      ? { ...exception, ...dates, placementId: nextPlacement.id, updatedAt: now }
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
 * The series itself changes.
 *
 * Its one-off exceptions come along — see `exceptionsAfterAll`. The
 * departures they record are not undone by an edit made elsewhere, but they
 * are anchored to occurrences of the series, and a series whose dates have
 * moved no longer has the occurrences they name.
 */
function applyAll(current: EditableTimetable, draft: ClassEditDraft, base: Placement, baseCourse: Course, now: string): EditResult {
  const { changed } = draft;
  const moved = movedRangeOf(draft, base);
  const nextPlacement: Placement = {
    ...base,
    weekday: changed.schedule ? draft.weekday : base.weekday,
    timeSlotId: changed.schedule ? draft.timeSlotId : base.timeSlotId,
    slotSpan: changed.schedule ? draft.slotSpan : base.slotSpan,
    recurrenceType: changed.recurrence ? draft.recurrenceType : base.recurrenceType,
    startsOn: changed.recurrence ? draft.startsOn : moved.startsOn,
    endsOn: changed.recurrence ? draft.endsOn : moved.endsOn,
    reminderMinutes: changed.reminder ? draft.reminderMinutes : base.reminderMinutes,
    updatedAt: now,
  };

  if (!isIsoDateBeforeOrEqual(nextPlacement.startsOn, nextPlacement.endsOn)) {
    return { ok: false, error: "End date cannot be before the start date." };
  }

  // Against everything except itself: the stored copy of this very series
  // is still the unedited one, and it would otherwise clash with its own
  // replacement whenever the schedule did not move at all.
  const conflict = findPlacementConflict(current, { ...nextPlacement, placementId: base.id });
  if (conflict) return { ok: false, error: conflictMessage(conflict) };

  const exceptions = exceptionsAfterAll(current, draft, base, now);

  return {
    ok: true,
    next: {
      ...current,
      courses: current.courses.map((course) => (course.id === baseCourse.id ? courseWithEdits(course, draft, now) : course)),
      placements: current.placements.map((placement) => (placement.id === base.id ? nextPlacement : placement)),
      exceptions,
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
