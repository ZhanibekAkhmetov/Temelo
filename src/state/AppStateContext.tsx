import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SQLiteDatabase } from "expo-sqlite";

import { applyClassEditScope, type ClassEditDraft, type EditScope } from "@/domain/classEdit";
import { findOccurrenceConflict, findPlacementConflict, type PlacementCandidate } from "@/domain/conflict";
import { isIsoDateBeforeOrEqual, isValidIsoDate } from "@/domain/date";
import { createId } from "@/domain/id";
import type { Occurrence } from "@/domain/occurrence";
import { seriesRangeMovedTo } from "@/domain/recurrence";
import { generateTimeSlots } from "@/domain/time";
import type { Weekday, WeekendMode } from "@/domain/week";
import { APPEARANCE_PALETTE } from "@/theme/tokens";
import { createDefaultTerm, createDefaultTimeSlots, DEFAULT_SETTINGS } from "@/state/defaults";
import { createSeedState } from "@/state/seed";
import { bootstrapStorage } from "@/storage/bootstrap";
import { saveTimetable, type PersistedTimetable } from "@/storage/timetableRepository";
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
  /** Date the dragged occurrence has in its series — where the move starts. */
  occurrenceDate: string;
  /**
   * Destination date in the week the drag happened in. Together with
   * `occurrenceDate` this is how far the series moves, which is what keeps
   * an every-two-week class on its own half of the fortnight.
   */
  date: string;
}

/** A drag or resize judged on one date only: one occurrence, or a new range. */
export interface OccurrencePositionInput {
  /** null while the range is not a class yet. */
  occurrenceId: string | null;
  date: string;
  timeSlotId: string;
  slotSpan: number;
}

interface AppStateContextValue {
  state: AppState;
  /**
   * False until the stored timetable has been read back. Nothing that
   * renders app data may run before this is true — see `BootGate`.
   */
  hydrated: boolean;
  /**
   * Set when storage could not be opened at all. The app still runs, in
   * memory only, rather than refusing to start; the message is for
   * development and for deciding whether to warn the user.
   */
  storageError: string | null;
  setWeekendMode: (input: { weekendMode: WeekendMode }) => void;
  setGridOrientation: (input: { gridOrientation: GridOrientation }) => void;
  setAcademicDayConfig: (input: AcademicDayConfigInput) => ActionResult;
  setTermConfig: (input: TermConfigInput) => ActionResult;
  updateTermInfo: (input: TermInfoInput) => ActionResult;
  upsertPlacement: (input: UpsertPlacementInput) => ActionResult;
  movePlacement: (input: MovePlacementInput) => ActionResult;
  /** Read-only: whether a proposed position is free for a whole series. */
  checkPlacement: (input: MovePlacementInput) => ActionResult;
  /** Read-only: the same question asked of a single date. Changes nothing. */
  checkOccurrence: (input: OccurrencePositionInput) => ActionResult;
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
 * What the app holds before storage has answered.
 *
 * Empty, deliberately. This value is never rendered — `BootGate` holds the
 * UI back until hydration finishes — and it is never written, because the
 * persistence effect below does nothing until then. Seeding it instead
 * would mean that any hiccup in hydration showed one particular person's
 * timetable to whoever was holding the phone.
 */
function buildInitialState(): AppState {
  return buildEmptyState();
}

/**
 * The whole stored timetable is handed to the check, exceptions included:
 * an occurrence that has been moved out of a slot no longer defends it, and
 * one that has been moved into a slot does.
 */
function findConflict(state: AppState, candidate: PlacementCandidate): Occurrence | undefined {
  return findPlacementConflict(state, candidate);
}

function conflictError(conflict: Occurrence): ActionResult {
  return { ok: false, error: `This slot is already used by ${conflict.course.name}.` };
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(buildInitialState);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  const databaseRef = useRef<SQLiteDatabase | null>(null);
  /**
   * The last state handed to the write queue — the baseline every diff is
   * taken against. Null means "the database's contents are unknown", which
   * makes the next save write everything.
   */
  const persistedRef = useRef<PersistedTimetable | null>(null);
  /** Serializes writes, so two quick gestures cannot interleave. */
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  /**
   * Hydration. Runs once: `bootstrapStorage` memoizes the whole open →
   * migrate → import → load sequence, so a development double-mount joins
   * the run already in progress rather than starting a second one.
   */
  useEffect(() => {
    let cancelled = false;

    bootstrapStorage()
      .then(({ db, timetable }) => {
        if (cancelled) return;
        databaseRef.current = db;

        if (timetable) {
          // The very same object becomes both the state and the diff
          // baseline, so the first persistence pass after hydration sees
          // nothing changed and writes nothing back.
          persistedRef.current = timetable;
          setState(timetable);
        }
        setHydrated(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Storage is unavailable — most likely a development build that
        // predates expo-sqlite. Carry on in memory rather than presenting a
        // dead app, but never pretend the data is being saved.
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[temelo/storage] could not open the database; running in memory only", error);
        setStorageError(message);
        setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Persistence. Every successful action produces a new state object, and
   * every new state object is diffed against the last one written and saved
   * in a single transaction. Actions that fail their validation return
   * without calling `setState`, so the state is unchanged and there is
   * nothing here to write — which is exactly the "only successful mutations
   * are persisted" rule, enforced by construction rather than by
   * remembering to add a save call to each new action.
   */
  useEffect(() => {
    const db = databaseRef.current;
    if (!hydrated || !db) return;

    const previous = persistedRef.current;
    if (previous === state) return;
    persistedRef.current = state;

    writeQueueRef.current = writeQueueRef.current
      .then(() => saveTimetable(db, state, previous))
      .catch((error: unknown) => {
        // The baseline is no longer trustworthy, so the next save is made a
        // full write rather than a diff against a state that never landed.
        persistedRef.current = null;
        console.warn("[temelo/storage] failed to persist a change", error);
      });
  }, [state, hydrated]);

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
      if (conflict) return conflictError(conflict);

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
     * The series a move would produce: the same placement, at the proposed
     * position, with its date range carried along by the move.
     *
     * The range has to travel with it. Parity of an every-two-week class is
     * counted from its own first occurrence, which is derived from its start
     * date *and* its weekday — so a candidate that took the new weekday but
     * kept the stored start date would be judged on a fortnight half the
     * series was never on. `applyClassEditScope` shifts the range for the
     * same reason, through the same helper, so the check and the commit
     * cannot disagree.
     */
    const movedCandidate = (existing: Placement, input: MovePlacementInput): PlacementCandidate => ({
      placementId: existing.id,
      weekday: input.weekday,
      timeSlotId: input.timeSlotId,
      slotSpan: Math.max(1, input.slotSpan),
      recurrenceType: existing.recurrenceType,
      ...seriesRangeMovedTo(existing, input.occurrenceDate, input.date),
    });

    /**
     * The same validation `movePlacement` applies, without applying it —
     * so a drag in progress can show whether where it is hovering would be
     * accepted, using one rule rather than two.
     */
    const checkPlacement: AppStateContextValue["checkPlacement"] = (input) => {
      const existing = state.placements.find((placement) => placement.id === input.placementId);
      if (!existing || existing.deletedAt) return { ok: false, error: "This class no longer exists." };

      const conflict = findConflict(state, movedCandidate(existing, input));
      return conflict ? conflictError(conflict) : { ok: true };
    };

    /**
     * Whether one occurrence — or a range that is not a class yet — can sit
     * at a position on a single date. The whole-series check would be the
     * wrong question for both: an occurrence that has already stepped out of
     * its series answers only for its own date.
     */
    const checkOccurrence: AppStateContextValue["checkOccurrence"] = (input) => {
      const conflict = findOccurrenceConflict(state, {
        occurrenceId: input.occurrenceId,
        date: input.date,
        timeSlotId: input.timeSlotId,
        slotSpan: Math.max(1, input.slotSpan),
      });
      return conflict ? conflictError(conflict) : { ok: true };
    };

    /**
     * The settled result of a grid drag or resize. Only the position moves,
     * so the course and the recurrence rule are left untouched; the date
     * range travels with the move rather than staying behind.
     */
    const movePlacement: AppStateContextValue["movePlacement"] = (input) => {
      const existing = state.placements.find((placement) => placement.id === input.placementId);
      if (!existing || existing.deletedAt) return { ok: false, error: "This class no longer exists." };

      const candidate = movedCandidate(existing, input);
      const dates = { startsOn: candidate.startsOn, endsOn: candidate.endsOn };
      const unchanged =
        existing.weekday === input.weekday &&
        existing.timeSlotId === input.timeSlotId &&
        existing.slotSpan === candidate.slotSpan &&
        existing.startsOn === dates.startsOn;
      if (unchanged) return { ok: true };

      const conflict = findConflict(state, candidate);
      if (conflict) return conflictError(conflict);

      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        placements: prev.placements.map((placement) =>
          placement.id === input.placementId
            ? {
                ...placement,
                weekday: input.weekday,
                timeSlotId: input.timeSlotId,
                slotSpan: candidate.slotSpan,
                ...dates,
                updatedAt: now,
              }
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
      hydrated,
      storageError,
      setWeekendMode,
      setGridOrientation,
      setAcademicDayConfig,
      setTermConfig,
      updateTermInfo,
      upsertPlacement,
      movePlacement,
      checkPlacement,
      checkOccurrence,
      applyClassEdit,
      deletePlacement,
      loadSampleTimetable,
      resetPrototype,
    };
  }, [state, hydrated, storageError]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used within an AppStateProvider.");
  }
  return context;
}
