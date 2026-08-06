import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { applyClassEditScope, type ClassEditDraft, type EditScope } from "@/domain/classEdit";
import { findPlacementConflict, type PlacementCandidate } from "@/domain/conflict";
import { isIsoDateBeforeOrEqual, isValidIsoDate } from "@/domain/date";
import { createId } from "@/domain/id";
import { generateTimeSlots } from "@/domain/time";
import type { Weekday, WeekendMode } from "@/domain/week";
import { APPEARANCE_PALETTE } from "@/theme/tokens";
import { createDefaultTerm, createDefaultTimeSlots, DEFAULT_SETTINGS } from "@/state/defaults";
import { createSeedState } from "@/state/seed";
import type {
  AcademicTerm,
  Course,
  GridOrientation,
  OccurrenceException,
  Placement,
  RecurrenceType,
  Settings,
  TimeSlot,
} from "@/types/models";

export interface AppState {
  settings: Settings;
  term: AcademicTerm;
  timeSlots: TimeSlot[];
  courses: Course[];
  placements: Placement[];
  /** Single occurrences that step out of line with their series. */
  exceptions: OccurrenceException[];
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface AcademicDayConfigInput {
  academicDayStart: string;
  defaultLessonDurationMinutes: number;
  defaultBreakDurationMinutes: number;
  slotCount: number;
}

export interface TermConfigInput {
  name: string;
  startDate: string;
  estimatedEndDate: string;
}

export interface TermInfoInput {
  name: string;
  estimatedEndDate: string;
}

export interface UpsertPlacementInput {
  placementId?: string;
  weekday: Weekday;
  timeSlotId: string;
  /** Consecutive periods occupied; defaults to a single period. */
  slotSpan?: number;
  name: string;
  room: string;
  teacher: string;
  notes: string;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
}

/** A drag or resize in the grid: position only, nothing else changes. */
export interface MovePlacementInput {
  placementId: string;
  weekday: Weekday;
  timeSlotId: string;
  slotSpan: number;
  /**
   * Destination date in the week the drag happened in. A repeating class
   * ignores it — its dates come from its rule — but a one-off *is* its date,
   * so dropping it on another day has to move the date with it.
   */
  date: string;
}

interface AppStateContextValue {
  state: AppState;
  setWeekendMode: (input: { weekendMode: WeekendMode }) => void;
  setGridOrientation: (input: { gridOrientation: GridOrientation }) => void;
  setAcademicDayConfig: (input: AcademicDayConfigInput) => ActionResult;
  setTermConfig: (input: TermConfigInput) => ActionResult;
  updateTermInfo: (input: TermInfoInput) => ActionResult;
  upsertPlacement: (input: UpsertPlacementInput) => ActionResult;
  movePlacement: (input: MovePlacementInput) => ActionResult;
  /** Read-only: whether a proposed position is free. Changes nothing. */
  checkPlacement: (input: MovePlacementInput) => ActionResult;
  /**
   * The only way a drafted edit to a recurring class reaches the store —
   * and only ever with a scope the user has chosen.
   */
  applyClassEdit: (draft: ClassEditDraft, scope: EditScope) => ActionResult;
  deletePlacement: (placementId: string) => void;
  loadSampleTimetable: () => void;
  resetPrototype: () => void;
}

function buildEmptyState(): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    term: createDefaultTerm(),
    timeSlots: createDefaultTimeSlots(),
    courses: [],
    placements: [],
    exceptions: [],
  };
}

/**
 * The prototype opens on the sample timetable so gestures can be tried
 * immediately; "Reset prototype" still clears everything back to
 * onboarding, and Settings can reload the sample at any time.
 */
function buildInitialState(): AppState {
  return createSeedState();
}

function findConflict(state: AppState, candidate: PlacementCandidate): Placement | undefined {
  return findPlacementConflict(state.timeSlots, state.placements, candidate);
}

function conflictError(state: AppState, conflict: Placement): ActionResult {
  const course = state.courses.find((candidate) => candidate.id === conflict.courseId);
  return { ok: false, error: `This slot is already used by ${course?.name ?? "another class"}.` };
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(buildInitialState);

  const value = useMemo<AppStateContextValue>(() => {
    const setWeekendMode: AppStateContextValue["setWeekendMode"] = (input) => {
      setState((prev) => ({
        ...prev,
        settings: { ...prev.settings, weekendMode: input.weekendMode },
      }));
    };

    const setGridOrientation: AppStateContextValue["setGridOrientation"] = (input) => {
      setState((prev) => ({
        ...prev,
        settings: { ...prev.settings, gridOrientation: input.gridOrientation },
      }));
    };

    const setAcademicDayConfig: AppStateContextValue["setAcademicDayConfig"] = (input) => {
      const result = generateTimeSlots({
        dayStart: input.academicDayStart,
        lessonDurationMinutes: input.defaultLessonDurationMinutes,
        breakDurationMinutes: input.defaultBreakDurationMinutes,
        slotCount: input.slotCount,
      });
      if (!result.ok) return { ok: false, error: result.error };

      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          academicDayStart: input.academicDayStart,
          defaultLessonDurationMinutes: input.defaultLessonDurationMinutes,
          defaultBreakDurationMinutes: input.defaultBreakDurationMinutes,
          slotCount: input.slotCount,
        },
        timeSlots: result.slots.map((slot) => ({
          id: createId(),
          position: slot.position,
          startTime: slot.startTime,
          endTime: slot.endTime,
        })),
        placements: prev.placements.map((placement) =>
          placement.deletedAt ? placement : { ...placement, deletedAt: now, updatedAt: now },
        ),
        // Exceptions point at periods too, so they cannot outlive the
        // periods the old academic day was made of.
        exceptions: prev.exceptions.map((exception) =>
          exception.deletedAt ? exception : { ...exception, deletedAt: now, updatedAt: now },
        ),
      }));
      return { ok: true };
    };

    const setTermConfig: AppStateContextValue["setTermConfig"] = (input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Term name is required." };
      if (!isValidIsoDate(input.startDate)) {
        return { ok: false, error: "Start date must be a valid date (DD.MM.YYYY)." };
      }
      if (!isValidIsoDate(input.estimatedEndDate)) {
        return { ok: false, error: "Estimated end date must be a valid date (DD.MM.YYYY)." };
      }
      if (!isIsoDateBeforeOrEqual(input.startDate, input.estimatedEndDate)) {
        return { ok: false, error: "Estimated end date cannot be before the start date." };
      }

      setState((prev) => ({
        ...prev,
        term: { ...prev.term, name, startDate: input.startDate, estimatedEndDate: input.estimatedEndDate },
        settings: { ...prev.settings, onboardingCompleted: true },
      }));
      return { ok: true };
    };

    const updateTermInfo: AppStateContextValue["updateTermInfo"] = (input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Term name is required." };
      if (!isValidIsoDate(input.estimatedEndDate)) {
        return { ok: false, error: "Estimated end date must be a valid date (DD.MM.YYYY)." };
      }
      if (!isIsoDateBeforeOrEqual(state.term.startDate, input.estimatedEndDate)) {
        return { ok: false, error: "Estimated end date cannot be before the term start date." };
      }

      setState((prev) => ({
        ...prev,
        term: { ...prev.term, name, estimatedEndDate: input.estimatedEndDate },
      }));
      return { ok: true };
    };

    const upsertPlacement: AppStateContextValue["upsertPlacement"] = (input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Class name is required." };
      if (!isValidIsoDate(input.startsOn)) {
        return { ok: false, error: "Start date must be a valid date (DD.MM.YYYY)." };
      }
      if (!isValidIsoDate(input.endsOn)) {
        return { ok: false, error: "End date must be a valid date (DD.MM.YYYY)." };
      }
      if (!isIsoDateBeforeOrEqual(input.startsOn, input.endsOn)) {
        return { ok: false, error: "End date cannot be before the start date." };
      }

      const slotSpan = Math.max(1, input.slotSpan ?? 1);
      const conflict = findConflict(state, {
        placementId: input.placementId,
        weekday: input.weekday,
        timeSlotId: input.timeSlotId,
        slotSpan,
        recurrenceType: input.recurrenceType,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      });
      if (conflict) return conflictError(state, conflict);

      const now = new Date().toISOString();

      if (input.placementId) {
        const existing = state.placements.find((placement) => placement.id === input.placementId);
        if (!existing) return { ok: false, error: "This class no longer exists." };

        setState((prev) => ({
          ...prev,
          courses: prev.courses.map((course) =>
            course.id === existing.courseId
              ? {
                  ...course,
                  name,
                  room: input.room.trim(),
                  teacher: input.teacher.trim(),
                  notes: input.notes.trim(),
                  updatedAt: now,
                }
              : course,
          ),
          placements: prev.placements.map((placement) =>
            placement.id === input.placementId
              ? {
                  ...placement,
                  timeSlotId: input.timeSlotId,
                  slotSpan,
                  recurrenceType: input.recurrenceType,
                  startsOn: input.startsOn,
                  endsOn: input.endsOn,
                  updatedAt: now,
                }
              : placement,
          ),
        }));
        return { ok: true };
      }

      const courseId = createId();
      const newCourse: Course = {
        id: courseId,
        name,
        room: input.room.trim(),
        teacher: input.teacher.trim(),
        notes: input.notes.trim(),
        appearanceId: APPEARANCE_PALETTE[state.courses.length % APPEARANCE_PALETTE.length],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const newPlacement: Placement = {
        id: createId(),
        courseId,
        weekday: input.weekday,
        timeSlotId: input.timeSlotId,
        slotSpan,
        recurrenceType: input.recurrenceType,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      setState((prev) => ({
        ...prev,
        courses: [...prev.courses, newCourse],
        placements: [...prev.placements, newPlacement],
      }));
      return { ok: true };
    };

    /**
     * The same validation `movePlacement` applies, without applying it —
     * so a drag in progress can show whether where it is hovering would be
     * accepted, using one rule rather than two.
     */
    const checkPlacement: AppStateContextValue["checkPlacement"] = (input) => {
      const existing = state.placements.find((placement) => placement.id === input.placementId);
      if (!existing || existing.deletedAt) return { ok: false, error: "This class no longer exists." };

      const oneOff = existing.recurrenceType === "once";
      const conflict = findConflict(state, {
        placementId: input.placementId,
        weekday: input.weekday,
        timeSlotId: input.timeSlotId,
        slotSpan: Math.max(1, input.slotSpan),
        recurrenceType: existing.recurrenceType,
        startsOn: oneOff ? input.date : existing.startsOn,
        endsOn: oneOff ? input.date : existing.endsOn,
      });
      return conflict ? conflictError(state, conflict) : { ok: true };
    };

    /**
     * The settled result of a grid drag or resize. Only the position moves,
     * so the course, recurrence and dates are deliberately left untouched.
     */
    const movePlacement: AppStateContextValue["movePlacement"] = (input) => {
      const existing = state.placements.find((placement) => placement.id === input.placementId);
      if (!existing || existing.deletedAt) return { ok: false, error: "This class no longer exists." };

      const slotSpan = Math.max(1, input.slotSpan);
      const oneOff = existing.recurrenceType === "once";
      const dates = oneOff ? { startsOn: input.date, endsOn: input.date } : { startsOn: existing.startsOn, endsOn: existing.endsOn };
      const unchanged =
        existing.weekday === input.weekday &&
        existing.timeSlotId === input.timeSlotId &&
        existing.slotSpan === slotSpan &&
        existing.startsOn === dates.startsOn;
      if (unchanged) return { ok: true };

      const conflict = findConflict(state, {
        placementId: input.placementId,
        weekday: input.weekday,
        timeSlotId: input.timeSlotId,
        slotSpan,
        recurrenceType: existing.recurrenceType,
        ...dates,
      });
      if (conflict) return conflictError(state, conflict);

      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        placements: prev.placements.map((placement) =>
          placement.id === input.placementId
            ? { ...placement, weekday: input.weekday, timeSlotId: input.timeSlotId, slotSpan, ...dates, updatedAt: now }
            : placement,
        ),
      }));
      return { ok: true };
    };

    /**
     * A drafted edit, applied at the scope the user picked. All of the
     * recurrence reasoning lives in the domain; this only decides when its
     * result becomes state.
     */
    const applyClassEdit: AppStateContextValue["applyClassEdit"] = (draft, scope) => {
      const result = applyClassEditScope(
        {
          timeSlots: state.timeSlots,
          courses: state.courses,
          placements: state.placements,
          exceptions: state.exceptions,
        },
        draft,
        scope,
        new Date().toISOString(),
      );
      if (!result.ok) return { ok: false, error: result.error };

      setState((prev) => ({
        ...prev,
        courses: result.next.courses,
        placements: result.next.placements,
        exceptions: result.next.exceptions,
      }));
      return { ok: true };
    };

    const deletePlacement: AppStateContextValue["deletePlacement"] = (placementId) => {
      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        placements: prev.placements.map((placement) =>
          placement.id === placementId ? { ...placement, deletedAt: now, updatedAt: now } : placement,
        ),
        // Nothing may keep referring to a series that is gone.
        exceptions: prev.exceptions.map((exception) =>
          exception.placementId === placementId && !exception.deletedAt
            ? { ...exception, deletedAt: now, updatedAt: now }
            : exception,
        ),
      }));
    };

    const loadSampleTimetable: AppStateContextValue["loadSampleTimetable"] = () => {
      setState(createSeedState());
    };

    const resetPrototype: AppStateContextValue["resetPrototype"] = () => {
      setState(buildEmptyState());
    };

    return {
      state,
      setWeekendMode,
      setGridOrientation,
      setAcademicDayConfig,
      setTermConfig,
      updateTermInfo,
      upsertPlacement,
      movePlacement,
      checkPlacement,
      applyClassEdit,
      deletePlacement,
      loadSampleTimetable,
      resetPrototype,
    };
  }, [state]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used within an AppStateProvider.");
  }
  return context;
}
