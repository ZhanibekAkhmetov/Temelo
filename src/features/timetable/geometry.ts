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
 *
 * The vertical origin is `DAY_HEADER_HEIGHT + topInsetFor(...) - scrollY`, and
 * every part of the surface that draws against the vertical axis reads it from
 * here: the time gutter, the period rules, the blocks, the current-time marker
 * and the gestures' own hit-testing. One definition, so a centred grid cannot
 * end up with its lines in one place and its classes in another.
 */

/**
 * The hour column.
 *
 * Wide enough for "07:30" at the caption size with air on both sides. It was
 * ten points narrower and a size smaller, which put the times hard against the
 * first day column and made the one axis the whole grid is read against the
 * least legible thing on the screen. Ten points is a fifth of a day column on
 * a phone — a cheap trade for an axis you can actually read.
 */
export const TIME_GUTTER_WIDTH = 44;
export const DAY_HEADER_HEIGHT = 52;

/**
 * The period height a grid uses when it has the room for it.
 *
 * This is the design's *readable* row, not a minimum imposed by arithmetic: a
 * period at this height holds two lines of a class name and its room, which is
 * what the grid is for. A short academic day is drawn at exactly this height
 * and centred in whatever is left over — deliberately not stretched to fill
 * the viewport, because a five-period day rendered as five 120-point slabs
 * reads as a diagram of a day rather than as a timetable.
 */
export const BASE_SLOT_HEIGHT = 76;

/**
 * The floor a period may be squeezed to so that a longer day still fits.
 *
 * Below this the two lines of text stop fitting and the row stops being worth
 * drawing, so a day that would need less than this scrolls instead.
 */
export const MIN_SLOT_HEIGHT = 52;
export const MAX_SLOT_HEIGHT = 260;

/** Widest a single day column may become, so one day never fills the screen. */
export const MAX_COLUMN_WIDTH = 340;
/** Only ever used for a viewport that has not been measured yet. */
const FALLBACK_COLUMN_WIDTH = 44;

/**
 * Fewest day columns the most zoomed-in level still shows. Kept above one
 * so a fully zoomed grid always has the next day peeking in at the edge —
 * a single column with nothing beside it reads as a day view, not a
 * zoomed week.
 */
const MIN_COLUMNS_VISIBLE_AT_MAX_ZOOM = 1.6;

/**
 * Overflow under half a point counts as a fit, on both axes.
 *
 * Dividing the viewport by a count and multiplying back does not land exactly
 * on the viewport, and the difference must not become a scrollable range.
 */
const FIT_TOLERANCE = 0.5;

export function clampValue(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

/**
 * The period height at zoom 1 — what "fully zoomed out" means for this
 * viewport and this academic day.
 *
 * Three cases, in order:
 *
 *  - the day fits at the readable height, so it is drawn at exactly that and
 *    `topInsetFor` centres it. Nothing is enlarged to fill space it does not
 *    need.
 *  - the day is a little too tall, so the row shrinks *just* enough to fit —
 *    which is what puts a seven- or eight-period day entirely on screen on an
 *    ordinary phone instead of leaving the last one hanging over the edge.
 *  - the day is too tall even at the readability floor, so the floor wins and
 *    the grid scrolls. A twelve-period day is a scrolling timetable; pretending
 *    otherwise would only make it unreadable.
 *
 * The previous rule did none of this. It sized a row as `bodyHeight / 7.25`
 * regardless of how many periods there actually were, which meant a short day
 * was stretched into enormous rows *and* a seven-period day still overhung the
 * viewport by a quarter of a period at the one zoom level where the whole day
 * is supposed to be visible.
 */
export function minSlotHeightFor(bodyHeight: number, slotCount: number): number {
  "worklet";
  if (bodyHeight <= 0 || slotCount <= 0) return BASE_SLOT_HEIGHT;
  const fitting = bodyHeight / slotCount;
  if (fitting >= BASE_SLOT_HEIGHT) return BASE_SLOT_HEIGHT;
  return Math.max(MIN_SLOT_HEIGHT, fitting);
}

/**
 * How far down the grid starts when it does not fill the viewport.
 *
 * Half the spare room, so a short day sits in the middle of the body with
 * equal air above and below rather than hanging from the weekday strip. Zero
 * the moment the content is taller than the body, which is exactly when
 * `maxScrollFor` becomes non-zero — the two can never both be in play, so a
 * centred grid never scrolls and a scrolling grid is never inset.
 *
 * Everything drawn against the vertical axis has to apply this: the gutter's
 * times, the period rules, the blocks, the current-time marker, and the
 * hit-testing the gestures do. It is passed the *live* period height, so it
 * stays correct through a pinch, where the grid can grow past the viewport
 * mid-gesture and the inset has to fall away as it does.
 */
export function topInsetFor(slotHeight: number, slotCount: number, bodyHeight: number): number {
  "worklet";
  const spare = bodyHeight - slotHeight * slotCount;
  return spare > 0 ? spare / 2 : 0;
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

/**
 * How far the grid can be scrolled. Zero whenever the whole day fits.
 *
 * "Fits" allows the same sub-pixel slack the horizontal axis does, and for the
 * same reason: dividing a body height by a slot count and multiplying back
 * leaves a rounding crumb, and a scroll range of a ten-thousandth of a point
 * is not a scroll — it is a vertical drag that claims the axis and then moves
 * nothing, which reads as the grid being stuck.
 */
export function maxScrollFor(slotHeight: number, slotCount: number, bodyHeight: number): number {
  "worklet";
  const slack = contentHeightFor(slotHeight, slotCount) - bodyHeight;
  return slack > FIT_TOLERANCE ? slack : 0;
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
  return slack > FIT_TOLERANCE ? slack : 0;
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
