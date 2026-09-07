/**
 * The semantic colour vocabulary, and the two palettes that answer it.
 *
 * Components ask for a *meaning* — `divider`, `gridMinor`, `textOnAccent` —
 * and never for a light or dark value, so there is exactly one place that
 * knows which scheme is in force and no component contains a
 * `scheme === "dark" ? …` of its own. Adding a third scheme would be one more
 * `ColorTokens` object here and nothing anywhere else.
 *
 * Class colours are deliberately *not* here: they belong to the data rather
 * than to the chrome, are the same in both schemes, and live in
 * `theme/classColors`.
 *
 * Nothing in this file affects layout. Every value is a colour, and every
 * dimension the timetable measures itself with lives in
 * `features/timetable/geometry`.
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
  /** The page itself, and what the root native view is painted with. */
  background: string;
  /** A panel sitting on the page: cards, sheets, the wheel's centre band. */
  surface: string;
  /** A surface that should read as lifted off the page — modal cards. */
  surfaceElevated: string;
  /** A quiet fill for a pressed row, a chip, or an inset well. */
  surfaceMuted: string;
  /** Behind the month title and the weekday strip. */
  headerBackground: string;
  /** Inside a text field. */
  inputBackground: string;

  textPrimary: string;
  textSecondary: string;
  /** Tertiary marks: gutter times, weekday letters, hints. Not body text. */
  textMuted: string;
  textDisabled: string;
  /** On an `accent` ground. */
  textOnAccent: string;
  /** On a `danger` ground. */
  textOnDanger: string;

  divider: string;
  dividerStrong: string;

  /** Between two consecutive periods. */
  gridMinor: string;
  /** Where the day genuinely breaks — a long gap between periods. */
  gridMajor: string;
  /** Between two day columns. */
  gridColumnRule: string;

  accent: string;
  /** A very light tint of the accent: selected segment, today's cell. */
  accentSubtle: string;
  /** Accent text or icons sitting *on* `accentSubtle`, which needs more. */
  accentStrong: string;
  /** The now line and its gutter label. */
  currentTime: string;

  /** Selection stroke where the selected thing has no colour of its own. */
  selectionBorder: string;
  /** Fill of a resize handle; its ring is `selectionBorder`. */
  selectionHandle: string;
  /** Wash behind a range that has been proposed but not saved yet. */
  provisionalFill: string;

  danger: string;
  /** A quiet ground for a refused or destructive state. */
  dangerSurface: string;

  /** Behind a centred modal card. */
  overlay: string;
  /** Behind a sheet anchored to an edge. */
  scrim: string;
  shadow: string;

  /** Weekday letters and dates for Saturday and Sunday. */
  weekendText: string;
}

/**
 * Light: designed for white, not inverted from the dark scheme.
 *
 * Surfaces are near-white and separated by hairlines rather than by tint, so
 * the only saturated things on screen are the classes. Grid lines are
 * deliberately faint — 1.2:1 against the page for a period line, 1.4:1 where
 * the day actually breaks — enough to read a row against, far short of a
 * spreadsheet.
 */
export const lightColors: ColorTokens = {
  background: "#FFFFFF",
  surface: "#F8F9FA",
  surfaceElevated: "#FFFFFF",
  surfaceMuted: "#F1F3F4",
  headerBackground: "#FFFFFF",
  inputBackground: "#FFFFFF",

  textPrimary: "#202124",
  textSecondary: "#5F6368",
  textMuted: "#80868B",
  textDisabled: "#9AA0A6",
  textOnAccent: "#FFFFFF",
  textOnDanger: "#FFFFFF",

  divider: "#DADCE0",
  dividerStrong: "#BDC1C6",

  gridMinor: "#E8EAED",
  gridMajor: "#DADCE0",
  gridColumnRule: "#E0E3E7",

  accent: "#1A73E8",
  accentSubtle: "#E8F0FE",
  accentStrong: "#1967D2",
  currentTime: "#1A73E8",

  selectionBorder: "#202124",
  selectionHandle: "#FFFFFF",
  provisionalFill: "#1A73E81F",

  danger: "#D93025",
  dangerSurface: "#FCE8E6",

  overlay: "#00000066",
  scrim: "#00000059",
  shadow: "#000000",

  weekendText: "#D93025",
};

/**
 * Dark: charcoal neutrals, not black and not blue-grey.
 *
 * The surfaces step 1.1–1.3:1 apart, which is what makes a card read as
 * lifted without a border doing the work, and the accent flips to the light
 * blue that a dark ground needs — so `textOnAccent` flips with it.
 */
export const darkColors: ColorTokens = {
  background: "#202124",
  surface: "#292A2D",
  surfaceElevated: "#303134",
  surfaceMuted: "#27282A",
  headerBackground: "#202124",
  inputBackground: "#292A2D",

  textPrimary: "#F1F3F4",
  textSecondary: "#BDC1C6",
  textMuted: "#9AA0A6",
  textDisabled: "#80868B",
  textOnAccent: "#202124",
  textOnDanger: "#202124",

  divider: "#3C4043",
  dividerStrong: "#5F6368",

  gridMinor: "#303236",
  gridMajor: "#3C4043",
  gridColumnRule: "#34373B",

  accent: "#8AB4F8",
  accentSubtle: "#29344A",
  accentStrong: "#8AB4F8",
  currentTime: "#8AB4F8",

  selectionBorder: "#F1F3F4",
  selectionHandle: "#303134",
  provisionalFill: "#8AB4F826",

  danger: "#F28B82",
  dangerSurface: "#3B2422",

  overlay: "#000000A6",
  scrim: "#00000099",
  shadow: "#000000",

  weekendText: "#F28B82",
};
