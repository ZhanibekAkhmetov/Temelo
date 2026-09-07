import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SQLiteDatabase } from "expo-sqlite";

import { nextClassColorId } from "@/domain/classColor";
import { applyClassEditScope, type ClassEditDraft, type EditScope } from "@/domain/classEdit";
import { findOccurrenceConflict, findPlacementConflict, type PlacementCandidate } from "@/domain/conflict";
import { isIsoDateBeforeOrEqual, isValidIsoDate } from "@/domain/date";
import { domainError, type DomainError } from "@/domain/errors";
import { createId } from "@/domain/id";
import type { Occurrence } from "@/domain/occurrence";
import { seriesRangeMovedTo } from "@/domain/recurrence";
import type { ReminderMinutes } from "@/domain/reminder";
import { generateTimeSlots } from "@/domain/time";
import type { Weekday, WeekendMode } from "@/domain/week";
import type { LanguagePreference } from "@/i18n/language";
import type { AppearancePreference } from "@/theme/appearance";
import { createDefaultTerm, createDefaultTimeSlots, DEFAULT_SETTINGS } from "@/state/defaults";
import { createSampleTimetable } from "@/state/sampleTimetable";
import { bootstrapStorage } from "@/storage/bootstrap";
import { readStorageReport as readStorageReport_, type StorageReport } from "@/storage/diagnostics";
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

export type ActionResult = { ok: true } | { ok: false; error: DomainError };

/**
 * Whether what the user is looking at has actually reached the disk.
 *
 * Storage used to report only one thing — whether the database could be
 * *opened* — and a database that opens perfectly well can still refuse every
 * write. That gap is exactly how a session can look saved and come back empty,
 * so the outcome of the writes themselves is tracked too, and surfaced.
 */
export interface PersistenceStatus {
  /** Null until the first write has been attempted this launch. */
  lastWriteOk: boolean | null;
  lastWriteAt: number | null;
  /** The SQLite message from the most recent failure, verbatim. */
  lastError: string | null;
  failureCount: number;
  /** Write attempts settled this launch, successful or not. */
  writeCount: number;
}

const INITIAL_PERSISTENCE: PersistenceStatus = {
  lastWriteOk: null,
  lastWriteAt: null,
  lastError: null,
  failureCount: 0,
  writeCount: 0,
};

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
  /** Palette id; omitted lets a brand-new class take the next colour in turn. */
  appearanceId?: string;
  recurrenceType: RecurrenceType;
  startsOn: string;
  endsOn: string;
  /** Lead time before the class starts, or null for no reminder. */
  reminderMinutes: ReminderMinutes;
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
  /**
   * Whether writes are actually landing. A screen that tells the user their
   * change was saved has to consult this, not merely the fact that the action
   * passed its validation.
   */
  persistence: PersistenceStatus;
  /** Development only: what the database on this device really looks like. */
  readStorageReport: () => Promise<StorageReport | null>;
  setWeekendMode: (input: { weekendMode: WeekendMode }) => void;
  setGridOrientation: (input: { gridOrientation: GridOrientation }) => void;
  /**
   * Light, dark or follow-the-device. Applied the moment it is called —
   * there is no draft and no "Save changes" between the tap and the theme,
   * because an appearance choice is its own confirmation.
   */
  setAppearancePreference: (input: { appearancePreference: AppearancePreference }) => void;
  /** The UI language, applied immediately for the same reason. */
  setLanguagePreference: (input: { languagePreference: LanguagePreference }) => void;
  /**
   * The reminder newly created classes start with. Existing classes keep
   * whatever they were given, so this is never retroactive.
   */
  setDefaultReminder: (input: { reminderMinutes: ReminderMinutes }) => void;
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
  /** Development only; see `createSampleTimetable`. No-op in a release build. */
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
  return { ok: false, error: domainError("errors.slotInUse", { name: conflict.course.name }) };
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(buildInitialState);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<PersistenceStatus>(INITIAL_PERSISTENCE);

  const databaseRef = useRef<SQLiteDatabase | null>(null);
  /** What `openTemeloDatabase` reported, kept for the diagnostics panel. */
  const bootstrapRef = useRef<{ schemaVersion: number; repairedColumns: string[] } | null>(null);
  /**
   * The last state handed to the write queue — the baseline every diff is
   * taken against. Null means "the database's contents are unknown", which
   * makes the next save write everything.
   */
  const persistedRef = useRef<PersistedTimetable | null>(null);
  /**
   * The last state that is *known* to be on the disk.
   *
   * The same object as `persistedRef` while writes are succeeding, and the
   * difference between them is the whole recovery story: `persistedRef` is
   * cleared by a failure, because the database's contents stop being known the
   * moment a transaction is rolled back, while this keeps naming the last
   * state that definitely reached it. That is what a failed save is put back
   * to, so the app never keeps showing an academic day the database does not
   * have.
   */
  const lastKnownGoodRef = useRef<AppState | null>(null);
  /**
   * The state as of the most recent render, readable from inside the write
   * queue. A failed write may only revert what is still on screen; if the user
   * has done something since, that newer state is theirs to keep and the
   * database is reconciled to it instead.
   */
  const latestStateRef = useRef<AppState>(state);
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
      .then(({ db, timetable, schemaVersion, repairedColumns }) => {
        if (cancelled) return;
        databaseRef.current = db;
        bootstrapRef.current = { schemaVersion, repairedColumns };

        if (timetable) {
          // The very same object becomes both the state and the diff
          // baseline, so the first persistence pass after hydration sees
          // nothing changed and writes nothing back.
          persistedRef.current = timetable;
          lastKnownGoodRef.current = timetable;
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
   * What the user is currently looking at, kept where the write queue can read
   * it. Its own effect rather than an assignment during render, so it is
   * updated for every state — including the one a revert puts back, which the
   * persistence effect below deliberately returns from early.
   */
  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

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
    if (persistedRef.current === state) return;

    writeQueueRef.current = writeQueueRef.current.then(async () => {
      // Re-read the baseline inside the queue: an earlier write in this chain
      // may have advanced it, or failed and cleared it, since this effect ran.
      const previous = persistedRef.current;
      if (previous === state) return;

      try {
        await saveTimetable(db, state, previous);
        /*
         * Both baselines advance only here, after the transaction has actually
         * committed. The diff baseline used to advance optimistically before
         * the write, which meant a state that never reached the disk was
         * nonetheless treated as the thing on disk — so a later diff was taken
         * against a fiction.
         */
        persistedRef.current = state;
        lastKnownGoodRef.current = state;
        setPersistence((current) => ({
          lastWriteOk: true,
          lastWriteAt: Date.now(),
          lastError: null,
          failureCount: current.failureCount,
          writeCount: current.writeCount + 1,
        }));
      } catch (error: unknown) {
        // The baseline is no longer trustworthy, so the next save is a full
        // write rather than a diff against a state that never landed. That is
        // also what makes this self-healing: once the underlying fault is
        // gone, the next successful write carries everything the failed ones
        // did not.
        persistedRef.current = null;
        const message = error instanceof Error ? error.message : String(error);

        /*
         * The transaction rolled back, so the database still holds the last
         * state that committed — and the app has to go back to agreeing with
         * it. Leaving the rejected state on screen is what made a failed
         * academic-day save so damaging: the grid drew seven periods, SQLite
         * held eight, every later diff was taken against the wrong side of
         * that, and a restart silently threw the session away.
         *
         * Two conditions, both load-bearing:
         *
         *  - only when there *is* a known-good state. Before the first
         *    successful write there is nothing to go back to, and inventing
         *    one would discard the user's only copy of their work.
         *  - only when the rejected state is still the one on screen. If the
         *    user has changed something since, that is a decision made after
         *    the failure and is not ours to undo; the cleared baseline above
         *    makes the next attempt a full write, which converges the database
         *    on it instead.
         *
         * Reverting cannot loop. `persistedRef` is set to the very object the
         * state is being put back to, so the effect that this `setState`
         * schedules finds `persistedRef.current === state` and writes nothing.
         */
        const knownGood = lastKnownGoodRef.current;
        if (knownGood && knownGood !== state && latestStateRef.current === state) {
          persistedRef.current = knownGood;
          setState(knownGood);
        }

        /*
         * `console.error`, not `warn`. A failed write means the app is running
         * in memory only and everything the user does will be gone when the
         * process dies — which is the single most damaging thing that can go
         * wrong here, and it used to be one grey line in a log nobody reads.
         */
        console.error("[temelo/storage] a change was NOT saved; the app is running in memory only:", message, error);

        setPersistence((current) => ({
          lastWriteOk: false,
          lastWriteAt: Date.now(),
          lastError: message,
          failureCount: current.failureCount + 1,
          writeCount: current.writeCount + 1,
        }));
      }
    });
  }, [state, hydrated]);

  const value = useMemo<AppStateContextValue>(() => {
    /*
     * Reads the database's real shape, on demand, for the development
     * diagnostics panel. Deliberately a function rather than state: it hits
     * the disk, and nothing outside that panel should be paying for it.
     */
    const readStorageReport: AppStateContextValue["readStorageReport"] = async () => {
      const db = databaseRef.current;
      if (!db) return null;
      return readStorageReport_(db, bootstrapRef.current?.repairedColumns ?? []);
    };

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

    const setAppearancePreference: AppStateContextValue["setAppearancePreference"] = (input) => {
      setState((prev) =>
        prev.settings.appearancePreference === input.appearancePreference
          ? prev
          : { ...prev, settings: { ...prev.settings, appearancePreference: input.appearancePreference } },
      );
    };

    const setLanguagePreference: AppStateContextValue["setLanguagePreference"] = (input) => {
      setState((prev) =>
        prev.settings.languagePreference === input.languagePreference
          ? prev
          : { ...prev, settings: { ...prev.settings, languagePreference: input.languagePreference } },
      );
    };

    const setDefaultReminder: AppStateContextValue["setDefaultReminder"] = (input) => {
      setState((prev) => ({
        ...prev,
        settings: { ...prev.settings, defaultReminderMinutes: input.reminderMinutes },
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
      if (!name) return { ok: false, error: domainError("errors.termNameRequired") };
      if (!isValidIsoDate(input.startDate)) {
        return { ok: false, error: domainError("errors.startDateInvalid") };
      }
      if (!isValidIsoDate(input.estimatedEndDate)) {
        return { ok: false, error: domainError("errors.estimatedEndDateInvalid") };
      }
      if (!isIsoDateBeforeOrEqual(input.startDate, input.estimatedEndDate)) {
        return { ok: false, error: domainError("errors.estimatedEndBeforeStart") };
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
      if (!name) return { ok: false, error: domainError("errors.termNameRequired") };
      if (!isValidIsoDate(input.estimatedEndDate)) {
        return { ok: false, error: domainError("errors.estimatedEndDateInvalid") };
      }
      if (!isIsoDateBeforeOrEqual(state.term.startDate, input.estimatedEndDate)) {
        return { ok: false, error: domainError("errors.estimatedEndBeforeTermStart") };
      }

      setState((prev) => ({
        ...prev,
        term: { ...prev.term, name, estimatedEndDate: input.estimatedEndDate },
      }));
      return { ok: true };
    };

    const upsertPlacement: AppStateContextValue["upsertPlacement"] = (input) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: domainError("errors.classNameRequired") };
      if (!isValidIsoDate(input.startsOn)) {
        return { ok: false, error: domainError("errors.startDateInvalid") };
      }
      if (!isValidIsoDate(input.endsOn)) {
        return { ok: false, error: domainError("errors.endDateInvalid") };
      }
      if (!isIsoDateBeforeOrEqual(input.startsOn, input.endsOn)) {
        return { ok: false, error: domainError("errors.endBeforeStart") };
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
        if (!existing) return { ok: false, error: domainError("errors.classGone") };

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
                  appearanceId: input.appearanceId ?? course.appearanceId,
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
                  reminderMinutes: input.reminderMinutes,
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
        // The editor always supplies one; the fallback keeps the rotation
        // correct for any caller that does not care about colour.
        appearanceId: input.appearanceId ?? nextClassColorId(state.courses),
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
        reminderMinutes: input.reminderMinutes,
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
      if (!existing || existing.deletedAt) return { ok: false, error: domainError("errors.classGone") };

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
      if (!existing || existing.deletedAt) return { ok: false, error: domainError("errors.classGone") };

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

    /*
     * A developer convenience, and gated here as well as in the UI that
     * offers it. Sample classes must never be able to appear in a real
     * user's timetable, and one guard that lives next to the call is worth
     * more than an assumption about which screens ship.
     */
    const loadSampleTimetable: AppStateContextValue["loadSampleTimetable"] = () => {
      if (!__DEV__) return;
      setState(createSampleTimetable());
    };

    const resetPrototype: AppStateContextValue["resetPrototype"] = () => {
      setState(buildEmptyState());
    };

    return {
      state,
      hydrated,
      storageError,
      persistence,
      readStorageReport,
      setWeekendMode,
      setGridOrientation,
      setAppearancePreference,
      setLanguagePreference,
      setDefaultReminder,
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
  }, [state, hydrated, storageError, persistence]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used within an AppStateProvider.");
  }
  return context;
}
