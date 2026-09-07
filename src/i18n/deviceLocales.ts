/**
 * Reading the device's preferred languages, without letting a missing native
 * module take the app down.
 *
 * `expo-localization` resolves its native module at *import* time — the
 * module body calls `requireNativeModule("ExpoLocalization")`, which throws
 * if the binary does not contain it. A development build made before that
 * package was installed therefore does not fail at the point the locale is
 * read; it fails while the bundle is still being evaluated, and the app never
 * paints at all.
 *
 * So the import is guarded, exactly as `util/haptics` and `util/notifications`
 * guard theirs, and for the same reason: the usual cause is a development
 * build that predates the install, and that is worth saying out loud rather
 * than presenting as a blank screen.
 *
 * The fallback is not silent. With no native module the app runs in its
 * source language and logs, once, that a new development build is needed.
 */

import { useMemo } from "react";

import { FALLBACK_LANGUAGE } from "@/i18n/language";

type DeviceLocale = { languageTag?: string | null };

let useLocalesFromExpo: (() => DeviceLocale[]) | null = null;
let loadError: string | null = null;

try {
  // A plain `import` would be hoisted above this try block and defeat it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const localization = require("expo-localization") as { useLocales: () => DeviceLocale[] };
  useLocalesFromExpo = localization.useLocales;
} catch (error) {
  loadError = error instanceof Error ? error.message : String(error);
  if (__DEV__) {
    console.warn(
      `[temelo/i18n] expo-localization is not in this build (${loadError}). The device language cannot be read, so "System" resolves to "${FALLBACK_LANGUAGE}". Make a new development build to fix it.`,
    );
  }
}

/** Stable identity, so a re-render never hands the resolver a fresh array. */
const NO_LOCALES: DeviceLocale[] = [];

/**
 * Chosen once, at module scope, so the same hook function runs on every
 * render — whether or not the native module is present. Selecting it inside
 * the component would be a conditional hook call.
 */
const useLocales: () => DeviceLocale[] = useLocalesFromExpo ?? (() => NO_LOCALES);

/** Whether the device's languages can actually be read in this binary. */
export const deviceLocalesAvailable = useLocalesFromExpo !== null;

/** Why they cannot, when they cannot. For diagnostics and for development. */
export const deviceLocalesError = loadError;

/**
 * The device's preferred language tags, most preferred first.
 *
 * Live where the platform supports it: expo-localization's own hook
 * re-renders when Android's language list changes, which is what lets
 * "System" keep following the device while Temelo is running. Without the
 * native module it is an empty list, and `resolveLanguage` falls back to
 * English on its own.
 */
export function useDeviceLanguageTags(): string[] {
  const locales = useLocales();
  return useMemo(
    () => locales.map((locale) => locale.languageTag ?? "").filter((tag) => tag.length > 0),
    [locales],
  );
}
