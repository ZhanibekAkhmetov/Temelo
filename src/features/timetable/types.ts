import type { OccurrencePreview } from "@/domain/occurrence";
import type { Weekday } from "@/domain/week";
import type { ScheduledClass } from "@/domain/timetable";
import type { Course, OccurrenceException, Placement, TimeSlot } from "@/types/models";

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
 * A tap on a cell that holds more than one class.
 *
 * Overlapping classes share a column in narrow lanes, and a few points of a
 * lane is not something a thumb can be trusted to hit. So the tap opens a
 * short list instead: every class drawn over that cell, each one opening its
 * own editor, and a way to add yet another class at the same time.
 */
export interface SlotChoice {
  /** The tapped cell itself, one period long, as a new class would start. */
  newClass: SelectedCell;
  /** Every class over that cell, in lane order, each as its editor opens it. */
  classes: SelectedCell[];
}

/**
 * What a week page draws on top of its classes: either the range the user
 * has marked out but not created yet, or the selected class with its resize
 * handles. Only ever one of them, and only on the page it belongs to.
 */
export interface PageOverlay {
  kind: "provisional" | "selected";
  /** The selected class, so its outline can take that class's lane. */
  occurrenceId: string | null;
  dayIndex: number;
  startIndex: number;
  span: number;
}

/** What the gesture worklets need to hit-test the visible week. */
export interface HitBlock {
  /** null for the provisional block, which has no occurrence yet. */
  occurrenceId: string | null;
  dayIndex: number;
  startIndex: number;
  span: number;
  /** Side-by-side lane within the column, and how many lanes its group has. */
  lane: number;
  laneCount: number;
}

/** Everything the cell-based horizontal layout needs to draw one week. */
export interface WeekGridProps {
  weekStart: string;
  weekdays: Weekday[];
  timeSlots: TimeSlot[];
  placements: Placement[];
  courses: Course[];
  exceptions: OccurrenceException[];
  /** An edit awaiting a scope choice, drawn where it would land. */
  preview: OccurrencePreview | null;
  /** The timetable's start date; nothing is drawn before it. */
  timetableStart: string;
  today: string;
  now: string;
  width: number;
  height: number;
  onCellPress: (selection: SelectedCell) => void;
  /** A tap on a cell holding several classes; see `SlotChoice`. */
  onSlotPress: (choice: SlotChoice) => void;
}
