import type { ReminderMinutes, ReminderOverride } from "@/domain/reminder";
import type { Weekday, WeekendMode } from "@/domain/week";
import type { LanguagePreference } from "@/i18n/language";
import type { AppearancePreference } from "@/theme/appearance";

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
  /**
   * Light, dark, or follow the device. The *preference* is stored, never the
   * scheme it currently resolves to — see `theme/appearance`.
   */
  appearancePreference: AppearancePreference;
  /** The UI language, or follow the device. Again the preference, not the result. */
  languagePreference: LanguagePreference;
  onboardingCompleted: boolean;
}

/**
 * Which of the stored settings belong to *this timetable* rather than to the
 * app as a whole.
 *
 * They all live in the same single `settings` row — splitting the table would
 * be a migration with nothing to show for it — so the distinction is declared
 * here as data instead, and it is load-bearing in exactly two places: what an
 * archive snapshot carries, and what a restore is allowed to overwrite.
 *
 * The line is drawn on "is this a fact about the schedule, or about the
 * person reading it":
 *
 *  - the academic day (start, lesson and break length, period count) *is* the
 *    timetable's skeleton. The periods it generates are addressed by id from
 *    every placement in the timetable, so it could not travel separately even
 *    if we wanted it to.
 *  - `weekendMode` is which days this timetable has classes on. A school year
 *    with Saturday classes and a university term without them are two
 *    different timetables, not one user changing their mind.
 *
 * Everything else stays app-global, including two that are close calls:
 *
 *  - `gridOrientation` is how the user prefers to *read* a week grid, not a
 *    property of any particular week in it. Carrying it in an archive would
 *    mean restoring a timetable silently re-rotated the screen.
 *  - `defaultReminderMinutes` is how this user likes to be reminded. It is the
 *    starting point for classes they create next, and should not change
 *    because they restored last year's timetable.
 *
 * Appearance and language are about the person too, and
 * `onboardingCompleted` records that the app has been set up at least once —
 * which stays true across every archive and restore.
 */
export const TIMETABLE_SETTING_KEYS = [
  "weekendMode",
  "academicDayStart",
  "defaultLessonDurationMinutes",
  "defaultBreakDurationMinutes",
  "slotCount",
] as const satisfies readonly (keyof Settings)[];

export type TimetableSettingKey = (typeof TIMETABLE_SETTING_KEYS)[number];

/** The slice of `Settings` an archived timetable carries with it. */
export type TimetableSettings = Pick<Settings, TimetableSettingKey>;

/**
 * A timetable: the thing the user names, archives and restores.
 *
 * This replaces the old `AcademicTerm`, and the difference is not only the
 * name. A term was a *date range* — a required start, an estimated end — and
 * that range was what stopped recurring classes. A timetable has a start and
 * no end: it is a name over a set of periods and classes, and a weekly class
 * in it repeats until the user says otherwise.
 *
 * There is at most one active timetable at a time. `null` where a
 * `Timetable` is expected is a real state — the user archived their only one
 * — and not an error.
 */
export interface Timetable {
  id: string;
  name: string;
  /**
   * The timetable's start date — "Starts on" in the UI.
   *
   * Stored as `anchor_date` since migration v6, and the name is kept because
   * renaming a column is a migration with nothing to show for it. It does two
   * things, and both follow from "this is when the timetable begins":
   *
   *  - it is a lower bound on every occurrence. Nothing in the timetable is
   *    drawn, clash-checked or reminded before it (see `OccurrenceSource`). The
   *    calendar itself stays navigable before it; those weeks are simply empty.
   *  - it is where a new weekly class starts when the user has not said, so a
   *    class added in November is still there when they page back to October.
   *
   * It is not a semester: there is no end date, and changing it rewrites
   * nothing. Every series keeps its own `startsOn`, which is what keeps an
   * alternating class on its own weeks whatever the timetable's start does.
   *
   * An upgrading user's timetable inherited the old term's start date in v6,
   * so not one existing class re-anchored and no alternating class changed
   * weeks. New timetables default to the Monday of the week they are made in.
   */
  anchorDate: string;
  createdAt: string;
  updatedAt: string;
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
  /**
   * Which palette colour the class is drawn in — a stable id such as "blue",
   * never a hex value and never an index. See `domain/classColor`.
   */
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
  /**
   * Colour override for this one occurrence — the "only this occurrence"
   * edit of the colour field. null follows the course, exactly as the other
   * course-field overrides above do.
   */
  appearanceId: string | null;
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
  /**
   * The series' first date, and its parity anchor.
   *
   * For an every-two-week class this is not merely when it begins: which half
   * of the fortnight it falls on is counted from here, which is why the anchor
   * is per-series and travels with the series whenever it moves.
   */
  startsOn: string;
  /**
   * The series' last date, or `OPEN_ENDED_DATE` when it does not have one.
   *
   * Open-ended is the normal case for anything that repeats: a weekly class
   * runs until the user changes or deletes it, not until a date they were once
   * asked to guess. A real date here means the series genuinely stops — a
   * one-off, which ends on its own day, or the earlier half of a series that a
   * "this and future" edit split.
   *
   * See `domain/recurrence` for the sentinel and `isOpenEndedSeries`.
   */
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
