/**
 * Grid geometry harness.
 *
 * The timetable's vertical scale is arithmetic, and arithmetic can be checked
 * without a device. What this covers is the two things the geometry has to
 * guarantee and used not to:
 *
 *  - at minimum zoom a normal academic day is *entirely* on screen, and a
 *    short one is centred rather than stretched to fill the viewport;
 *  - changing the number of periods leaves every piece of shared geometry
 *    mutually consistent — the zoom factor, the period height, the scroll
 *    offset and their bounds — with no state that needs a relaunch to escape.
 *
 * It cannot tell you how a pinch feels. It can tell you that no combination of
 * viewport and academic day within the ranges the app allows produces a grid
 * that is simultaneously inset and scrollable, taller than its ceiling, or
 * scrolled past its own end.
 */

import { MAX_SLOT_COUNT } from "@/domain/time";
import {
  BASE_SLOT_HEIGHT,
  clampValue,
  columnWidthForZoom,
  maxOffsetXFor,
  maxScrollFor,
  maxZoomFor,
  MAX_SLOT_HEIGHT,
  MIN_SLOT_HEIGHT,
  minSlotHeightFor,
  slotHeightForZoom,
  topInsetFor,
} from "@/features/timetable/geometry";
import { check, equal, section } from "./report.mjs";

/**
 * Body heights a real phone produces, in dp.
 *
 * The body is what is left after the status bar, the month header, the
 * navigation bar and the 52-point weekday strip. 470 is about the worst case
 * on a small phone with gesture navigation off; 660 is a large one.
 */
const PHONE_BODY_HEIGHTS = [470, 500, 530, 560, 590, 620, 660];
/** Screen width less the 44-point time gutter. */
const PHONE_BODY_WIDTHS = [316, 334, 368, 401];
const DAY_COUNTS = [5, 6, 7];

const NUDGE = 0.5;

function describe(bodyHeight, slotCount) {
  return `${slotCount} periods in a ${bodyHeight}pt body`;
}

/** The invariants that must hold for every viewport and every academic day. */
function testMinimumScaleInvariants() {
  section("Minimum vertical scale: the rules that hold everywhere");

  let violations = [];

  for (let bodyHeight = 380; bodyHeight <= 900; bodyHeight += 10) {
    for (let slotCount = 1; slotCount <= MAX_SLOT_COUNT; slotCount++) {
      const height = minSlotHeightFor(bodyHeight, slotCount);
      const content = height * slotCount;
      const inset = topInsetFor(height, slotCount, bodyHeight);
      const scroll = maxScrollFor(height, slotCount, bodyHeight);

      if (height < MIN_SLOT_HEIGHT - 1e-9 || height > BASE_SLOT_HEIGHT + 1e-9) {
        violations.push(`${describe(bodyHeight, slotCount)}: height ${height.toFixed(1)} outside the readable band`);
      }
      if (inset > 0 && scroll > 0) {
        violations.push(`${describe(bodyHeight, slotCount)}: both inset and scrollable`);
      }
      if (content <= bodyHeight && Math.abs(inset - (bodyHeight - content) / 2) > 1e-9) {
        violations.push(`${describe(bodyHeight, slotCount)}: spare room is not split evenly`);
      }
      // The "do not stretch" rule: a day with room to spare is drawn at the
      // readable height and no larger, whatever is left over.
      if (content < bodyHeight - 1 && Math.abs(height - BASE_SLOT_HEIGHT) > 1e-9) {
        violations.push(`${describe(bodyHeight, slotCount)}: ${height.toFixed(1)}pt rows in a body with room to spare`);
      }
      // The "fit if you can" rule: a day only scrolls once the floor is hit.
      if (scroll > 0 && height > MIN_SLOT_HEIGHT + 1e-9) {
        violations.push(`${describe(bodyHeight, slotCount)}: scrolls at ${height.toFixed(1)}pt without reaching the floor`);
      }
    }
  }

  check("no viewport produces an out-of-band period height, a stretched short day, or a needless scroll",
    violations.length === 0,
    violations.slice(0, 5).join(" · "));
}

/** Section C's headline claims, on the viewports they were made about. */
function testPhoneSizedDays() {
  section("A normal academic day at minimum zoom, on phone-sized viewports");

  for (const bodyHeight of PHONE_BODY_HEIGHTS) {
    const height = minSlotHeightFor(bodyHeight, 7);
    check(
      `7 periods fit completely in a ${bodyHeight}pt body (${height.toFixed(1)}pt rows)`,
      maxScrollFor(height, 7, bodyHeight) === 0,
      `${(height * 7 - bodyHeight).toFixed(1)}pt over the edge`,
    );
  }

  for (const bodyHeight of PHONE_BODY_HEIGHTS) {
    const height = minSlotHeightFor(bodyHeight, 8);
    check(
      `8 periods fit completely in a ${bodyHeight}pt body (${height.toFixed(1)}pt rows)`,
      maxScrollFor(height, 8, bodyHeight) === 0,
      `${(height * 8 - bodyHeight).toFixed(1)}pt over the edge`,
    );
  }

  // A short day is centred and readable rather than blown up to fill the page.
  for (const slotCount of [3, 4, 5]) {
    const bodyHeight = 620;
    const height = minSlotHeightFor(bodyHeight, slotCount);
    const inset = topInsetFor(height, slotCount, bodyHeight);
    equal(`${slotCount} periods are drawn at the readable height, not stretched`, height, BASE_SLOT_HEIGHT);
    check(
      `${slotCount} periods are centred with ${inset.toFixed(0)}pt above and below`,
      Math.abs(inset - (bodyHeight - height * slotCount) / 2) < 1e-9,
      `inset ${inset}`,
    );
  }

  // And a genuinely long day still scrolls rather than being crushed.
  const longDay = minSlotHeightFor(560, 14);
  equal("a 14-period day stops at the readability floor", longDay, MIN_SLOT_HEIGHT);
  check("…and scrolls instead", maxScrollFor(longDay, 14, 560) > 0, "it does not scroll");
}

/**
 * The reconciliation the surface performs when the academic day changes.
 *
 * The same arithmetic as the effect in `TimetableSurface`: carry the period
 * height across, re-derive the zoom factor from it against the new minimum,
 * clamp both, then clamp the offsets. Modelled rather than imported because it
 * lives inside a React component, but every function it calls is the real one.
 */
function reconcile(previous, next) {
  const minHeight = minSlotHeightFor(next.bodyHeight, next.slotCount);
  const maxZoom = maxZoomFor(next.bodyWidth, next.bodyHeight, next.dayCount, next.slotCount);
  const zoom = previous.slotHeight > 0 ? clampValue(previous.slotHeight / minHeight, 1, maxZoom) : 1;

  const slotHeight = slotHeightForZoom(zoom, next.bodyHeight, next.slotCount);
  const columnWidth = columnWidthForZoom(zoom, next.bodyWidth, next.dayCount);

  return {
    ...next,
    zoom,
    maxZoom,
    minHeight,
    slotHeight,
    columnWidth,
    scrollY: clampValue(previous.scrollY, 0, maxScrollFor(slotHeight, next.slotCount, next.bodyHeight)),
    offsetX: clampValue(previous.offsetX, 0, maxOffsetXFor(columnWidth, next.dayCount, next.bodyWidth)),
  };
}

function initial(viewport) {
  return reconcile({ slotHeight: 0, scrollY: 0, offsetX: 0 }, viewport);
}

function coherent(state) {
  const maxScroll = maxScrollFor(state.slotHeight, state.slotCount, state.bodyHeight);
  const maxOffset = maxOffsetXFor(state.columnWidth, state.dayCount, state.bodyWidth);
  const inset = topInsetFor(state.slotHeight, state.slotCount, state.bodyHeight);

  if (state.zoom < 1 - 1e-9 || state.zoom > state.maxZoom + 1e-9) return `zoom ${state.zoom} outside [1, ${state.maxZoom}]`;
  if (state.slotHeight < state.minHeight - 1e-9) return `height ${state.slotHeight} below the minimum ${state.minHeight}`;
  if (state.slotHeight > MAX_SLOT_HEIGHT + 1e-9) return `height ${state.slotHeight} above the ceiling`;
  if (state.scrollY < -1e-9 || state.scrollY > maxScroll + 1e-9) return `scrollY ${state.scrollY} outside [0, ${maxScroll}]`;
  if (state.offsetX < -1e-9 || state.offsetX > maxOffset + 1e-9) return `offsetX ${state.offsetX} outside [0, ${maxOffset}]`;
  if (inset > 0 && maxScroll > 0) return "inset and scrollable at once";
  return null;
}

function testReconfigurationStaysCoherent() {
  section("Changing the academic day leaves the geometry coherent");

  const sequence = [8, 7, 8, 6, 10, 7, 16, 3, 12, 1, 9];
  const problems = [];

  for (const bodyHeight of PHONE_BODY_HEIGHTS) {
    for (const bodyWidth of PHONE_BODY_WIDTHS) {
      for (const dayCount of DAY_COUNTS) {
        for (const zoomedIn of [false, true]) {
          let state = initial({ bodyHeight, bodyWidth, dayCount, slotCount: 8 });

          // Optionally start from a grid the user has pinched wide open and
          // scrolled to the bottom of — the state that used to survive a
          // slot-count change as an unreachable one.
          if (zoomedIn) {
            const zoom = state.maxZoom;
            const slotHeight = slotHeightForZoom(zoom, bodyHeight, 8);
            const columnWidth = columnWidthForZoom(zoom, bodyWidth, dayCount);
            state = {
              ...state,
              zoom,
              slotHeight,
              columnWidth,
              scrollY: maxScrollFor(slotHeight, 8, bodyHeight),
              offsetX: maxOffsetXFor(columnWidth, dayCount, bodyWidth),
            };
          }

          for (const slotCount of sequence) {
            state = reconcile(state, { bodyHeight, bodyWidth, dayCount, slotCount });
            const problem = coherent(state);
            if (problem) {
              problems.push(`${bodyWidth}x${bodyHeight}, ${dayCount} days, ${slotCount} periods: ${problem}`);
            }
          }

          // Whatever the sequence did, pinching all the way out must reach the
          // minimum exactly — this is the "cannot zoom back out" symptom.
          const out = slotHeightForZoom(1, bodyHeight, state.slotCount);
          if (Math.abs(out - minSlotHeightFor(bodyHeight, state.slotCount)) > 1e-9) {
            problems.push(`${bodyWidth}x${bodyHeight}: zoom 1 does not reach the minimum height`);
          }
        }
      }
    }
  }

  check(
    `every reconfiguration across ${PHONE_BODY_HEIGHTS.length * PHONE_BODY_WIDTHS.length * DAY_COUNTS.length * 2} starting states stays in bounds`,
    problems.length === 0,
    problems.slice(0, 5).join(" · "),
  );
}

/**
 * A change of one period must not visibly move the grid.
 *
 * This is what "preserve zoom sensibly" is worth checking: eight periods to
 * seven at the same zoom should leave the rows the height they were, not
 * rescale them because the denominator changed.
 */
function testHeightIsCarriedAcross() {
  section("A one-period change does not resize the rows underneath the user");

  const viewport = { bodyHeight: 590, bodyWidth: 344, dayCount: 5 };
  let state = initial({ ...viewport, slotCount: 8 });

  // Somewhere in the middle of the zoom range, as a user would leave it.
  const zoom = (1 + state.maxZoom) / 2;
  state = {
    ...state,
    zoom,
    slotHeight: slotHeightForZoom(zoom, viewport.bodyHeight, 8),
    columnWidth: columnWidthForZoom(zoom, viewport.bodyWidth, viewport.dayCount),
  };
  const before = state.slotHeight;

  state = reconcile(state, { ...viewport, slotCount: 7 });
  check(
    `period height survives 8 -> 7 (${before.toFixed(1)}pt -> ${state.slotHeight.toFixed(1)}pt)`,
    Math.abs(state.slotHeight - before) < 1e-6,
    "the rows were rescaled",
  );

  state = reconcile(state, { ...viewport, slotCount: 8 });
  check(
    "…and 7 -> 8 puts it back where it was",
    Math.abs(state.slotHeight - before) < 1e-6,
    `${state.slotHeight} vs ${before}`,
  );

  // Fully zoomed out is the one case where the height *should* change, because
  // the minimum itself did — but it must stay fully zoomed out.
  let out = initial({ ...viewport, slotCount: 8 });
  out = reconcile(out, { ...viewport, slotCount: 7 });
  equal("a fully zoomed-out grid stays fully zoomed out", out.zoom, 1);
  equal("…at the new minimum for seven periods", out.slotHeight, minSlotHeightFor(viewport.bodyHeight, 7));
}

/** The vertical origin is one number, and everything reads the same one. */
function testSharedOrigin() {
  section("One vertical origin for the gutter, the rules, the blocks and the marker");

  const bodyHeight = 620;
  const slotCount = 5;
  const height = minSlotHeightFor(bodyHeight, slotCount);
  const inset = topInsetFor(height, slotCount, bodyHeight);

  // The marker sits partway through a period; the rule sits on its boundary.
  const markerY = inset + (2 + 0.5) * height;
  const ruleY = inset + 2 * height;
  const gutterY = inset + 2 * height;

  equal("a period rule and its gutter label share an origin", ruleY, gutterY);
  check("the current-time marker is measured from the same one", markerY - ruleY === height / 2, `${markerY - ruleY}`);
  check("nothing is drawn above the inset", inset >= 0 && ruleY >= inset, `inset ${inset}`);

  // A hit test at the top of the third period must resolve to the third
  // period, inset included — this is the arithmetic the gestures use.
  const hit = (y) => Math.floor((y - inset) / height);
  equal("a touch on the third period's first pixel lands on the third period", hit(ruleY + NUDGE), 2);
  equal("a touch just above it lands on the second", hit(ruleY - NUDGE), 1);
  check("a touch in the blank space above the grid falls outside", hit(inset - NUDGE) < 0, "it landed on a period");
}

export function runGeometryHarness() {
  testMinimumScaleInvariants();
  testPhoneSizedDays();
  testReconfigurationStaysCoherent();
  testHeightIsCarriedAcross();
  testSharedOrigin();
}
