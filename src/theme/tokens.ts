/**
 * Restrained visual tokens: neutral surfaces, thin borders, modest radii,
 * one subdued accent. Kept intentionally small — no gradients, no
 * decorative palette.
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
  accent: "#2F5D8A",
  accentMuted: "#DCE6EF",
  destructive: "#9A3324",
  destructiveMuted: "#F2DAD4",
  todayBackground: "#E8EEF3",
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
  accent: "#7FA8CE",
  accentMuted: "#233442",
  destructive: "#D98B7C",
  destructiveMuted: "#3A2521",
  todayBackground: "#1F2C36",
};

export const APPEARANCE_PALETTE = [
  "slate",
  "clay",
  "moss",
  "plum",
  "ochre",
  "teal",
] as const;

export type AppearanceId = (typeof APPEARANCE_PALETTE)[number];

const APPEARANCE_ACCENTS_LIGHT: Record<AppearanceId, string> = {
  slate: "#5B6B7A",
  clay: "#9A5B45",
  moss: "#5C7A52",
  plum: "#7A5C82",
  ochre: "#9A7A2E",
  teal: "#3E7A78",
};

const APPEARANCE_ACCENTS_DARK: Record<AppearanceId, string> = {
  slate: "#9AAAB8",
  clay: "#D0987F",
  moss: "#9CBB8E",
  plum: "#BB9AC4",
  ochre: "#D0B25F",
  teal: "#82BFBC",
};

export function getAppearanceAccent(appearanceId: string, scheme: "light" | "dark"): string {
  const palette = scheme === "dark" ? APPEARANCE_ACCENTS_DARK : APPEARANCE_ACCENTS_LIGHT;
  return palette[appearanceId as AppearanceId] ?? palette.slate;
}
