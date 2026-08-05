/**
 * Grid geometry shared by the render pass and the gesture worklets. Every
 * function here is a worklet so hit-testing and snapping can run on the UI
 * thread during a gesture without crossing to JavaScript.
 */

export const TIME_GUTTER_WIDTH = 34;
export const DAY_HEADER_HEIGHT = 52;

/** Never smaller than this, whatever the viewport, or rows stop being readable. */
export const MIN_SLOT_HEIGHT = 56;
export const MAX_SLOT_HEIGHT = 260;

/**
 * How much of the academic day the most zoomed-out level shows. A quarter
 * of a period is deliberately left over the edge of the viewport so there
 * is always something to scroll to, and so a short configured day still
 * fills the screen instead of leaving dead space underneath.
 */
const MAX_SLOTS_VISIBLE_AT_MIN_ZOOM = 7.5;
const MIN_ZOOM_OVERHANG_SLOTS = 0.25;

export function clampValue(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

export function minSlotHeightFor(bodyHeight: number, slotCount: number): number {
  "worklet";
  if (bodyHeight <= 0 || slotCount <= 0) return MIN_SLOT_HEIGHT;
  const visibleSlots = Math.max(1, Math.min(slotCount, MAX_SLOTS_VISIBLE_AT_MIN_ZOOM) - MIN_ZOOM_OVERHANG_SLOTS);
  return Math.max(MIN_SLOT_HEIGHT, bodyHeight / visibleSlots);
}

export function contentHeightFor(slotHeight: number, slotCount: number): number {
  "worklet";
  return slotHeight * slotCount;
}

export function maxScrollFor(slotHeight: number, slotCount: number, bodyHeight: number): number {
  "worklet";
  return Math.max(0, contentHeightFor(slotHeight, slotCount) - bodyHeight);
}

/** Column index under a surface-relative x, or -1 in the time gutter. */
export function dayIndexAt(x: number, columnWidth: number, dayCount: number): number {
  "worklet";
  if (columnWidth <= 0) return -1;
  const index = Math.floor((x - TIME_GUTTER_WIDTH) / columnWidth);
  if (index < 0 || index >= dayCount) return -1;
  return index;
}

/**
 * Position under a surface-relative y expressed in periods, fractional part
 * included — 2.5 is halfway through the third period.
 */
export function slotFloatAt(y: number, scrollY: number, slotHeight: number): number {
  "worklet";
  if (slotHeight <= 0) return 0;
  return (y - DAY_HEADER_HEIGHT + scrollY) / slotHeight;
}
