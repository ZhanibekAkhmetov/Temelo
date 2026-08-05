/**
 * Shared motion vocabulary for the timetable and the pickers.
 *
 * The paging animations are springs configured with `dampingRatio: 1`
 * (critically damped) and are always given the gesture's release velocity,
 * so a release continues the drag rather than starting a second animation.
 * Reanimated treats `duration` as a perceptual duration and runs for about
 * 1.5× that, so 200 lands in the 220–320 ms band asked for.
 */

import { type WithSpringConfig } from "react-native-reanimated";

/** Movement, in points, before a pan is allowed to claim an axis. */
export const TOUCH_SLOP = 10;

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
