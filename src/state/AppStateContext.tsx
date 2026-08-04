import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { isIsoDateBeforeOrEqual, isValidIsoDate } from "@/domain/date";
import { createId } from "@/domain/id";
import { generateTimeSlots } from "@/domain/time";
import type { Weekday, WeekendMode } from "@/domain/week";
import { APPEARANCE_PALETTE } from "@/theme/tokens";
import { createDefaultTerm, createDefaultTimeSlots, DEFAULT_SETTINGS } from "@/state/defaults";
import type { AcademicTerm, Course, Placement, RecurrenceType, Settings, TimeSlot } from "@/types/models";

export interface AppState {
  settings: Settings;
  term: AcademicTerm;
  timeSlots: TimeSlot[];
  courses: Course[];
  placements: Placement[];
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
  name: string;
  room: string;
  teacher: string;
  notes: string;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
}

interface AppStateContextValue {
  state: AppState;
  setWeekendMode: (input: { weekendMode: WeekendMode }) => void;
  setAcademicDayConfig: (input: AcademicDayConfigInput) => ActionResult;
  setTermConfig: (input: TermConfigInput) => ActionResult;
  updateTermInfo: (input: TermInfoInput) => ActionResult;
  upsertPlacement: (input: UpsertPlacementInput) => ActionResult;
  deletePlacement: (placementId: string) => void;
  resetPrototype: () => void;
}

function buildInitialState(): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    term: createDefaultTerm(),
    timeSlots: createDefaultTimeSlots(),
    courses: [],
    placements: [],
  };
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

      const conflict = state.placements.find(
        (placement) =>
          !placement.deletedAt &&
          placement.id !== input.placementId &&
          placement.weekday === input.weekday &&
          placement.timeSlotId === input.timeSlotId,
      );
      if (conflict) {
        const conflictCourse = state.courses.find((course) => course.id === conflict.courseId);
        return {
          ok: false,
          error: `This slot is already used by ${conflictCourse?.name ?? "another class"}.`,
        };
      }

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

    const deletePlacement: AppStateContextValue["deletePlacement"] = (placementId) => {
      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        placements: prev.placements.map((placement) =>
          placement.id === placementId ? { ...placement, deletedAt: now, updatedAt: now } : placement,
        ),
      }));
    };

    const resetPrototype: AppStateContextValue["resetPrototype"] = () => {
      setState(buildInitialState());
    };

    return {
      state,
      setWeekendMode,
      setAcademicDayConfig,
      setTermConfig,
      updateTermInfo,
      upsertPlacement,
      deletePlacement,
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
