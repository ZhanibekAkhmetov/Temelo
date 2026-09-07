/**
 * Which colour a class is drawn in — the identity of it, not the hex.
 *
 * A course stores a palette *id* (`appearanceId`), never a colour value and
 * never an index into an array. An id survives the palette being retuned,
 * reordered or extended; an index does not, and a stored `#4285F4` would
 * freeze one theme's idea of blue into the user's data forever.
 *
 * The hexes these ids resolve to live in `theme/classColors` — visual, and
 * therefore not the domain's business. This module owns only the vocabulary,
 * how an unknown value is made safe, and which colour a new class gets.
 */

import type { Course } from "@/types/models";

/**
 * The palette, in the order new classes cycle through it.
 *
 * Ordered so that consecutive classes never land on neighbouring hues: the
 * warm and cool halves alternate, and the two greens and the two blues are
 * kept as far apart in the rotation as the length allows.
 */
export const CLASS_COLOR_IDS = [
  "blue",
  "orange",
  "green",
  "purple",
  "amber",
  "teal",
  "magenta",
  "deepGreen",
  "indigo",
  "red",
  "cyan",
  "graphite",
] as const;

export type ClassColorId = (typeof CLASS_COLOR_IDS)[number];

export const FALLBACK_CLASS_COLOR_ID: ClassColorId = "blue";

const CLASS_COLOR_ID_SET: ReadonlySet<string> = new Set(CLASS_COLOR_IDS);

/**
 * Ids from the palette Temelo shipped before this one, mapped onto their
 * nearest surviving hue.
 *
 * Kept here as well as in the migration that rewrites stored rows, and for a
 * different reason: the migration fixes the database once, this fixes a value
 * that arrives from anywhere else — a row written by a newer build, a
 * hand-edited database during development, a future sync. Neither makes the
 * other redundant.
 */
const LEGACY_CLASS_COLOR_IDS: Record<string, ClassColorId> = {
  emerald: "green",
  violet: "purple",
};

/**
 * Any stored string, narrowed to a colour the app can actually draw.
 *
 * Unknown ids fall back rather than throwing: a class whose colour cannot be
 * read is still a class the user needs to see, and losing it over a palette
 * value would be far worse than showing it in the wrong blue.
 */
export function normalizeClassColorId(value: string): ClassColorId {
  if (CLASS_COLOR_ID_SET.has(value)) return value as ClassColorId;
  return LEGACY_CLASS_COLOR_IDS[value] ?? FALLBACK_CLASS_COLOR_ID;
}

/**
 * The colour a newly created class gets.
 *
 * Deterministic by construction — no randomness anywhere — and derived from
 * the most recently created class rather than from a count, so it keeps
 * advancing after a deletion instead of handing out the colour that was just
 * freed. Soft-deleted courses are skipped: they are not on the grid, so they
 * are not what the next colour has to differ from.
 *
 * A class keeps whatever it was given for good. This is consulted once, when
 * the class is created, and never again.
 */
export function nextClassColorId(courses: Course[]): ClassColorId {
  let newest: Course | null = null;
  for (const course of courses) {
    if (course.deletedAt) continue;
    // `>=` rather than `>`: several courses created in the same millisecond —
    // a sample timetable, an import — should resolve to the last of them, the
    // way array order already implies.
    if (!newest || course.createdAt >= newest.createdAt) newest = course;
  }
  if (!newest) return CLASS_COLOR_IDS[0];

  const index = CLASS_COLOR_IDS.indexOf(normalizeClassColorId(newest.appearanceId));
  return CLASS_COLOR_IDS[(index + 1) % CLASS_COLOR_IDS.length];
}
