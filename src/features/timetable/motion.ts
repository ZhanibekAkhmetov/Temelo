/**
 * Shared motion vocabulary for the timetable and the pickers.
 *
 * The paging animations are springs configured with `dampingRatio: 1`
 * (critically damped) and are always given the gesture's release velocity,
 * so a release continues the drag rather than starting a second animation.
 * Reanimated treats `duration` as a perceptual duration and runs for about
 * 1.5× that, so 200 lands in the 220–320 ms band asked for.
 */

// A type-only import, written as one: `import { type X }` leaves an empty
// runtime import behind, which drags the whole native module in for anything
// that only wants these constants — the harness among them.
import type { WithSpringConfig } from "react-native-reanimated";

/** Movement, in points, before a pan is allowed to claim an axis. */
export const TOUCH_SLOP = 10;

/**
 * The month pager's own arbitration, which is a different problem from the
 * timetable's.
 *
 * The timetable surface owns its whole screen: nothing else wants the touch,
 * so it can afford to wait for a clear axis. The month grid is a panel inside
 * a vertically scrolling form, and the two of them are competing for the same
 * finger from the first millimetre — so the question is not "which axis is
 * this" but "which of us should own it", and it has to be answered early
 * enough that neither has visibly started.
 *
 * A smaller slop answers it sooner. The ratio is what makes the answer
 * tolerant: a real swipe across a phone is never level, and demanding
 * `|dy| < 10` — which is what a `failOffsetY` threshold amounts to — refuses
 * perfectly ordinary swipes for being a few degrees off. Asking instead that
 * the horizontal travel *dominate* the vertical accepts anything inside about
 * 40° of level, which is the whole range a thumb actually produces, while
 * still handing a genuine vertical drag straight to the form.
 */
export const PAGER_TOUCH_SLOP = 6;
export const PAGER_AXIS_RATIO = 1.2;

/** Fraction of the viewport a drag must cross to commit a page change. */
export const PAGE_COMMIT_FRACTION = 0.28;

/**
 * Pages per second above which a flick commits regardless of distance, and
 * how far ahead the release velocity is projected when deciding.
 */
export const PAGE_FLICK_VELOCITY = 0.55;
export const PAGE_VELOCITY_PROJECTION_SECONDS = 0.12;

/** Critically damped settle for a page: no bounce, no overshoot. */
export const PAGE_SPRING: WithSpringConfig = {
  duration: 200,
  dampingRatio: 1,
  overshootClamping: true,
};

/**
 * The month pager's settle: the same critically damped shape, shorter.
 *
 * A month grid is a small control inside a form, and a user browsing for a
 * date swipes it several times in a row rather than once. At the timetable's
 * 200 the page is still visibly arriving when the next swipe starts, which
 * makes the control feel slow even though nothing is being dropped. Kept
 * separate from `PAGE_SPRING` rather than retuning it, because the week pager
 * moves a whole screen and its timing has already been settled on.
 */
export const MONTH_PAGE_SPRING: WithSpringConfig = {
  duration: 140,
  dampingRatio: 1,
  overshootClamping: true,
};

/** Same feel, slightly quicker, for smaller in-place transitions. */
export const SETTLE_SPRING: WithSpringConfig = {
  duration: 160,
  dampingRatio: 1,
  overshootClamping: true,
};

/** How quickly a flung vertical scroll comes to rest. */
export const SCROLL_DECELERATION = 0.996;

/**
 * Hold before the grid hands the gesture to a manipulation: opening a range
 * on empty space, or selecting and then moving a class.
 */
export const BLOCK_LONG_PRESS_MS = 320;

/**
 * Longest press still read as a tap. Deliberately past
 * `BLOCK_LONG_PRESS_MS`, so a press that is a hair too slow to be a tap has
 * already become a hold rather than falling into a gap between the two.
 */
export const TAP_MAX_DURATION_MS = 400;

export const AXIS = {
  none: 0,
  horizontal: 1,
  vertical: 2,
  pinch: 3,
  block: 4,
} as const;

export type AxisLock = (typeof AXIS)[keyof typeof AXIS];
