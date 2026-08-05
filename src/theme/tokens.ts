/**
 * Restrained visual tokens: neutral surfaces, thin borders, modest radii.
 * Colour is spent in one place only — the classes on the grid, whose
 * palette is at the bottom of this file — and the chrome stays out of its
 * way. No gradients.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 4,
  md: 6,
  lg: 10,
} as const;

export const borderWidth = {
  thin: 1,
} as const;

export const typography = {
  title: { fontSize: 20, fontWeight: "600" as const },
  subtitle: { fontSize: 15, fontWeight: "500" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  label: { fontSize: 13, fontWeight: "500" as const },
  caption: { fontSize: 12, fontWeight: "400" as const },
  gridText: { fontSize: 12, fontWeight: "500" as const },
  gridSecondary: { fontSize: 10.5, fontWeight: "400" as const },
};

export interface ColorTokens {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentMuted: string;
  destructive: string;
  destructiveMuted: string;
  todayBackground: string;
  /** Wash behind a range that has been proposed but not saved yet. */
  provisionalFill: string;
}

export const lightColors: ColorTokens = {
  background: "#F5F5F4",
  surface: "#FFFFFF",
  surfaceAlt: "#EFEEEC",
  border: "#D9D7D3",
  borderStrong: "#B7B4AE",
  textPrimary: "#1C1B19",
  textSecondary: "#57534E",
  textMuted: "#8A8681",
  accent: "#1C63B3",
  accentMuted: "#E5EBFD",
  destructive: "#D11A2F",
  destructiveMuted: "#FEEDEB",
  todayBackground: "#EDF0FE",
  provisionalFill: "#1C63B31F",
};

export const darkColors: ColorTokens = {
  background: "#151412",
  surface: "#1E1D1B",
  surfaceAlt: "#26241F",
  border: "#3A3733",
  borderStrong: "#4E4A44",
  textPrimary: "#EDEBE7",
  textSecondary: "#B7B3AC",
  textMuted: "#847F78",
  accent: "#8EB0FA",
  accentMuted: "#2C3449",
  destructive: "#F93E33",
  destructiveMuted: "#2B1917",
  todayBackground: "#282E3E",
  provisionalFill: "#8EB0FA26",
};

/**
 * Ordered so that consecutive courses — which are handed the next entry in
 * turn — never land on neighbouring hues. The closest adjacent pair here is
 * ΔE₀₀ ≈ 38, and the closest pair anywhere in the set ≈ 17 (violet/magenta).
 */
export const APPEARANCE_PALETTE = [
  "blue",
  "red",
  "emerald",
  "violet",
  "amber",
  "teal",
  "magenta",
] as const;

export type AppearanceId = (typeof APPEARANCE_PALETTE)[number];

export interface AppearanceColors {
  /** The block's own background — opaque, so it never dilutes into the grid. */
  fill: string;
  /** Class name on that fill. */
  ink: string;
  /** Room line on that fill. */
  inkMuted: string;
  /** Hairline around the block. */
  edge: string;
  /** Stroke of the selection rectangle and its resize handles. */
  outline: string;
}

/**
 * Seven course colours, generated in CIELAB rather than picked by eye: one
 * hue each, spaced at least 31° apart, carrying 90% of the chroma sRGB can
 * hold at that lightness and never more than C 72 — vivid enough to tell
 * apart at a glance on a black grid, short of the gamut edge where colours
 * start to buzz.
 *
 * `fill` is deliberately light (L* 62–73). That is what carries the colour,
 * and it lets one near-black ink sit on every one of them at 6.3:1 or
 * better, so no course needs its own text rule.
 *
 * `deep` is the same hue darkened: the block's hairline in both schemes, and
 * the selection stroke in light mode, where a lighter stroke would dissolve
 * into the page. `bright` is the same hue lightened, for the selection
 * stroke in dark mode.
 */
const APPEARANCE_HUES: Record<AppearanceId, { fill: string; deep: string; bright: string }> = {
  blue: { fill: "#5996F4", deep: "#2868B8", bright: "#B0C3F6" },
  red: { fill: "#F76D66", deep: "#CE2431", bright: "#F7B7AF" },
  emerald: { fill: "#31B978", deep: "#218455", bright: "#6BE9A5" },
  violet: { fill: "#B57AF4", deep: "#8447CE", bright: "#D8B7F6" },
  amber: { fill: "#F8A02E", deep: "#B9741A", bright: "#FBD6B5" },
  teal: { fill: "#37BCC6", deep: "#268890", bright: "#59EEF9" },
  magenta: { fill: "#F65FC1", deep: "#C02491", bright: "#F7B2DA" },
};

/** One ink for every fill; the room line is the same ink at 80%. */
const APPEARANCE_INK = "#121110";
const APPEARANCE_INK_MUTED = `${APPEARANCE_INK}CC`;

const FALLBACK_APPEARANCE: AppearanceId = "blue";

/**
 * The colours a class is drawn with. The fill and the ink are the same in
 * both schemes — one palette, not two that can drift — and only the strokes
 * change, because "stands out against the block" means lighter on a dark
 * grid and darker on a light one.
 */
export function getAppearanceColors(appearanceId: string, scheme: "light" | "dark"): AppearanceColors {
  const hue = APPEARANCE_HUES[appearanceId as AppearanceId] ?? APPEARANCE_HUES[FALLBACK_APPEARANCE];
  return {
    fill: hue.fill,
    ink: APPEARANCE_INK,
    inkMuted: APPEARANCE_INK_MUTED,
    edge: hue.deep,
    outline: scheme === "dark" ? hue.bright : hue.deep,
  };
}
