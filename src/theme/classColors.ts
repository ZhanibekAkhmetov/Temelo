/**
 * The colours a class is actually drawn in.
 *
 * One palette for both schemes, deliberately. A class is the same class in
 * the dark as in the light, and two palettes that could drift apart would
 * mean a course the user picked by eye in daylight is a different colour that
 * evening. It also keeps the dark grid *saturated*: desaturating these fills
 * into dusty variants is exactly the failure mode this avoids.
 *
 * Every entry states its own foreground rather than assuming white. Amber,
 * green, orange and cyan carry dark text because white on them is unreadable;
 * the deeper eight carry white. The numbers below are measured, not guessed:
 *
 *  - `ink` against `fill` is at least 4.55:1 — WCAG AA for the class name.
 *  - `inkMuted` (the ink at 90% over the fill) is at least 3.95:1, for the
 *    room line under it.
 *  - `outline` against `fill` is at least 3.2:1, so the selection rectangle —
 *    which lies entirely over the block — is visible on every colour.
 *
 * Four fills are moved from their reference hue to reach those figures:
 * blue #4285F4 → #3973D4, red #E53935 → #DB3733, deepGreen #0F9D58 →
 * #0D874C, teal #009688 → #008478. Each is the same RGB triple scaled
 * uniformly toward black, so hue and saturation are unchanged and only
 * brightness moves — a slightly deeper blue, never a navy one.
 */

import { CLASS_COLOR_IDS, normalizeClassColorId, type ClassColorId } from "@/domain/classColor";

export interface ClassColors {
  /** The block's own background — opaque, so it never dilutes into the grid. */
  fill: string;
  /** Class name on that fill. */
  ink: string;
  /** Room line on that fill. */
  inkMuted: string;
  /** Hairline around the block: the fill's own hue, darkened. */
  edge: string;
  /**
   * Stroke of the selection rectangle. Pushed away from the fill rather than
   * toward the theme: the rectangle sits on top of the block, so it is the
   * block it has to stand out against, in either scheme.
   */
  outline: string;
}

const WHITE_INK = "#FFFFFF";
const DARK_INK = "#17181A";

const CLASS_COLORS: Record<ClassColorId, ClassColors> = {
  blue: { fill: "#3973D4", ink: WHITE_INK, inkMuted: "#EBF1FB", edge: "#285194", outline: "#C9D9F3" },
  orange: { fill: "#F4511E", ink: DARK_INK, inkMuted: "#2D1E1A", edge: "#AB3915", outline: "#6B240D" },
  green: { fill: "#33B679", ink: DARK_INK, inkMuted: "#1A2824", edge: "#247F55", outline: "#19593B" },
  purple: { fill: "#8E24AA", ink: WHITE_INK, inkMuted: "#F4E9F7", edge: "#631977", outline: "#CD9FDA" },
  amber: { fill: "#F6BF26", ink: DARK_INK, inkMuted: "#2D291B", edge: "#AC861B", outline: "#836514" },
  teal: { fill: "#008478", ink: WHITE_INK, inkMuted: "#E6F3F2", edge: "#005C54", outline: "#BCDFDB" },
  magenta: { fill: "#D81B60", ink: WHITE_INK, inkMuted: "#FBE8EF", edge: "#971343", outline: "#F5C3D5" },
  deepGreen: { fill: "#0D874C", ink: WHITE_INK, inkMuted: "#E7F3ED", edge: "#095F35", outline: "#BFDFD0" },
  indigo: { fill: "#5C6BC0", ink: WHITE_INK, inkMuted: "#EFF0F9", edge: "#404B86", outline: "#CCD1EB" },
  red: { fill: "#DB3733", ink: WHITE_INK, inkMuted: "#FBEBEB", edge: "#992724", outline: "#F6CFCF" },
  cyan: { fill: "#039BE5", ink: DARK_INK, inkMuted: "#15252E", edge: "#026DA0", outline: "#01476A" },
  graphite: { fill: "#616161", ink: WHITE_INK, inkMuted: "#EFEFEF", edge: "#444444", outline: "#BBBBBB" },
};

/**
 * The colours for a stored `appearanceId`.
 *
 * Takes the raw stored string rather than a narrowed id, because that is what
 * every caller has: an unknown or legacy value is normalised here so no
 * component has to remember to do it.
 */
export function getClassColors(appearanceId: string): ClassColors {
  return CLASS_COLORS[normalizeClassColorId(appearanceId)];
}

/** The palette in picker order — ids paired with the swatch to draw for each. */
export const CLASS_COLOR_SWATCHES: { id: ClassColorId; colors: ClassColors }[] = CLASS_COLOR_IDS.map((id) => ({
  id,
  colors: CLASS_COLORS[id],
}));
