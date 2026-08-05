/**
 * The timetable's interaction state machine.
 *
 * One value describes what the user is doing, so nothing has to be inferred
 * from a combination of independent booleans, and only one provisional or
 * selected item can exist at a time. The numeric codes exist because the
 * gesture worklets have to read the same state on the UI thread.
 */

export const INTERACTION = {
  idle: 0,
  creatingRange: 1,
  provisionalSelected: 2,
  eventSelected: 3,
  resizingStart: 4,
  resizingEnd: 5,
  movingEvent: 6,
} as const;

export type InteractionKind = keyof typeof INTERACTION;
export type InteractionCode = (typeof INTERACTION)[InteractionKind];

/** A range of periods in one day column of one week. */
export interface RangeGeometry {
  weekStart: string;
  dayIndex: number;
  startIndex: number;
  span: number;
}

export type Interaction =
  | { kind: "idle" }
  /** Finger down, dragging out a new range from the period it started on. */
  | ({ kind: "creatingRange"; anchorIndex: number; valid: boolean } & RangeGeometry)
  /** A range exists on screen but no placement has been created for it. */
  | ({ kind: "provisionalSelected" } & RangeGeometry)
  /** An existing class is selected and showing its resize handles. */
  | ({ kind: "eventSelected"; placementId: string } & RangeGeometry)
  /** A handle or the body of the selected class is being dragged. */
  | ({
      kind: "resizingStart" | "resizingEnd" | "movingEvent";
      placementId: string | null;
      valid: boolean;
      /** Where it was before the drag, to return to if the drop is refused. */
      origin: RangeGeometry;
    } & RangeGeometry);

export const IDLE: Interaction = { kind: "idle" };

/** True while a finger is actively shaping something. */
export function isManipulating(kind: InteractionKind): boolean {
  return kind === "creatingRange" || kind === "resizingStart" || kind === "resizingEnd" || kind === "movingEvent";
}

/** The range an interaction occupies, or null when there is nothing to draw. */
export function interactionRange(interaction: Interaction): RangeGeometry | null {
  return interaction.kind === "idle" ? null : interaction;
}

/** The placement an interaction is about, if it is about an existing one. */
export function interactionPlacementId(interaction: Interaction): string | null {
  if (interaction.kind === "eventSelected") return interaction.placementId;
  if (interaction.kind === "movingEvent" || interaction.kind === "resizingStart" || interaction.kind === "resizingEnd") {
    return interaction.placementId;
  }
  return null;
}

export function isValidRange(interaction: Interaction): boolean {
  return "valid" in interaction ? interaction.valid : true;
}
