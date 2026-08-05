/**
 * A ready-made timetable so the prototype can be exercised without typing
 * every class in by hand. It uses the default academic day (07:30 start,
 * 90-minute periods, 20-minute breaks — exactly the DS grid these entries
 * came from), and anchors the term two weeks before the current week so
 * paging backwards and forwards both land on real data.
 */

import { addWeeksIso, startOfWeekIso } from "@/domain/calendar";
import { addDaysIso, todayIsoDate } from "@/domain/date";
import { createId } from "@/domain/id";
import type { Weekday } from "@/domain/week";
import { createDefaultTimeSlots, DEFAULT_SETTINGS } from "@/state/defaults";
import { APPEARANCE_PALETTE } from "@/theme/tokens";
import type { AcademicTerm, Course, Placement, RecurrenceType, Settings, TimeSlot } from "@/types/models";

const TERM_STARTS_WEEKS_AGO = 2;
const TERM_LENGTH_WEEKS = 18;

interface SeedEntry {
  weekday: Weekday;
  /** 1-based DS number. */
  period: number;
  name: string;
  room: string;
  recurrence: RecurrenceType;
  /** Which half of the two-week cycle a biweekly class falls on. */
  cycle?: "even" | "odd";
}

const SEED_ENTRIES: SeedEntry[] = [
  { weekday: "monday", period: 3, name: "V SWT", room: "HSZ/2", recurrence: "weekly" },
  { weekday: "monday", period: 5, name: "Ü Proga", room: "HSZ/3", recurrence: "weekly" },
  { weekday: "tuesday", period: 2, name: "V IKT", room: "HSZ/4", recurrence: "weekly" },
  { weekday: "tuesday", period: 3, name: "V Mathe", room: "HSZ/2", recurrence: "biweekly", cycle: "even" },
  { weekday: "tuesday", period: 4, name: "Ü Mathe", room: "WIL/A124", recurrence: "weekly" },
  { weekday: "wednesday", period: 4, name: "Ü SWT", room: "APB/E001", recurrence: "weekly" },
  { weekday: "wednesday", period: 5, name: "Ü IKT", room: "APB/E007", recurrence: "biweekly", cycle: "odd" },
  { weekday: "thursday", period: 4, name: "V ECG", room: "HSZ/4", recurrence: "weekly" },
  { weekday: "friday", period: 2, name: "V Proga", room: "HSZ/3", recurrence: "weekly" },
  { weekday: "friday", period: 3, name: "V Mathe", room: "HSZ/02/E", recurrence: "weekly" },
];

export interface SeededState {
  settings: Settings;
  term: AcademicTerm;
  timeSlots: TimeSlot[];
  courses: Course[];
  placements: Placement[];
}

/**
 * Courses are keyed by name so the two Mathe lectures and the lecture and
 * exercise of the same subject keep distinct colours, while a repeated name
 * reuses one course record — placements are reusable per course by design.
 */
export function createSeedState(): SeededState {
  const now = new Date().toISOString();
  const termStart = addWeeksIso(startOfWeekIso(todayIsoDate()), -TERM_STARTS_WEEKS_AGO);
  const termEnd = addWeeksIso(termStart, TERM_LENGTH_WEEKS);
  const timeSlots = createDefaultTimeSlots();

  const courses: Course[] = [];
  const courseIdsByKey = new Map<string, string>();

  function courseIdFor(entry: SeedEntry): string {
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

  const placements: Placement[] = SEED_ENTRIES.flatMap((entry) => {
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
  };
}
