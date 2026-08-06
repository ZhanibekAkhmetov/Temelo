/**
 * Turning stored placements into what a single displayed week contains.
 * Pure lookup logic, kept out of the grid components so every layout reads
 * from exactly one resolution rule.
 */

import { resolveOccurrences, type Occurrence, type OccurrencePreview } from "@/domain/occurrence";
import type { Weekday } from "@/domain/week";
import type { Course, OccurrenceException, Placement, TimeSlot } from "@/types/models";

/** One meeting of a class: what the grid draws and what an edit is about. */
export type ScheduledClass = Occurrence;

/** A class as it is drawn in one week: which column, which rows. */
export interface WeekBlock extends ScheduledClass {
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
  exceptions: OccurrenceException[];
  timeSlots: TimeSlot[];
  /** An edit awaiting a scope choice, drawn where it would land. */
  preview?: OccurrencePreview | null;
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

function occurrencesInWeek(input: ResolveWeekInput): Occurrence[] {
  const dates = input.weekdays.map((weekday) => input.dates[weekday]);
  const shown = new Set(input.weekdays);
  // An occurrence can only be drawn on a day the week actually shows — a
  // class moved onto a hidden weekend day is simply not in this week.
  return resolveOccurrences(input, dates).filter((occurrence) => shown.has(occurrence.weekday));
}

/**
 * Classes meeting in the displayed week, positioned for a grid that draws
 * them as absolutely placed blocks.
 */
export function resolveWeekBlocks(input: ResolveWeekInput): WeekBlock[] {
  const { weekdays, timeSlots } = input;

  return occurrencesInWeek(input).flatMap((occurrence) => {
    const startIndex = timeSlots.findIndex((slot) => slot.id === occurrence.placement.timeSlotId);
    if (startIndex < 0) return [];
    const span = Math.max(1, Math.min(occurrence.placement.slotSpan, timeSlots.length - startIndex));
    return [
      {
        ...occurrence,
        dayIndex: weekdays.indexOf(occurrence.weekday),
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

  for (const occurrence of occurrencesInWeek(input)) {
    const slotIds = occupiedSlotIds(input.timeSlots, occurrence.placement.timeSlotId, occurrence.placement.slotSpan);
    for (const slotId of slotIds) {
      byCell.set(cellKey(occurrence.weekday, slotId), occurrence);
    }
  }

  return byCell;
}
