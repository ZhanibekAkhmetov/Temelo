/**
 * Grid geometry shared by the render pass and the gesture worklets. Every
 * function here is a worklet so hit-testing and snapping can run on the UI
 * thread during a gesture without crossing to JavaScript.
 *
 * The grid has two independent scales — how tall a period is and how wide a
 * day column is — and one zoom factor drives both. Zoom is expressed as a
 * multiplier over the fully-zoomed-out geometry, so zoom 1 always means
 * "the whole week, at the readable minimum period height", whatever the
 * viewport or the configured academic day happens to be.
 */

export const TIME_GUTTER_WIDTH = 34;
export const DAY_HEADER_HEIGHT = 52;

/** Never smaller than this, whatever the viewport, or rows stop being readable. */
export const MIN_SLOT_HEIGHT = 56;
export const MAX_SLOT_HEIGHT = 260;

/** Widest a single day column may become, so one day never fills the screen. */
export const MAX_COLUMN_WIDTH = 340;
/** Only ever used for a viewport that has not been measured yet. */
const FALLBACK_COLUMN_WIDTH = 44;

/**
 * How much of the academic day the most zoomed-out level shows. A quarter
 * of a period is deliberately left over the edge of the viewport so there
 * is always something to scroll to, and so a short configured day still
 * fills the screen instead of leaving dead space underneath.
 */
const MAX_SLOTS_VISIBLE_AT_MIN_ZOOM = 7.5;
const MIN_ZOOM_OVERHANG_SLOTS = 0.25;

/**
 * Fewest day columns the most zoomed-in level still shows. Kept above one
 * so a fully zoomed grid always has the next day peeking in at the edge —
 * a single column with nothing beside it reads as a day view, not a
 * zoomed week.
 */
const MIN_COLUMNS_VISIBLE_AT_MAX_ZOOM = 1.6;

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

/**
 * Fully zoomed out is exactly the whole week, edge to edge.
 *
 * Deliberately without a readability floor, unlike the vertical axis. A
 * floor would leave the week a few points wider than the viewport on a
 * narrow phone, and those few points would have to be dragged through
 * before a swipe could page — a dead zone at the one zoom level where
 * paging has to feel immediate. The whole-week overview wins; a column too
 * narrow to read is what zooming in is for.
 */
export function minColumnWidthFor(bodyWidth: number, dayCount: number): number {
  "worklet";
  if (bodyWidth <= 0 || dayCount <= 0) return FALLBACK_COLUMN_WIDTH;
  return bodyWidth / dayCount;
}

export function maxColumnWidthFor(bodyWidth: number, dayCount: number): number {
  "worklet";
  const minWidth = minColumnWidthFor(bodyWidth, dayCount);
  if (bodyWidth <= 0) return minWidth;
  return Math.max(minWidth, Math.min(MAX_COLUMN_WIDTH, bodyWidth / MIN_COLUMNS_VISIBLE_AT_MAX_ZOOM));
}

/**
 * How far a pinch may open, as a multiple of the fully-zoomed-out grid.
 *
 * It is the looser of the two axes rather than the tighter one: a short
 * academic day reaches the tallest useful period long before the columns
 * have finished widening, and stopping there would leave the horizontal
 * zoom — the half that actually buys room for text — barely usable. Each
 * axis clamps itself, so the one that ran out simply stops growing while
 * the other carries on.
 */
export function maxZoomFor(bodyWidth: number, bodyHeight: number, dayCount: number, slotCount: number): number {
  "worklet";
  const minHeight = minSlotHeightFor(bodyHeight, slotCount);
  const minWidth = minColumnWidthFor(bodyWidth, dayCount);
  const verticalRange = minHeight > 0 ? MAX_SLOT_HEIGHT / minHeight : 1;
  const horizontalRange = minWidth > 0 ? maxColumnWidthFor(bodyWidth, dayCount) / minWidth : 1;
  return Math.max(1, verticalRange, horizontalRange);
}

export function slotHeightForZoom(zoom: number, bodyHeight: number, slotCount: number): number {
  "worklet";
  const minHeight = minSlotHeightFor(bodyHeight, slotCount);
  return clampValue(minHeight * zoom, minHeight, MAX_SLOT_HEIGHT);
}

export function columnWidthForZoom(zoom: number, bodyWidth: number, dayCount: number): number {
  "worklet";
  const minWidth = minColumnWidthFor(bodyWidth, dayCount);
  return clampValue(minWidth * zoom, minWidth, maxColumnWidthFor(bodyWidth, dayCount));
}

export function contentHeightFor(slotHeight: number, slotCount: number): number {
  "worklet";
  return slotHeight * slotCount;
}

export function maxScrollFor(slotHeight: number, slotCount: number, bodyHeight: number): number {
  "worklet";
  return Math.max(0, contentHeightFor(slotHeight, slotCount) - bodyHeight);
}

/**
 * How far the week can be shifted sideways inside its own page. Zero
 * whenever the whole week fits, which is what keeps an unzoomed horizontal
 * drag a plain week page — including when dividing the viewport into
 * columns and multiplying back leaves a rounding crumb behind, which is why
 * anything under half a point counts as a fit.
 */
export function maxOffsetXFor(columnWidth: number, dayCount: number, bodyWidth: number): number {
  "worklet";
  const slack = columnWidth * dayCount - bodyWidth;
  return slack > 0.5 ? slack : 0;
}

/**
 * Column index under a surface-relative x, or -1 in the time gutter.
 *
 * The gutter is excluded by its own test rather than by the arithmetic
 * going negative: once the week is scrolled sideways, a point over the
 * gutter still lands on a real column once `offsetX` is added back.
 */
export function dayIndexAt(x: number, offsetX: number, columnWidth: number, dayCount: number): number {
  "worklet";
  if (columnWidth <= 0 || x < TIME_GUTTER_WIDTH) return -1;
  const index = Math.floor((x - TIME_GUTTER_WIDTH + offsetX) / columnWidth);
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

/** The same, horizontally: 2.5 is halfway across the third day column. */
export function dayFloatAt(x: number, offsetX: number, columnWidth: number): number {
  "worklet";
  if (columnWidth <= 0) return 0;
  return (x - TIME_GUTTER_WIDTH + offsetX) / columnWidth;
}
