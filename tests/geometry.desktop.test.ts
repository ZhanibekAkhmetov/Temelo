/// <reference types="node" />
// Node's own types (node:test, node:assert) for the type check. Expo's base
// tsconfig limits the global types to React Native's, so a test file names
// Node's itself; `@types/node` arrives with Expo, not as a dependency of ours.

/**
 * The desktop's period height (milestone 14.2).
 *
 * `minSlotHeightFor` takes an optional readable height. The phone never passes
 * one and must behave exactly as it always has; the desktop passes
 * `DESKTOP_READABLE_SLOT_HEIGHT`, which lets a day grow into a tall window
 * instead of sitting at the phone's height in the middle of an empty band.
 *
 * Written in TypeScript, in the runner's own `describe`/`it` style, so it is
 * type-checked against the code it tests by `npx tsc --noEmit`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BASE_SLOT_HEIGHT,
  DESKTOP_READABLE_SLOT_HEIGHT,
  maxScrollFor,
  maxZoomFor,
  MIN_SLOT_HEIGHT,
  minSlotHeightFor,
  slotHeightForZoom,
  topInsetFor,
} from "@/features/timetable/geometry";

const DESKTOP = DESKTOP_READABLE_SLOT_HEIGHT;

describe("the phone's geometry is untouched by the new parameter", () => {
  it("leaving it out is the same as passing the phone's readable height", () => {
    for (let bodyHeight = 300; bodyHeight <= 1400; bodyHeight += 25) {
      for (let slotCount = 1; slotCount <= 14; slotCount++) {
        assert.equal(
          minSlotHeightFor(bodyHeight, slotCount),
          minSlotHeightFor(bodyHeight, slotCount, BASE_SLOT_HEIGHT),
          `${slotCount} periods in ${bodyHeight}pt`,
        );
      }
    }
  });

  it("a phone never draws a period taller than its readable height", () => {
    assert.equal(minSlotHeightFor(1200, 4), BASE_SLOT_HEIGHT);
  });
});

describe("on a desktop the day fills the window", () => {
  it("grows past the phone's height when there is room", () => {
    const height = minSlotHeightFor(800, 8, DESKTOP);
    assert.equal(height, 100);
    assert.ok(height > BASE_SLOT_HEIGHT);
  });

  it("fills the body exactly, so nothing is centred and nothing scrolls", () => {
    const height = minSlotHeightFor(800, 8, DESKTOP);
    assert.equal(topInsetFor(height, 8, 800), 0);
    assert.equal(maxScrollFor(height, 8, 800), 0);
  });

  it("stops at the desktop's readable height and centres what is left", () => {
    const height = minSlotHeightFor(1200, 8, DESKTOP);
    assert.equal(height, DESKTOP);
    assert.equal(topInsetFor(height, 8, 1200), (1200 - DESKTOP * 8) / 2);
  });

  it("still floors at the readable minimum and scrolls a very long day", () => {
    const height = minSlotHeightFor(600, 14, DESKTOP);
    assert.equal(height, MIN_SLOT_HEIGHT);
    assert.ok(maxScrollFor(height, 14, 600) > 0);
  });
});

describe("zoom agrees with the desktop minimum", () => {
  it("zoom 1 is exactly the minimum height", () => {
    for (const [bodyHeight, slotCount] of [
      [700, 6],
      [800, 8],
      [1200, 8],
      [600, 14],
    ] as const) {
      assert.equal(
        slotHeightForZoom(1, bodyHeight, slotCount, DESKTOP),
        minSlotHeightFor(bodyHeight, slotCount, DESKTOP),
      );
    }
  });

  it("there is always room to zoom in", () => {
    assert.ok(maxZoomFor(1100, 800, 5, 8, DESKTOP) >= 1);
  });
});
