/**
 * Single place the app asks for a haptic tick, so no component has to know
 * which platform it is on or which expo-haptics call to make.
 *
 * The tick functions are fire-and-forget on purpose: they are called from
 * gesture code (via `runOnJS`) where awaiting a native round trip would put
 * a promise in the way of the next animation frame. Failures never reach
 * the caller, but they are not thrown away either — the last one is kept
 * for the diagnostics panel, and each distinct message is logged once in
 * development, because the usual cause is a development build that predates
 * the expo-haptics install and that is worth saying out loud.
 *
 * Rate limiting lives at the call sites, which is where the discrete events
 * actually are:
 *   - the time wheel ticks only when the centred value changes
 *     (`WheelPicker`, in the scroll worklet);
 *   - a manipulation ticks once when the long press activates
 *     (`TimetableSurface`, from the hold gesture's `onStart`);
 *   - a dragged block ticks once per snapped slot it crosses
 *     (`TimetableSurface`, only when the snapped position changes).
 */

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export type HapticKind = "selection" | "activation";

/**
 * Detents used `Clock_Tick`, which is the semantically obvious choice but is
 * so soft on most Android hardware that a wheel step barely registers.
 * `Context_Click` is the next effect up: still a single short click rather
 * than a buzz, but firm enough to feel one per value.
 *
 * `Segment_Tick` would be the closest match by meaning — "switching between a
 * series of potential choices" — but expo-haptics resolves it by reflection
 * and throws on anything below API 34, whereas `Context_Click` has a
 * guaranteed fallback in the native module on every API level.
 */
const ANDROID_SELECTION_EFFECT = Haptics.AndroidHaptics.Context_Click;

/**
 * The JS side of expo-haptics resolving says nothing about the native
 * module being in the running binary — that only shows up when a call is
 * made, which is what `lastError` captures.
 */
const moduleResolved =
  typeof Haptics?.selectionAsync === "function" && typeof Haptics?.performAndroidHapticsAsync === "function";

let lastError: string | null = null;
let successCount = 0;
const loggedErrors = new Set<string>();

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordError(kind: HapticKind, error: unknown): void {
  const message = `${kind}: ${messageFor(error)}`;
  lastError = message;
  if (__DEV__ && !loggedErrors.has(message)) {
    loggedErrors.add(message);
    console.warn(
      `[haptics] ${message}. If this says the native module is missing, the development build predates expo-haptics and needs rebuilding.`,
    );
  }
}

function perform(kind: HapticKind): Promise<void> {
  if (kind === "selection") {
    return Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(ANDROID_SELECTION_EFFECT)
      : Haptics.selectionAsync();
  }
  return Platform.OS === "android"
    ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Drag_Start)
    : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

function fireAndForget(kind: HapticKind): void {
  try {
    perform(kind).then(
      () => {
        successCount += 1;
      },
      (error: unknown) => recordError(kind, error),
    );
  } catch (error) {
    // A missing native module throws synchronously rather than rejecting.
    recordError(kind, error);
  }
}

/**
 * One short tick as a discrete value crosses a detent. Android goes through
 * a system haptic constant rather than the older Vibrator-based API, which
 * also avoids needing the `VIBRATE` permission.
 */
export function selectionTick(): void {
  fireAndForget("selection");
}

/** One firmer tick when a long press activates a manipulation. */
export function activationTick(): void {
  fireAndForget("activation");
}

export interface HapticsDiagnostics {
  /** Whether the expo-haptics JavaScript module resolved at import time. */
  moduleResolved: boolean;
  /** Which native call this platform uses. */
  platform: string;
  androidEffects: { selection: string; activation: string };
  /** Haptic requests that have completed without error since launch. */
  successCount: number;
  lastError: string | null;
}

export function getHapticsDiagnostics(): HapticsDiagnostics {
  return {
    moduleResolved,
    platform: Platform.OS,
    androidEffects: {
      selection: ANDROID_SELECTION_EFFECT ?? "unavailable",
      activation: Haptics.AndroidHaptics?.Drag_Start ?? "unavailable",
    },
    successCount,
    lastError,
  };
}

/**
 * Awaited version for the diagnostics panel, which wants to report what
 * actually happened. Never call this from gesture code.
 */
export async function probeHaptic(kind: HapticKind): Promise<{ ok: boolean; error?: string }> {
  try {
    await perform(kind);
    successCount += 1;
    return { ok: true };
  } catch (error) {
    recordError(kind, error);
    return { ok: false, error: messageFor(error) };
  }
}
