/**
 * The appearance preference: what the user chose, not what is on screen.
 *
 * Only the preference is ever stored. Persisting the *resolved* scheme
 * instead would freeze whatever the device happened to be at the moment the
 * choice was made — a phone that later switches to dark would keep opening
 * Temelo in light, and "System" would stop meaning anything at all.
 */

/** The stored value. Stable: it is written to SQLite and read back. */
export type AppearancePreference = "system" | "light" | "dark";

/** What the app actually draws with, once the preference has been resolved. */
export type ColorSchemeName = "light" | "dark";

export const APPEARANCE_PREFERENCES: AppearancePreference[] = ["system", "light", "dark"];

export const DEFAULT_APPEARANCE_PREFERENCE: AppearancePreference = "system";

/** Any stored string, narrowed. An unreadable value falls back to "system". */
export function normalizeAppearancePreference(value: string | null | undefined): AppearancePreference {
  return value === "light" || value === "dark" || value === "system" ? value : DEFAULT_APPEARANCE_PREFERENCE;
}

/**
 * The one resolution rule in the app.
 *
 * `deviceScheme` is deliberately typed as a loose string: React Native
 * reports "light", "dark", "unspecified", or nothing at all, and narrowing
 * that at the call site would put a cast in the one function whose whole job
 * is to be the safe narrowing. Anything that is not "dark" resolves to light,
 * which is the safer assumption during launch than a flash of dark.
 */
export function resolveColorScheme(
  preference: AppearancePreference,
  deviceScheme: string | null | undefined,
): ColorSchemeName {
  if (preference === "light" || preference === "dark") return preference;
  return deviceScheme === "dark" ? "dark" : "light";
}
