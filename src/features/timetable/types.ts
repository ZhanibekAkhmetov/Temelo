import type { Weekday } from "@/domain/week";
import type { ScheduledClass } from "@/domain/timetable";
import type { Course, Placement, TimeSlot } from "@/types/models";

export interface SelectedCell {
  weekday: Weekday;
  /** Calendar date of the cell in the week that was on screen when it was tapped. */
  date: string;
  timeSlot: TimeSlot;
  /** Consecutive periods the class should occupy. */
  slotSpan: number;
  /** End time of the last period in the span, for the editor's caption. */
  endTime: string;
  existing?: ScheduledClass;
}

/**
 * What a week page draws on top of its classes: either the range the user
 * has marked out but not created yet, or the selected class with its resize
 * handles. Only ever one of them, and only on the page it belongs to.
 */
export interface PageOverlay {
  kind: "provisional" | "selected";
  dayIndex: number;
  startIndex: number;
  span: number;
}

/** What the gesture worklets need to hit-test the visible week. */
export interface HitBlock {
  /** null for the provisional block, which has no placement yet. */
  placementId: string | null;
  dayIndex: number;
  startIndex: number;
  span: number;
}

/** Everything the cell-based horizontal layout needs to draw one week. */
export interface WeekGridProps {
  weekStart: string;
  weekdays: Weekday[];
  timeSlots: TimeSlot[];
  placements: Placement[];
  courses: Course[];
  today: string;
  now: string;
  width: number;
  height: number;
  onCellPress: (selection: SelectedCell) => void;
}
