/**
 * A generic sample timetable, for development only.
 *
 * Its only job is to give a developer something to drag, resize and edit
 * without typing a term in by hand. Nothing loads it automatically: the one
 * caller is the "Load sample timetable" action in Settings, which is itself
 * hidden outside `__DEV__`, and it never touches a database that has not
 * been through the ordinary save path afterwards.
 *
 * The entries are deliberately invented — placeholder subjects and room
 * numbers that belong to nobody. A real timetable must only ever get into
 * the app the way a user puts it there.
 *
 * It uses the default academic day and anchors the term two weeks before the
 * current week, so paging backwards and forwards both land on real data. The
 * mix of weekly and every-two-week entries is there so recurrence behaviour
 * is exercised, not because it means anything.
 */

import { addWeeksIso, startOfWeekIso } from "@/domain/calendar";
import { addDaysIso, todayIsoDate } from "@/domain/date";
import { createId } from "@/domain/id";
import type { Weekday } from "@/domain/week";
import { createDefaultTimeSlots, DEFAULT_SETTINGS } from "@/state/defaults";
import { APPEARANCE_PALETTE } from "@/theme/tokens";
import type { AcademicTerm, Course, OccurrenceException, Placement, RecurrenceType, Settings, TimeSlot } from "@/types/models";

const TERM_STARTS_WEEKS_AGO = 2;
const TERM_LENGTH_WEEKS = 18;

interface SampleEntry {
  weekday: Weekday;
  /** 1-based period number. */
  period: number;
  name: string;
  room: string;
  recurrence: RecurrenceType;
  /** Which half of the two-week cycle a biweekly class falls on. */
  cycle?: "even" | "odd";
}

const SAMPLE_ENTRIES: SampleEntry[] = [
  { weekday: "monday", period: 3, name: "Mathematics", room: "Room 101", recurrence: "weekly" },
  { weekday: "monday", period: 5, name: "Physics", room: "Room 204", recurrence: "weekly" },
  { weekday: "tuesday", period: 2, name: "Chemistry", room: "Lab A", recurrence: "weekly" },
  { weekday: "tuesday", period: 3, name: "History", room: "Room 101", recurrence: "biweekly", cycle: "even" },
  { weekday: "tuesday", period: 4, name: "Mathematics", room: "Room 101", recurrence: "weekly" },
  { weekday: "wednesday", period: 4, name: "Biology", room: "Lab B", recurrence: "weekly" },
  { weekday: "wednesday", period: 5, name: "Geography", room: "Room 302", recurrence: "biweekly", cycle: "odd" },
  { weekday: "thursday", period: 4, name: "English", room: "Room 205", recurrence: "weekly" },
  { weekday: "friday", period: 2, name: "Physics", room: "Lab A", recurrence: "weekly" },
  { weekday: "friday", period: 3, name: "Music", room: "Room 118", recurrence: "weekly" },
];

/**
 * Structurally the same as `AppState`, declared here rather than imported so
 * that this module does not depend on the React layer that consumes it.
 */
export interface SampleTimetable {
  settings: Settings;
  term: AcademicTerm;
  timeSlots: TimeSlot[];
  courses: Course[];
  placements: Placement[];
  exceptions: OccurrenceException[];
}

/**
 * Courses are keyed by name and room, so two entries for the same subject in
 * the same room reuse one course record — placements are reusable per course
 * by design — while the same subject taught elsewhere stays distinct.
 */
export function createSampleTimetable(): SampleTimetable {
  const now = new Date().toISOString();
  const termStart = addWeeksIso(startOfWeekIso(todayIsoDate()), -TERM_STARTS_WEEKS_AGO);
  const termEnd = addWeeksIso(termStart, TERM_LENGTH_WEEKS);
  const timeSlots = createDefaultTimeSlots();

  const courses: Course[] = [];
  const courseIdsByKey = new Map<string, string>();

  function courseIdFor(entry: SampleEntry): string {
    const key = `${entry.name}|${entry.room}`;
    const existing = courseIdsByKey.get(key);
    if (existing) return existing;

    const course: Course = {
      id: createId(),
      name: entry.name,
      room: entry.room,
      teacher: "",
      notes: "",
      appearanceId: APPEARANCE_PALETTE[courses.length % APPEARANCE_PALETTE.length],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    courses.push(course);
    courseIdsByKey.set(key, course.id);
    return course.id;
  }

  const placements: Placement[] = SAMPLE_ENTRIES.flatMap((entry) => {
    const slot = timeSlots[entry.period - 1];
    if (!slot) return [];

    // A biweekly class meets every other week from its own start date, so
    // the two cycles are offset by one week against each other.
    const startsOn = entry.cycle === "odd" ? addDaysIso(termStart, 7) : termStart;

    return [
      {
        id: createId(),
        courseId: courseIdFor(entry),
        weekday: entry.weekday,
        timeSlotId: slot.id,
        slotSpan: 1,
        recurrenceType: entry.recurrence,
        startsOn,
        endsOn: termEnd,
        reminderMinutes: DEFAULT_SETTINGS.defaultReminderMinutes,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ];
  });

  return {
    settings: { ...DEFAULT_SETTINGS, onboardingCompleted: true },
    term: { id: createId(), name: "Current term", startDate: termStart, estimatedEndDate: termEnd },
    timeSlots,
    courses,
    placements,
    // A plain series set; exceptions only ever come from an "only this
    // occurrence" edit the user makes.
    exceptions: [],
  };
}
