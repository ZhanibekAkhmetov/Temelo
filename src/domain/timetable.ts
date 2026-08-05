/**
 * Turning stored placements into what a single displayed week contains.
 * Pure lookup logic, kept out of the grid components so every layout reads
 * from exactly one resolution rule.
 */

import { occursOn } from "@/domain/recurrence";
import type { Weekday } from "@/domain/week";
import type { Course, Placement, TimeSlot } from "@/types/models";

export interface ScheduledClass {
  placement: Placement;
  course: Course;
}

/** A class as it is drawn in one week: which column, which rows. */
export interface WeekBlock extends ScheduledClass {
  weekday: Weekday;
  date: string;
  /** Column index within the displayed weekdays. */
  dayIndex: number;
  /** Row index of the first period it occupies. */
  startIndex: number;
  /** How many period rows it spans. */
  span: number;
}

export interface ResolveWeekInput {
  weekdays: Weekday[];
  /** Calendar date for every weekday of the displayed week. */
  dates: Record<Weekday, string>;
  placements: Placement[];
  courses: Course[];
  timeSlots: TimeSlot[];
}

/** Stable key for a grid cell: one weekday of the shown week × one period. */
export function cellKey(weekday: Weekday, timeSlotId: string): string {
  return `${weekday}|${timeSlotId}`;
}

/**
 * The periods a placement occupies. Spans that would run past the end of
 * the configured day are truncated rather than rejected, so shortening the
 * academic day can never leave a class pointing at periods that are gone.
 */
export function occupiedSlotIds(timeSlots: TimeSlot[], startSlotId: string, slotSpan: number): string[] {
  const startIndex = timeSlots.findIndex((slot) => slot.id === startSlotId);
  if (startIndex < 0) return [];
  const end = Math.min(timeSlots.length, startIndex + Math.max(1, slotSpan));
  return timeSlots.slice(startIndex, end).map((slot) => slot.id);
}

function activeClassesInWeek({ weekdays, dates, placements, courses }: ResolveWeekInput): ScheduledClass[] {
  const shownWeekdays = new Set(weekdays);
  const found: ScheduledClass[] = [];

  for (const placement of placements) {
    if (placement.deletedAt) continue;
    if (!shownWeekdays.has(placement.weekday)) continue;
    if (!occursOn(placement, dates[placement.weekday])) continue;

    const course = courses.find((candidate) => candidate.id === placement.courseId && !candidate.deletedAt);
    if (!course) continue;

    found.push({ placement, course });
  }

  return found;
}

/**
 * Classes meeting in the displayed week, positioned for a grid that draws
 * them as absolutely placed blocks.
 */
export function resolveWeekBlocks(input: ResolveWeekInput): WeekBlock[] {
  const { weekdays, dates, timeSlots } = input;

  return activeClassesInWeek(input).flatMap((scheduled) => {
    const startIndex = timeSlots.findIndex((slot) => slot.id === scheduled.placement.timeSlotId);
    if (startIndex < 0) return [];
    const span = Math.max(1, Math.min(scheduled.placement.slotSpan, timeSlots.length - startIndex));
    return [
      {
        ...scheduled,
        weekday: scheduled.placement.weekday,
        date: dates[scheduled.placement.weekday],
        dayIndex: weekdays.indexOf(scheduled.placement.weekday),
        startIndex,
        span,
      },
    ];
  });
}

/**
 * The same classes keyed by every cell they occupy — for the cell-based
 * horizontal layout, which has no absolute positioning to span with.
 */
export function resolveWeekClasses(input: ResolveWeekInput): Map<string, ScheduledClass> {
  const byCell = new Map<string, ScheduledClass>();

  for (const scheduled of activeClassesInWeek(input)) {
    const slotIds = occupiedSlotIds(input.timeSlots, scheduled.placement.timeSlotId, scheduled.placement.slotSpan);
    for (const slotId of slotIds) {
      byCell.set(cellKey(scheduled.placement.weekday, slotId), scheduled);
    }
  }

  return byCell;
}
