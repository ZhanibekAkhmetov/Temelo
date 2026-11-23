/**
 * Turning stored placements into what a single displayed week contains.
 * Pure lookup logic, kept out of the grid components so every layout reads
 * from exactly one resolution rule.
 */

import { weekdayOfIsoDate } from "@/domain/calendar";
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
  /**
   * Which side-by-side lane of its column it is drawn in, and how many lanes
   * its group of overlapping classes needs. 0 of 1 for a class nothing
   * overlaps — the whole column, exactly as before overlaps were possible.
   */
  lane: number;
  laneCount: number;
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
  /** The timetable's start date; weeks before it draw nothing. See `OccurrenceSource`. */
  timetableStart?: string | null;
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
  // class on, or moved onto, a hidden day is simply not drawn this week. It
  // is still an occurrence: reminders and the calendar export never ask this.
  return resolveOccurrences(input, dates).filter((occurrence) => shown.has(occurrence.weekday));
}

/**
 * The order classes sharing a cell are listed and laid out in: earliest start
 * first, then the longer one, then by name, then by identity — so the same
 * week always draws the same way, whatever order the store holds them in.
 */
function compareForLayout(
  a: { startIndex: number; span: number; course: { name: string }; occurrenceId: string },
  b: { startIndex: number; span: number; course: { name: string }; occurrenceId: string },
): number {
  if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
  if (a.span !== b.span) return b.span - a.span;
  const byName = a.course.name.localeCompare(b.course.name);
  if (byName !== 0) return byName;
  return a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0;
}

/** What lane assignment reads of a block. */
export interface LaneInput {
  dayIndex: number;
  startIndex: number;
  span: number;
  course: { name: string };
  occurrenceId: string;
}

/**
 * Side-by-side lanes for classes that overlap in one day column.
 *
 * The usual calendar layout, kept deliberately small. Within a column, blocks
 * are taken in `compareForLayout` order and grouped into runs that overlap
 * each other transitively; each block takes the lowest lane that is free by
 * the time it starts, and every block of a run is told how many lanes the run
 * needed. A block that overlaps nothing is lane 0 of 1 — the full column — so
 * a timetable without overlaps draws exactly as it always has.
 *
 * Pure and positional only: it never decides what is *in* a cell, which stays
 * `resolveOccurrences`'s job.
 */
export function assignLanes<T extends LaneInput>(blocks: T[]): (T & { lane: number; laneCount: number })[] {
  const placed = new Map<T, { lane: number; laneCount: number }>();
  const byDay = new Map<number, T[]>();
  for (const block of blocks) {
    const bucket = byDay.get(block.dayIndex);
    if (bucket) bucket.push(block);
    else byDay.set(block.dayIndex, [block]);
  }

  for (const column of byDay.values()) {
    const ordered = [...column].sort(compareForLayout);
    let run: { block: T; lane: number }[] = [];
    /** End row of each lane's most recent block within the current run. */
    let laneEnds: number[] = [];
    let runEnd = -1;

    const closeRun = () => {
      for (const entry of run) placed.set(entry.block, { lane: entry.lane, laneCount: laneEnds.length });
      run = [];
      laneEnds = [];
      runEnd = -1;
    };

    for (const block of ordered) {
      if (run.length > 0 && block.startIndex >= runEnd) closeRun();
      let lane = laneEnds.findIndex((end) => end <= block.startIndex);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = block.startIndex + block.span;
      runEnd = Math.max(runEnd, block.startIndex + block.span);
      run.push({ block, lane });
    }
    closeRun();
  }

  return blocks.map((block) => ({ ...block, ...(placed.get(block) ?? { lane: 0, laneCount: 1 }) }));
}

/**
 * Classes meeting in the displayed week, positioned for a grid that draws
 * them as absolutely placed blocks — overlapping ones in side-by-side lanes.
 */
export function resolveWeekBlocks(input: ResolveWeekInput): WeekBlock[] {
  const { weekdays, timeSlots } = input;

  const positioned = occurrencesInWeek(input).flatMap((occurrence) => {
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

  return assignLanes(positioned);
}

/**
 * Every block drawn over one cell of the week, in layout order.
 *
 * What a tap on the grid is about. More than one means the cell holds
 * overlapping classes, and the tap has to ask which of them was meant rather
 * than guess from a few points of a narrow lane.
 */
export function blocksAtCell<T extends { dayIndex: number; startIndex: number; span: number; lane: number }>(
  blocks: T[],
  dayIndex: number,
  slotIndex: number,
): T[] {
  return blocks
    .filter((block) => block.dayIndex === dayIndex && slotIndex >= block.startIndex && slotIndex < block.startIndex + block.span)
    .sort((a, b) => a.lane - b.lane);
}

/**
 * The same classes keyed by every cell they occupy — for the cell-based
 * horizontal layout, which has no absolute positioning to span with.
 *
 * A list per cell, never a single class: two classes in one slot are two
 * entries, both drawn and both reachable. Each list is in the same order the
 * vertical layout assigns lanes in, so the two orientations agree on which
 * class comes first.
 */
export function resolveWeekClasses(input: ResolveWeekInput): Map<string, ScheduledClass[]> {
  const byCell = new Map<string, ScheduledClass[]>();
  const { timeSlots } = input;

  const ordered = occurrencesInWeek(input)
    .map((occurrence) => {
      const startIndex = timeSlots.findIndex((slot) => slot.id === occurrence.placement.timeSlotId);
      return { occurrence, startIndex, span: occurrence.placement.slotSpan, course: occurrence.course, occurrenceId: occurrence.occurrenceId };
    })
    .sort(compareForLayout);

  for (const { occurrence } of ordered) {
    const slotIds = occupiedSlotIds(timeSlots, occurrence.placement.timeSlotId, occurrence.placement.slotSpan);
    for (const slotId of slotIds) {
      const key = cellKey(occurrence.weekday, slotId);
      const bucket = byCell.get(key);
      if (bucket) bucket.push(occurrence);
      else byCell.set(key, [occurrence]);
    }
  }

  return byCell;
}

/**
 * The weekdays that hold at least one live class — what hiding a day would
 * take off the grid.
 *
 * A series counts on its own weekday; a one-off and a moved occurrence count
 * on the weekday of the date they actually meet on, because that is the
 * column they are drawn in. Deliberately generous — a past one-off still
 * counts — since the only use is to warn before a day disappears from view,
 * and a warning too many costs a tap while one too few looks like data loss.
 *
 * Hiding a day never touches any of these classes; see `Settings.visibleWeekdays`.
 */
export function weekdaysWithClasses(source: {
  placements: Placement[];
  courses: Course[];
  exceptions: OccurrenceException[];
}): Set<Weekday> {
  const liveCourses = new Set(source.courses.filter((course) => !course.deletedAt).map((course) => course.id));
  const live = source.placements.filter((placement) => !placement.deletedAt && liveCourses.has(placement.courseId));
  const liveIds = new Set(live.map((placement) => placement.id));
  const days = new Set<Weekday>();
  for (const placement of live) {
    days.add(placement.recurrenceType === "once" ? weekdayOfIsoDate(placement.startsOn) : placement.weekday);
  }
  for (const exception of source.exceptions) {
    if (exception.deletedAt || exception.state === "cancelled" || !liveIds.has(exception.placementId)) continue;
    days.add(weekdayOfIsoDate(exception.effectiveDate));
  }
  return days;
}
